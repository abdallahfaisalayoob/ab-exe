"""Fit the ensemble and evaluate it head-to-head against QuillBot.

    python training/evaluate.py

Inputs : training/eval_sets.jsonl, training/component_scores.jsonl
Outputs: model/ensemble.json        (weights used by the app)
         training/RESULTS.md        (tables quoted in REPORT.md)

Honesty rules used here
-----------------------
* The ensemble is a logistic regression on the components' logits. Every
  number reported for it comes from 5-fold *grouped* cross-validation: all
  humanized rewrites of one source essay sit in the same fold, so the model
  is always scored on essays it never saw in any form.
* The decision threshold is picked inside each training fold so that at most
  ~2% of human texts would be flagged, then applied to the held-out fold.
* QuillBot's numbers are its own published verdicts on exactly the same
  726 humanized texts (AI Humanizer Benchmark, Oct 2026).
"""

import collections
import json
import math
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from aidetect import detector  # noqa: E402

TARGET_FPR = 0.02


def logit(p, eps=1e-4):
    p = np.clip(np.asarray(p, dtype=float), eps, 1 - eps)
    return np.log(p / (1 - p))


def auc(y, s):
    y = np.asarray(y)
    s = np.asarray(s, dtype=float)
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    # average ties
    for v in np.unique(s):
        m = s == v
        if m.sum() > 1:
            ranks[m] = ranks[m].mean()
    pos = y == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return float((ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def fit_logreg(X, y, l2=1.0, iters=4000, lr=0.3, sample_weight=None):
    n, d = X.shape
    w, b = np.zeros(d), 0.0
    sw = np.ones(n) if sample_weight is None else sample_weight
    sw = sw / sw.mean()
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(X @ w + b)))
        g = (p - y) * sw
        w -= lr * (X.T @ g / n + l2 * w / n)
        b -= lr * g.mean()
    return w, b


def threshold_for_fpr(scores_h, fpr):
    s = np.sort(np.asarray(scores_h))[::-1]
    k = int(math.floor(fpr * len(s)))
    return float(s[k]) + 1e-9 if k < len(s) else float(s[-1])


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", default=os.path.join(HERE, "eval_sets.jsonl"))
    ap.add_argument("--scores", default=os.path.join(HERE, "component_scores.jsonl"))
    args = ap.parse_args()
    sets = {}
    for l in open(args.sets, encoding="utf-8"):
        r = json.loads(l)
        sets[r["id"]] = r
    scores = {}
    for l in open(args.scores, encoding="utf-8"):
        r = json.loads(l)
        scores[r["id"]] = r
    comps = ["desklib", "tmr", "fakespot"]
    has_bino = sum(1 for r in scores.values() if r.get("binoculars") is not None)

    rows = []
    for i, meta in sets.items():
        r = scores.get(i)
        if not r or any(r.get(c) is None for c in comps):
            continue
        p_style, _ = detector.style_score(r["style"])
        rows.append({**meta, **{c: r[c] for c in comps}, "style": p_style,
                     "binoculars": r.get("binoculars")})
    print(f"{len(rows)} scored texts ({has_bino} with binoculars)")

    y = np.array([r["label"] for r in rows])
    feats = comps + ["style"]
    X = np.column_stack([logit([r[c] for r in rows]) for c in feats])
    groups = [r["group"] for r in rows]

    # balance: each human text should count as much as each AI text overall
    n_ai, n_h = (y == 1).sum(), (y == 0).sum()
    sw = np.where(y == 1, 0.5 / n_ai, 0.5 / n_h) * len(y)

    # ---- grouped 5-fold CV ------------------------------------------------
    ug = sorted(set(groups))
    random.Random(0).shuffle(ug)
    fold_of = {g: k % 5 for k, g in enumerate(ug)}
    folds = np.array([fold_of[g] for g in groups])
    cv_p = np.zeros(len(y))
    cv_flag = np.zeros(len(y), dtype=bool)
    for k in range(5):
        tr, te = folds != k, folds == k
        w, b = fit_logreg(X[tr], y[tr], sample_weight=sw[tr])
        p_tr = 1 / (1 + np.exp(-(X[tr] @ w + b)))
        thr = threshold_for_fpr(p_tr[y[tr] == 0], TARGET_FPR)
        cv_p[te] = 1 / (1 + np.exp(-(X[te] @ w + b)))
        cv_flag[te] = cv_p[te] >= thr

    # Final model on everything
    w, b = fit_logreg(X, y, sample_weight=sw)
    p_all = 1 / (1 + np.exp(-(X @ w + b)))
    thr = threshold_for_fpr(p_all[y == 0], TARGET_FPR)

    # ---- per-component baselines (each at its own 2%-FPR threshold) -------
    def single(name, s):
        s = np.asarray(s, dtype=float)
        t = threshold_for_fpr(s[y == 0], TARGET_FPR)
        flag = s >= t
        return {"auc": auc(y, s), "flag": flag, "flag05": s >= 0.5}

    results = {"ensemble (ours)": {"auc": auc(y, cv_p), "flag": cv_flag, "flag05": cv_flag}}
    for c in feats:
        results[c] = single(c, [r[c] for r in rows])

    set_names = sorted(set(r["set"] for r in rows), key=lambda s: (not s.startswith("ai") and s != "humanized", s))
    lines = ["# Evaluation results", "",
             f"Texts scored: {len(rows)} ({int(n_ai)} AI, {int(n_h)} human). "
             f"Ensemble numbers are 5-fold grouped cross-validation; thresholds set for "
             f"<= {TARGET_FPR:.0%} false positives on human text.", ""]

    # Head-to-head vs QuillBot on humanized texts
    hz = np.array([r["set"] == "humanized" and r.get("quillbot_ai") is not None for r in rows])
    qb = np.array([r.get("quillbot_ai") if r.get("quillbot_ai") is not None else np.nan for r in rows])
    lines += ["## Head-to-head vs QuillBot: 726 humanized AI texts", "",
              "Share of texts correctly flagged as AI (higher is better). Every text here is AI-written, "
              "then rewritten by a commercial humanizer.", "",
              "| Humanizer | n | QuillBot | Ours (ensemble) |", "|---|---:|---:|---:|"]
    byh = collections.defaultdict(list)
    for i, r in enumerate(rows):
        if hz[i]:
            byh[r["humanizer"]].append(i)
    for h, idx in sorted(byh.items()):
        lines.append(f"| {h} | {len(idx)} | {np.mean(qb[idx] >= 0.5):.0%} | {np.mean(cv_flag[idx]):.0%} |")
    idx = np.where(hz)[0]
    lines.append(f"| **All** | **{len(idx)}** | **{np.mean(qb[idx] >= 0.5):.1%}** | **{np.mean(cv_flag[idx]):.1%}** |")
    lines.append("")

    # Detection / false-positive table per set
    lines += ["## Per test set", "",
              "AI sets: % flagged as AI (want high). Human sets: % wrongly flagged as AI (want low).", "",
              "| Set | n | " + " | ".join(results) + " |",
              "|---|---:|" + "---:|" * len(results)]
    for s in set_names:
        idx = np.array([r["set"] == s for r in rows])
        cells = [f"{np.mean(res['flag'][idx]):.1%}" for res in results.values()]
        lines.append(f"| {s} | {idx.sum()} | " + " | ".join(cells) + " |")
    lines.append("| **AUC (all)** | | " + " | ".join(f"**{res['auc']:.3f}**" for res in results.values()) + " |")
    lines.append("")

    # modern raw AI by model
    lines += ["## Raw (unedited) AI text by generating model", "", "| Model | n | Ours |", "|---|---:|---:|"]
    bym = collections.defaultdict(list)
    for i, r in enumerate(rows):
        if r["set"] == "ai_raw":
            bym[r.get("model")].append(i)
    for m, idx in sorted(bym.items()):
        lines.append(f"| {m} | {len(idx)} | {np.mean(cv_flag[idx]):.0%} |")
    lines.append("")

    lines += ["## Ensemble weights (on component logits)", "",
              "| Component | Weight |", "|---|---:|"]
    lines += [f"| {f} | {wi:.3f} |" for f, wi in zip(feats, w)]
    lines.append(f"| bias | {b:.3f} |")
    lines.append(f"| decision threshold (probability) | {thr:.3f} |")

    out_md = os.path.join(HERE, "RESULTS.md")
    open(out_md, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    print("\n".join(lines))

    hz_idx = np.where(hz)[0]
    human_idx = np.where(y == 0)[0]
    ens = {
        "components": {f: round(float(wi), 4) for f, wi in zip(feats, w)},
        "bias": round(float(b), 4),
        "threshold": round(float(thr), 4),
        "evaluation_summary": {
            "humanized_detected_ours": round(float(np.mean(cv_flag[hz_idx])), 4),
            "humanized_detected_quillbot": round(float(np.mean(qb[hz_idx] >= 0.5)), 4),
            "human_false_positive_rate": round(float(np.mean(cv_flag[human_idx])), 4),
            "auc": round(results["ensemble (ours)"]["auc"], 4),
        },
    }
    with open(os.path.join(HERE, "..", "model", "ensemble.json"), "w", encoding="utf-8") as fh:
        json.dump(ens, fh, indent=1)
    print("saved model/ensemble.json")


if __name__ == "__main__":
    main()
