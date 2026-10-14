"""Neural detectors (optional - need `pip install torch transformers`).

Two families, combined later by the ensemble in detector.py:

1. Binoculars (Hans et al., ICML 2024) - zero-shot, no training on AI text.
   Two small open LLMs (Qwen2.5-0.5B base = "observer", Qwen2.5-0.5B-Instruct
   = "performer") read the text. We divide how surprised the performer is
   by the text (perplexity) by how surprised it is *expected* to be given
   what the observer predicted (cross-perplexity). Machine text is
   unsurprising *relative to what an LLM expects*; that ratio is far more
   robust to topic than raw perplexity. Low score = AI.

2. Supervised classifiers - transformer encoders fine-tuned on large
   human-vs-AI corpora (this is how QuillBot/GPTZero-style detectors work):
     * TMR       Oxidane/tmr-ai-text-detector            RoBERTa-base, RAID
     * Desklib   desklib/ai-text-detector-v1.01          DeBERTa-v3-large, RAID
     * Fakespot  fakespot-ai/roberta-base-ai-text-detection-v1

Models are downloaded from Hugging Face on first use (~0.5-1.7 GB each) and
cached; after that everything runs offline.
"""

import math
import os
import re
from html import unescape

_CACHE = {}
MAX_TOKENS = 512

BINO_OBSERVER = os.environ.get("AIDETECT_OBSERVER", "Qwen/Qwen2.5-0.5B")
BINO_PERFORMER = os.environ.get("AIDETECT_PERFORMER", "Qwen/Qwen2.5-0.5B-Instruct")

CLASSIFIERS = {
    "tmr": "Oxidane/tmr-ai-text-detector",
    "desklib": "desklib/ai-text-detector-v1.01",
    "fakespot": "fakespot-ai/roberta-base-ai-text-detection-v1",
}


def available():
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return True
    except Exception:
        return False


def _torch():
    import torch
    torch.set_grad_enabled(False)
    if "threads" not in _CACHE:
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        _CACHE["threads"] = True
    return torch


def _clean(t):
    """Markdown / whitespace clean-up the classifiers were trained with."""
    t = re.sub(r"```.*?```", "", t, flags=re.S)
    t = re.sub(r"\[([^\]]+)\]\(.*?\)", r"\1", t)
    t = re.sub(r"(\*\*|__)(.*?)\1", r"\2", t)
    t = re.sub(r"#+ ", "", t)
    t = re.sub(r"(?m)^(\s*[-*+•]|\d+\.)\s+", "", t)
    t = unescape(t)
    t = re.sub(r"\s+", " ", t)
    return t.strip()


# --------------------------------------------------------------------------
# Binoculars
# --------------------------------------------------------------------------

def _load_bino():
    if "bino" not in _CACHE:
        torch = _torch()
        from transformers import AutoModelForCausalLM, AutoTokenizer
        tok = AutoTokenizer.from_pretrained(BINO_OBSERVER)
        obs = AutoModelForCausalLM.from_pretrained(BINO_OBSERVER, dtype=torch.float32).eval()
        perf = AutoModelForCausalLM.from_pretrained(BINO_PERFORMER, dtype=torch.float32).eval()
        _CACHE["bino"] = (tok, obs, perf)
    return _CACHE["bino"]


def binoculars(text):
    """Return {score, ppl, x_ppl, tokens:[{start,end,surprise}]} or None.

    `surprise` per token = performer NLL minus the cross-entropy the
    observer expected at that position. Negative = the word was *more*
    predictable than an LLM would expect = machine-like.
    """
    torch = _torch()
    tok, obs, perf = _load_bino()
    enc = tok(text, return_tensors="pt", return_offsets_mapping=True,
              truncation=True, max_length=MAX_TOKENS)
    ids = enc["input_ids"]
    if ids.shape[1] < 8:
        return None
    offsets = enc["offset_mapping"][0].tolist()
    lo = obs(ids).logits[0, :-1].float()
    lp = perf(ids).logits[0, :-1].float()
    target = ids[0, 1:]

    logp_perf = torch.log_softmax(lp, -1)
    nll = -logp_perf.gather(1, target[:, None])[:, 0]             # performer NLL
    p_obs = torch.softmax(lo, -1)
    xent = -(p_obs * logp_perf).sum(-1)                           # cross-entropy

    ppl = nll.mean().item()
    x_ppl = xent.mean().item()
    score = ppl / x_ppl if x_ppl > 0 else 1.0

    tokens = []
    for (s, e), a, b in zip(offsets[1:], nll.tolist(), xent.tolist()):
        tokens.append({"start": s, "end": e, "surprise": round(a - b, 3)})
    return {"score": score, "ppl": ppl, "x_ppl": x_ppl, "tokens": tokens,
            "n_tokens": int(ids.shape[1])}


# --------------------------------------------------------------------------
# Supervised classifiers
# --------------------------------------------------------------------------

def _load_clf(name):
    key = "clf_" + name
    if key in _CACHE:
        return _CACHE[key]
    torch = _torch()
    from transformers import AutoTokenizer
    repo = CLASSIFIERS[name]
    tok = AutoTokenizer.from_pretrained(repo)
    if name == "desklib":
        import torch.nn as nn
        from transformers import AutoConfig, AutoModel, PreTrainedModel

        class DesklibAIDetectionModel(PreTrainedModel):
            config_class = AutoConfig

            def __init__(self, config):
                super().__init__(config)
                self.model = AutoModel.from_config(config)
                self.classifier = nn.Linear(config.hidden_size, 1)
                self.post_init()

            def forward(self, input_ids, attention_mask=None):
                h = self.model(input_ids, attention_mask=attention_mask)[0]
                m = attention_mask.unsqueeze(-1).float()
                pooled = (h * m).sum(1) / m.sum(1).clamp(min=1e-9)
                return self.classifier(pooled)

        model = DesklibAIDetectionModel.from_pretrained(repo).eval()
    else:
        from transformers import AutoModelForSequenceClassification
        model = AutoModelForSequenceClassification.from_pretrained(repo).eval()
    _CACHE[key] = (tok, model, torch)
    return _CACHE[key]


def classify(name, text):
    """Probability (0-1) that `text` is AI-generated, from classifier `name`."""
    tok, model, torch = _load_clf(name)
    enc = tok(_clean(text), return_tensors="pt", truncation=True, max_length=MAX_TOKENS)
    if name == "desklib":
        logit = model(enc["input_ids"], enc["attention_mask"])[0, 0].item()
        return 1 / (1 + math.exp(-logit))
    logits = model(**enc).logits[0]
    probs = torch.softmax(logits, -1).tolist()
    labels = {i: l.lower() for i, l in model.config.id2label.items()}
    ai_idx = next(i for i, l in labels.items() if l in ("ai", "fake", "machine", "1", "label_1"))
    return probs[ai_idx]


def chunks(text, max_words=300):
    """Split long text into ~max_words pieces on paragraph/sentence borders."""
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    out, cur = [], []
    for p in paras:
        for s in re.split(r"(?<=[.!?])\s+", p):
            cur.append(s)
            if sum(len(x.split()) for x in cur) >= max_words:
                out.append(" ".join(cur))
                cur = []
    if cur:
        if out and sum(len(x.split()) for x in cur) < max_words // 3:
            out[-1] += " " + " ".join(cur)
        else:
            out.append(" ".join(cur))
    return out or [text]
