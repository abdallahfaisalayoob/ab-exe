"""The detector: runs every component, combines them, explains the verdict.

    from aidetect.detector import analyze
    result = analyze("some text ...")            # full mode (neural + stylometry)
    result = analyze("some text ...", mode="fast")   # stylometry only, no torch

Output is a plain dict (JSON-serialisable) consumed by the web UI.
"""

import json
import math
import os

from . import features as F
from .text_utils import normalize, sentence_spans, words

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(HERE, "..", "model")


def _load_json(name):
    path = os.path.join(MODEL_DIR, name)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return None


STYLE = _load_json("style_weights.json")
ENSEMBLE = _load_json("ensemble.json") or {
    # fallback if evaluate.py has not been run: plain average of logits
    "components": {"desklib": 1.0, "tmr": 1.0, "fakespot": 0.5, "style": 0.3},
    "bias": 0.0,
    "threshold": 0.5,
}

COMPONENT_INFO = {
    "desklib": ("DeBERTa-v3-large classifier",
                "Transformer fine-tuned on the RAID benchmark (6M+ texts, 11 LLMs, "
                "adversarial attacks). Learns patterns no hand-written rule captures."),
    "tmr": ("RoBERTa classifier (TMR)",
            "RoBERTa-base trained with hard-negative mining on RAID; tuned for a low "
            "false-positive rate."),
    "fakespot": ("RoBERTa classifier (Fakespot/ApolloDFT)",
                 "RoBERTa-base trained on a different mix of human/AI corpora - adds diversity."),
    "binoculars": ("Binoculars (zero-shot)",
                   "Two small LLMs compare how predictable the text is versus how predictable "
                   "an LLM expects it to be. Needs no AI training data."),
    "style": ("Stylometric model (ours)",
              "Logistic regression over 24 interpretable writing features, trained on HC3. "
              "Weak alone, but it is what explains the verdict."),
}


def _sigmoid(z):
    if z < -40:
        return 0.0
    if z > 40:
        return 1.0
    return 1 / (1 + math.exp(-z))


def _logit(p, eps=1e-4):
    p = min(max(p, eps), 1 - eps)
    return math.log(p / (1 - p))


# --------------------------------------------------------------------------
# Stylometric component
# --------------------------------------------------------------------------

def style_score(feats):
    """Probability + per-feature contributions from the stylometric model."""
    if not STYLE:
        return 0.5, []
    z = STYLE["bias"]
    contribs = []
    table = {t["feature"]: t for t in STYLE.get("feature_table", [])}
    for name, mu, sd, w in zip(STYLE["feature_names"], STYLE["mean"], STYLE["std"], STYLE["weights"]):
        v = feats[name]
        zz = (v - mu) / sd
        zz = max(-4.0, min(4.0, zz))  # one extreme feature must not dominate
        c = w * zz
        z += c
        t = table.get(name, {})
        contribs.append({
            "feature": name,
            "label": F.FEATURE_INFO[name][0],
            "description": F.FEATURE_INFO[name][1],
            "value": round(v, 3),
            "human_avg": t.get("human_mean"),
            "ai_avg": t.get("ai_mean"),
            "contribution": round(c, 3),
        })
    contribs.sort(key=lambda d: -abs(d["contribution"]))
    return _sigmoid(z), contribs


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------

def analyze(text, mode="full"):
    text = normalize(text)
    n_words = len(words(text))
    result = {"text": text, "mode": mode, "warnings": [], "components": {}}
    if n_words < 15:
        result.update(verdict="Too short", ai_probability=None, highlights=[], signals=[],
                      sentences=[], stats={"words": n_words})
        result["warnings"].append("Paste at least ~50 words; nothing reliable can be said about "
                                  "a single sentence.")
        return result
    if n_words < 60:
        result["warnings"].append(f"Only {n_words} words - short texts give unreliable results. "
                                  "100+ words is recommended.")

    feats, stats = F.extract(text)
    p_style, contribs = style_score(feats)
    comps = {"style": p_style}

    neural_ok = False
    sentence_probs = None
    token_info = None
    if mode == "full":
        from . import neural
        if neural.available():
            neural_ok = True
            pieces = neural.chunks(text)
            for name in ENSEMBLE["components"]:
                if name in ("style",):
                    continue
                if name == "binoculars":
                    b = neural.binoculars(text)
                    if b:
                        comps[name] = b["score"]
                        token_info = b["tokens"]
                    continue
                # long texts: score each ~300-word chunk, weight by length
                probs = [neural.classify(name, c) for c in pieces]
                lens = [len(c.split()) for c in pieces]
                comps[name] = sum(p * l for p, l in zip(probs, lens)) / sum(lens)
            sentence_probs = _sentence_probs(text, neural)
        else:
            result["warnings"].append("torch/transformers not installed - running stylometry only "
                                      "(much less accurate). See README.")
            mode = result["mode"] = "fast"

    # ---- combine -----------------------------------------------------------
    if neural_ok:
        z = ENSEMBLE["bias"]
        for name, w in ENSEMBLE["components"].items():
            if name not in comps:
                continue
            v = comps[name]
            if name == "binoculars":
                bz = ENSEMBLE.get("binoculars_scale", {"center": 0.95, "width": 0.03})
                z += w * (bz["center"] - v) / bz["width"]
            else:
                z += w * _logit(v)
        p = _sigmoid(z)
        thr = ENSEMBLE.get("threshold", 0.5)
    else:
        p = p_style
        thr = 0.5

    for name, v in comps.items():
        label, desc = COMPONENT_INFO[name]
        shown = v
        if name == "binoculars":
            shown = _sigmoid((0.95 - v) / 0.03)
        result["components"][name] = {"label": label, "description": desc,
                                      "ai_probability": round(shown, 4),
                                      "raw": round(v, 4),
                                      "weight": ENSEMBLE["components"].get(name)}

    # Rescale so the decision threshold maps to 50% on the gauge
    shown_p = _rescale(p, thr)
    result["ai_probability"] = round(shown_p, 4)
    result["verdict"] = _verdict(shown_p)
    result["stats"] = {k: v for k, v in stats.items() if k != "sentence_lengths"}
    result["stats"]["sentence_lengths"] = stats["sentence_lengths"]

    # ---- explanations ------------------------------------------------------
    result["signals"] = _signals(contribs, feats)
    result["highlights"] = F.find_markers(text)
    result["sentences"] = _sentences(text, sentence_probs, result["highlights"])
    result["reasons"] = _reasons(result, contribs, comps)
    if token_info:
        result["tokens"] = token_info
    return result


def _rescale(p, thr):
    """Piecewise-linear map so that p == thr becomes 0.5."""
    if p >= thr:
        return 0.5 + 0.5 * (p - thr) / max(1 - thr, 1e-9)
    return 0.5 * p / max(thr, 1e-9)


def _verdict(p):
    if p >= 0.85:
        return "Likely AI-generated"
    if p >= 0.6:
        return "Probably AI-generated"
    if p > 0.4:
        return "Uncertain / mixed"
    if p > 0.15:
        return "Probably human-written"
    return "Likely human-written"


def _sentence_probs(text, neural):
    """AI-probability for each sentence, from a sliding 3-sentence window.

    Single sentences are too short for a classifier, so each sentence gets
    the average score of the windows that contain it (like GPTZero's
    sentence highlighting).
    """
    spans = sentence_spans(text)
    if len(spans) < 2:
        return None
    name = "tmr" if "tmr" in ENSEMBLE["components"] else next(iter(ENSEMBLE["components"]))
    win = 3
    scores = [[] for _ in spans]
    starts = range(0, max(1, len(spans) - win + 1))
    for i in starts:
        j = min(len(spans), i + win)
        chunk = text[spans[i][0]:spans[j - 1][1]]
        if len(chunk.split()) < 8:
            continue
        p = neural.classify(name, chunk)
        for k in range(i, j):
            scores[k].append(p)
    return [sum(s) / len(s) if s else None for s in scores]


def _sentences(text, probs, highlights):
    out = []
    for i, (s, e) in enumerate(sentence_spans(text)):
        n_mark = sum(1 for h in highlights if h["start"] >= s and h["end"] <= e)
        out.append({"start": s, "end": e,
                    "ai_probability": None if not probs or probs[i] is None else round(probs[i], 3),
                    "markers": n_mark,
                    "words": len(words(text[s:e]))})
    return out


def _signals(contribs, feats):
    """Human-readable list of the strongest stylometric evidence."""
    out = []
    for c in contribs:
        if abs(c["contribution"]) < 0.15:
            continue
        c = dict(c)
        c["direction"] = "ai" if c["contribution"] > 0 else "human"
        out.append(c)
    return out[:12]


def _reasons(result, contribs, comps):
    """Plain-English bullet points for the 'Why?' panel."""
    reasons = []
    p = result["ai_probability"]
    hl = result["highlights"]
    kinds = {}
    for h in hl:
        kinds.setdefault(h["label"], []).append(result["text"][h["start"]:h["end"]])

    nn = [k for k in ("desklib", "tmr", "fakespot") if k in comps]
    if nn:
        agree = sum(1 for k in nn if comps[k] >= 0.5)
        reasons.append(f"{agree} of {len(nn)} neural classifiers judged the text AI-generated "
                       f"(the main signal, weighted most heavily).")

    for label, items in sorted(kinds.items(), key=lambda kv: -len(kv[1])):
        uniq = list(dict.fromkeys(i.strip().lower() for i in items))[:5]
        reasons.append(f"{label}: {len(items)}x - e.g. " + ", ".join(f"“{u}”" for u in uniq))

    for c in contribs[:6]:
        if abs(c["contribution"]) < 0.25:
            continue
        side = "AI-like" if c["contribution"] > 0 else "human-like"
        ref = ""
        if c["human_avg"] is not None:
            ref = f" (typical human {c['human_avg']:.2f}, typical AI {c['ai_avg']:.2f})"
        reasons.append(f"{c['label']} = {c['value']:.2f}{ref} → {side}.")

    sl = result["stats"].get("sentence_lengths", [])
    if len(sl) >= 5:
        reasons.append(f"Sentence lengths range {min(sl)}-{max(sl)} words "
                       f"(burstiness {F.extract(result['text'])[0]['sent_len_cv']:.2f}; "
                       "human writing is usually > 0.45).")
    if p is not None and 0.4 < p < 0.6:
        reasons.append("Signals disagree - this often happens with AI text that was edited or "
                       "paraphrased, or with very formal human writing.")
    return reasons
