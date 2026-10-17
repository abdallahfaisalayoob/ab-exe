"""Builds HIP_humanizer_colab.ipynb from the cells below.

    python build_notebook.py            # write the notebook
    python build_notebook.py --smoke    # run every cell here on CPU with tiny models

HIP = "Humanization by Iterative Paraphrasing" (Xu, Zhong, Raghunathan, Fang,
Kolter, 2026, "Base Models Look Human To AI Detectors", arXiv:2605.19516).
Key idea: detectors such as GPTZero recognise the fingerprint that chat /
instruction tuning leaves on text, but text from *base* models looks human.
So a base model is fine-tuned to map AI-style text back to human text, and
applied for several rounds.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

CELLS = []


def md(s):
    CELLS.append(("markdown", s.strip("\n")))


def code(s):
    CELLS.append(("code", s.strip("\n")))


md(r"""
# HIP humanizer: reproduction for Part 3

Reproduces **HIP (Humanization by Iterative Paraphrasing)** from *Xu et al. 2026, "Base Models Look Human To AI Detectors"* ([arXiv:2605.19516](https://arxiv.org/abs/2605.19516)).

**Why this works:** GPTZero-style detectors are deep classifiers. They pick up the fingerprint that *chat / instruction tuning* leaves on text. Text from **base** models doesn't carry it: GPTZero rated Llama-3-8B **base** continuations 96.7% human, and the same model's **instruct** version only 30.3%. So we fine-tune a base model (Qwen3-4B-Base) to turn AI-style text back into human text, then apply it for several rounds.

**Pipeline**

1. Collect real human passages (HAP-E corpus and HC3).
2. A small chat model rewrites each one in AI style. Together they make a training pair: *AI version → human original*.
3. Fine-tune Qwen3-4B-Base with QLoRA to reverse the rewrite.
4. Humanize your text for 10 rounds, keeping every round.
5. Score each round with our DeBERTa detector and a meaning-similarity score, then test the best rounds on GPTZero yourself.

**Before you start:** go to *Runtime → Change runtime type → T4 GPU*. Then run the cells from top to bottom (*Runtime → Run all*). Everything is saved to your Google Drive, so if Colab disconnects, run all again and it carries on where it stopped.
""")

code(r"""
# ===== 1. Settings =====
SMOKE = False            # True = tiny CPU test (used by the author to check the notebook)
FAST  = True             # True = ~1 h total (fits a free Colab session). False = full size, ~2.5 h

N_PAIRS     = 2500       # training pairs (paper used ~11.7k)
MIN_WORDS, MAX_WORDS = 100, 260
BASE_MODEL  = "Qwen/Qwen3-4B-Base"           # the model we fine-tune (base, NOT chat)
REWRITER    = "Qwen/Qwen2.5-1.5B-Instruct"   # chat model that makes the "AI-style" versions
ROUNDS      = 10         # paraphrasing rounds (paper: 10)
LORA_R      = 64
LR          = 1e-4
MAX_LEN     = 1024       # tokens per training example
SAVE_DIR    = "/content/drive/MyDrive/hip_humanizer"

if FAST:
    N_PAIRS, MAX_WORDS, MAX_LEN = 1200, 200, 768

if SMOKE:
    N_PAIRS, MIN_WORDS, MAX_WORDS = 6, 40, 120
    BASE_MODEL, REWRITER = "Qwen/Qwen2.5-0.5B", "Qwen/Qwen2.5-0.5B-Instruct"
    ROUNDS, LORA_R, MAX_LEN = 2, 8, 512
    SAVE_DIR = os.environ.get("HIP_SMOKE_DIR", "/tmp/hip_smoke")
""")

code(r"""
# ===== 2. Install + checks (about 2 minutes) =====
import os, sys, subprocess, json, random, re, time, math, gc
if not SMOKE:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-U",
                    "transformers>=4.51", "peft>=0.13", "bitsandbytes>=0.43", "accelerate",
                    "sentence-transformers", "pyarrow"], check=True)
import torch
GPU = torch.cuda.is_available()
if not SMOKE:
    assert GPU, "No GPU! Go to Runtime > Change runtime type > T4 GPU, then Runtime > Run all."
    print("GPU:", torch.cuda.get_device_name(0))
    try:
        from google.colab import drive
        drive.mount("/content/drive")
    except ImportError:
        SAVE_DIR = "./hip_humanizer"
os.makedirs(SAVE_DIR, exist_ok=True)
print("Saving everything to", SAVE_DIR)
""")

code(r"""
# ===== 3. Collect real human passages =====
import urllib.request, pyarrow.parquet as pq

def fetch(url, path):
    if not os.path.exists(path):
        print("downloading", url.split("/")[-1])
        urllib.request.urlretrieve(url, path)
    return path

def detok(t):  # HC3 human answers are stored pre-tokenised ("do n't", "word ,")
    t = re.sub(r"\s+(n't|'s|'re|'ve|'ll|'d|'m)\b", r"\1", t, flags=re.I)
    t = re.sub(r"\s+([.,;:!?%)\]])", r"\1", t)
    t = re.sub(r"([(\[$])\s+", r"\1", t)
    t = re.sub(r"(\w)\s+-\s+(\w)", r"\1-\2", t)
    t = re.sub(r"\s*\(?\s*URL_\d+\s*\)?", "", t)
    t = re.sub(r"([a-z])\.([A-Z][a-z])", r"\1. \2", t)
    return re.sub(r"\s+", " ", t).strip()

def ok(t):
    n = len(t.split())
    return MIN_WORDS <= n <= MAX_WORDS and "http" not in t and t.count("\n") < 8

humans = []
hape = fetch("https://huggingface.co/datasets/browndw/human-ai-parallel-corpus/resolve/main/text_data/hape-text_human-chunk-2.parquet",
             f"{SAVE_DIR}/hape_human.parquet")
for r in pq.read_table(hape).to_pylist():
    t = re.sub(r"\s+", " ", r["text"]).strip()
    # HAP-E chunks are ~500 words: cut to the first ~MAX_WORDS words at a sentence end
    sents, out = re.split(r"(?<=[.!?])\s+", t), []
    for s in sents:
        if len(" ".join(out + [s]).split()) > MAX_WORDS: break
        out.append(s)
    t = " ".join(out)
    if ok(t) and not r["doc_id"].startswith("tvm"):   # skip TV scripts
        humans.append(t)
hc3 = fetch("https://huggingface.co/datasets/Hello-SimpleAI/HC3/resolve/main/all.jsonl", f"{SAVE_DIR}/hc3.jsonl")
for line in open(hc3, encoding="utf-8"):
    for a in json.loads(line).get("human_answers", [])[:1]:
        t = detok(a)
        if ok(t): humans.append(t)
random.Random(0).shuffle(humans)
humans = list(dict.fromkeys(humans))[:N_PAIRS]
# pairs already made in an earlier (interrupted) run are always reused, so no work is lost
print(len(humans), "human passages, e.g.:\n", humans[0][:400])
""")

code(r"""
# ===== 4. Make the AI-style version of every passage (about 30-45 min on a T4, resumable) =====
from transformers import AutoTokenizer, AutoModelForCausalLM
PAIRS = f"{SAVE_DIR}/pairs.jsonl"
done = {}
if os.path.exists(PAIRS):
    for l in open(PAIRS, encoding="utf-8"):
        d = json.loads(l); done[d["human"]] = d["ai"]
todo = [h for h in humans if h not in done]
print(f"{len(done)} pairs already made, {len(todo)} to go")

if todo:
    rtok = AutoTokenizer.from_pretrained(REWRITER, padding_side="left")
    rmod = AutoModelForCausalLM.from_pretrained(REWRITER, dtype=torch.float16 if GPU else torch.float32,
                                                device_map="auto" if GPU else None).eval()
    STYLES = ["Rewrite the following text in your own words as a clear, polished, well-structured passage. Keep all the information.",
              "Paraphrase this passage so it reads professionally. Keep the meaning and the facts.",
              "Rewrite this text to improve its clarity and flow. Do not add new information."]
    BS = 32 if GPU else 2
    rng = random.Random(1)
    with open(PAIRS, "a", encoding="utf-8") as fh:
        for i in range(0, len(todo), BS):
            batch = todo[i:i + BS]
            prompts = [rtok.apply_chat_template([{"role": "user", "content": rng.choice(STYLES) + "\n\n" + h}],
                                                tokenize=False, add_generation_prompt=True) for h in batch]
            enc = rtok(prompts, return_tensors="pt", padding=True).to(rmod.device)
            with torch.no_grad():
                out = rmod.generate(**enc, max_new_tokens=int(MAX_WORDS * 2.2), do_sample=True,
                                    temperature=0.7, top_p=0.9, pad_token_id=rtok.eos_token_id)
            for h, o in zip(batch, out):
                ai = rtok.decode(o[enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()
                ai = re.sub(r"^(Sure|Certainly|Here('s| is))[^\n]*:\s*", "", ai)
                if len(ai.split()) > 0.5 * len(h.split()):
                    fh.write(json.dumps({"human": h, "ai": ai}) + "\n"); done[h] = ai
            fh.flush()
            print(f"  {min(i + BS, len(todo))}/{len(todo)}", flush=True)
    del rmod; gc.collect()
    if GPU: torch.cuda.empty_cache()
pairs = [{"human": h, "ai": a} for h, a in done.items()]
print(len(pairs), "pairs. Example:\nAI   :", pairs[0]["ai"][:300], "\nHUMAN:", pairs[0]["human"][:300])
""")

code(r"""
# ===== 5. Fine-tune the BASE model to turn AI text back into human text (about 60-90 min) =====
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, PeftModel
from transformers import Trainer, TrainingArguments, BitsAndBytesConfig
ADAPTER = f"{SAVE_DIR}/adapter"

def prompt_of(ai):  # plain-text format from the paper, no chat template
    return f"<source_text>{ai}</source_text>\n<target_text>"

tok = AutoTokenizer.from_pretrained(BASE_MODEL)
if tok.pad_token is None: tok.pad_token = tok.eos_token
quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                           bnb_4bit_compute_dtype=torch.float16) if GPU else None

if not os.path.exists(f"{ADAPTER}/adapter_config.json"):
    model = AutoModelForCausalLM.from_pretrained(BASE_MODEL, quantization_config=quant,
                                                 dtype=torch.float16 if GPU else torch.float32,
                                                 device_map="auto" if GPU else None)
    if GPU: model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(model, LoraConfig(r=LORA_R, lora_alpha=LORA_R, lora_dropout=0.05, task_type="CAUSAL_LM",
                          target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]))
    model.print_trainable_parameters()

    examples = []
    for p in pairs:
        a = tok(prompt_of(p["ai"]), add_special_tokens=False)["input_ids"]
        b = tok(p["human"] + "</target_text>", add_special_tokens=False)["input_ids"] + [tok.eos_token_id]
        ids = (a + b)[:MAX_LEN]
        labels = ([-100] * len(a) + b)[:MAX_LEN]     # loss only on the human completion
        if any(l != -100 for l in labels):
            examples.append({"input_ids": ids, "labels": labels})
    print(len(examples), "training examples")

    def collate(batch):
        n = max(len(x["input_ids"]) for x in batch)
        pad = lambda seq, v: seq + [v] * (n - len(seq))
        return {"input_ids": torch.tensor([pad(x["input_ids"], tok.pad_token_id) for x in batch]),
                "labels": torch.tensor([pad(x["labels"], -100) for x in batch]),
                "attention_mask": torch.tensor([[1] * len(x["input_ids"]) + [0] * (n - len(x["input_ids"])) for x in batch])}

    BS_DEV, GA = (2, 8) if GPU else (1, 1)
    total_steps = math.ceil(len(examples) / (BS_DEV * GA))
    args = TrainingArguments(output_dir=f"{SAVE_DIR}/ckpt", num_train_epochs=1,
                             per_device_train_batch_size=BS_DEV, gradient_accumulation_steps=GA,
                             learning_rate=LR, lr_scheduler_type="cosine", warmup_steps=max(1, int(0.03 * total_steps)),
                             logging_steps=10 if GPU else 1, save_steps=50, save_total_limit=2,
                             fp16=GPU, gradient_checkpointing=GPU, report_to=[],
                             gradient_checkpointing_kwargs={"use_reentrant": False} if GPU else None,
                             max_steps=2 if SMOKE else -1, remove_unused_columns=False)
    last = None
    if os.path.isdir(args.output_dir):
        cks = [d for d in os.listdir(args.output_dir) if d.startswith("checkpoint-")]
        if cks: last = os.path.join(args.output_dir, max(cks, key=lambda d: int(d.split("-")[1])))
    Trainer(model=model, args=args, train_dataset=examples, data_collator=collate).train(resume_from_checkpoint=last)
    model.save_pretrained(ADAPTER)
    print("adapter saved to", ADAPTER)
    del model; gc.collect()
    if GPU: torch.cuda.empty_cache()
else:
    print("adapter already trained:", ADAPTER)

base = AutoModelForCausalLM.from_pretrained(BASE_MODEL, quantization_config=quant,
                                            dtype=torch.float16 if GPU else torch.float32,
                                            device_map="auto" if GPU else None)
hip = PeftModel.from_pretrained(base, ADAPTER).eval()
print("humanizer ready")
""")

code(r"""
# ===== 6. Your text: paste it between the triple quotes =====
TEXT = '''Christopher Columbus was an Italian explorer and navigator who played a significant role in world history by initiating sustained contact between Europe and the Americas. Born in Genoa, Italy, in 1451, Columbus developed an interest in navigation and exploration at an early age. During the fifteenth century, European nations were searching for new trade routes to Asia to obtain valuable goods such as spices, silk, and precious metals.

Columbus believed that he could reach Asia by sailing westward across the Atlantic Ocean. Although his calculations about the Earth's size were incorrect, he persuaded King Ferdinand II and Queen Isabella I of Spain to finance his expedition. On August 3, 1492, Columbus departed from Spain with three ships: the Niña, the Pinta, and the Santa María. After weeks at sea, his expedition reached land on October 12, 1492, in the Caribbean, probably on an island in the present-day Bahamas.

Columbus believed that he had reached islands near Asia, and he continued to hold this mistaken belief for much of his life. In reality, his voyages brought Europeans into sustained contact with the Americas, continents already inhabited by millions of Indigenous people with diverse cultures, languages, and civilizations. Columbus subsequently undertook three more voyages across the Atlantic, exploring parts of the Caribbean and the coasts of Central and South America.

His voyages transformed global history by opening the way for further European exploration, colonization, and transatlantic trade. They also initiated the Columbian Exchange, the movement of plants, animals, diseases, and people between the Old World and the New World. Crops such as potatoes and maize spread to Europe, while horses and other animals were introduced to the Americas. However, this exchange also brought devastating consequences for Indigenous populations, particularly the spread of European diseases, forced labor, violence, and the loss of ancestral lands.

Although Columbus was celebrated for centuries as a courageous explorer, modern historical assessments also recognize the suffering associated with his expeditions and colonial administration. His treatment of Indigenous communities remains a major subject of historical debate.

In conclusion, Christopher Columbus was a consequential historical figure whose voyages reshaped relations between Europe and the Americas. While his expeditions expanded geographical knowledge and transformed international trade, they also contributed to colonization and immense human suffering. Understanding both the achievements and consequences of his voyages provides a more balanced perspective on his complex legacy.'''
""")

code(r"""
# ===== 7. Humanize: ROUNDS rounds, every round kept (about 5-10 min) =====
def humanize_once(paragraphs):
    prompts = [prompt_of(p) for p in paragraphs]
    tok.padding_side = "left"
    enc = tok(prompts, return_tensors="pt", padding=True).to(hip.device)
    longest = max(len(tok(p)["input_ids"]) for p in paragraphs)
    with torch.no_grad():
        out = hip.generate(**enc, max_new_tokens=int(longest * 1.6) + 20, do_sample=True, temperature=1.0, top_p=0.95,
                           pad_token_id=tok.pad_token_id, stop_strings=["</target_text>"], tokenizer=tok)
    res = []
    for p, o in zip(paragraphs, out):
        t = tok.decode(o[enc["input_ids"].shape[1]:], skip_special_tokens=True)
        t = re.split(r"</?(?:target|source)_text>", t)[0]      # stop at the first tag
        t = re.sub(r"<[^>]{1,80}>", " ", t)                     # strip any stray HTML
        t = re.sub(r"[ \t]+", " ", t).strip()
        n, m = len(t.split()), len(p.split())
        res.append(t if 0.4 * m <= n <= 2.0 * m else p)          # keep previous if it collapsed/rambled
    return res

paras = [p.strip() for p in re.split(r"\n\s*\n", TEXT) if p.strip()]
rounds = [paras]
for r in range(1, ROUNDS + 1):
    t0 = time.time()
    rounds.append(humanize_once(rounds[-1]))
    print(f"round {r} done ({time.time() - t0:.0f}s)")
    with open(f"{SAVE_DIR}/round_{r:02d}.txt", "w", encoding="utf-8") as fh:
        fh.write("\n\n".join(rounds[-1]))
""")

code(r"""
# ===== 8. Score every round: AI-likelihood (our DeBERTa detector) + meaning kept =====
import torch.nn as nn
from transformers import AutoConfig, AutoModel, PreTrainedModel
from sentence_transformers import SentenceTransformer, util

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
        return self.classifier((h * m).sum(1) / m.sum(1).clamp(min=1e-9))

del hip, base; gc.collect()
if GPU: torch.cuda.empty_cache()
dev = "cuda" if GPU else "cpu"
dtok = AutoTokenizer.from_pretrained("desklib/ai-text-detector-v1.01")
det = DesklibAIDetectionModel.from_pretrained("desklib/ai-text-detector-v1.01").to(dev).eval()
emb = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2", device=dev)

def ai_prob(text):
    enc = dtok(re.sub(r"\s+", " ", text), return_tensors="pt", truncation=True, max_length=512).to(dev)
    with torch.no_grad():
        return torch.sigmoid(det(enc["input_ids"], enc["attention_mask"])[0, 0]).item()

orig = "\n\n".join(rounds[0])
e0 = emb.encode(orig, convert_to_tensor=True)
print(f"{'round':>5} {'AI prob (DeBERTa)':>18} {'meaning kept':>13} {'words':>6}")
table = []
for r, ps in enumerate(rounds):
    t = "\n\n".join(ps)
    row = (r, ai_prob(t), util.cos_sim(e0, emb.encode(t, convert_to_tensor=True)).item(), len(t.split()))
    table.append(row)
    print(f"{row[0]:>5} {row[1]:>17.1%} {row[2]:>13.2f} {row[3]:>6}")
json.dump(table, open(f"{SAVE_DIR}/scores.json", "w"))
print("\nRound 0 = your original. Meaning kept: 1.00 = same meaning, below ~0.75 = drifting.")
""")

code(r"""
# ===== 9. Print the rounds to copy into GPTZero =====
SHOW = [1, 3, 5, ROUNDS] if not SMOKE else [1, ROUNDS]
for r in SHOW:
    print("=" * 30, f"ROUND {r}", "=" * 30)
    print("\n\n".join(rounds[r]), "\n")
print("All rounds are also saved in", SAVE_DIR, "(round_01.txt ... ).")
print("\nCHECK THE FACTS before using any round: paraphrasing models can change dates, names and numbers.")
""")


def write_notebook(path):
    nb = {"nbformat": 4, "nbformat_minor": 5,
          "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                       "kernelspec": {"name": "python3", "display_name": "Python 3"},
                       "language_info": {"name": "python"}},
          "cells": []}
    for kind, src in CELLS:
        cell = {"cell_type": kind, "metadata": {}, "source": src.splitlines(keepends=True)}
        if kind == "code":
            cell.update(outputs=[], execution_count=None)
        nb["cells"].append(cell)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(nb, fh, indent=1, ensure_ascii=False)
    print("wrote", path)


if __name__ == "__main__":
    if "--smoke" in sys.argv:
        ns = {"os": os}
        for kind, src in CELLS:
            if kind == "code":
                src = src.replace("SMOKE = False", "SMOKE = True", 1)
                exec(compile(src, "<cell>", "exec"), ns)
    else:
        write_notebook(os.path.join(HERE, "HIP_humanizer_colab.ipynb"))
