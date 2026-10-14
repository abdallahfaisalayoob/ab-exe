"""Train the stylometric model (logistic regression) on HC3 + HAP-E.

    python training/prepare_hc3.py          # once, downloads + cleans HC3
    python training/prepare_hape.py         # once, downloads HAP-E (GPT-4o etc.)
    python training/train.py                # stylometric model

The model is deliberately simple - standardised features -> logistic
regression - so every weight can be read and explained (that IS part 2 of
the assignment). Only numpy is needed for training; the app itself runs on
the standard library alone.

Split is by question id, so the human and ChatGPT answers to the same
question are always on the same side of the train/test split.

Two constraints keep the explanations honest:
* sign constraint - a feature may only push towards "AI" if AI text has a
  higher average for it (and vice versa). Without it, correlated features
  get flipped signs and the UI would say e.g. "contractions -> AI-like".
* ERA_DEPENDENT features are measured and shown but not learned, because
  their direction changed between model generations (see REPORT.md 2.3).
"""

import argparse
import json
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from aidetect import features as F  # noqa: E402
from aidetect.text_utils import normalize, sentence_spans  # noqa: E402


ERA_DEPENDENT = {"emdash_rate"}


def fit_logreg(X, y, l2=1.0, iters=3000, lr=0.5, signs=None):
    """Logistic regression by gradient descent; optional sign-constrained weights."""
    n, d = X.shape
    w = np.zeros(d)
    b = 0.0
    for _ in range(iters):
        z = X @ w + b
        p = 1 / (1 + np.exp(-z))
        g = p - y
        w -= lr * (X.T @ g / n + l2 * w / n)
        b -= lr * g.mean()
        if signs is not None:
            w = np.where(signs > 0, np.maximum(w, 0), np.where(signs < 0, np.minimum(w, 0), 0.0))
    return w, b


def auc(y, s):
    order = np.argsort(s)
    ranks = np.empty(len(s))
    ranks[order] = np.arange(1, len(s) + 1)
    pos = y == 1
    n1, n0 = pos.sum(), (~pos).sum()
    return (ranks[pos].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def evaluate(name, X, y, src, w, b, out):
    p = 1 / (1 + np.exp(-(X @ w + b)))
    pred = p >= 0.5
    acc = (pred == y).mean()
    res = {"model": name, "n": int(len(y)), "accuracy": round(float(acc), 4),
           "auc": round(float(auc(y, p)), 4),
           "false_positive_rate": round(float(pred[y == 0].mean()), 4),
           "false_negative_rate": round(float((~pred[y == 1]).mean()), 4),
           "per_source": {}}
    for s in sorted(set(src)):
        m = np.array([x == s for x in src])
        res["per_source"][s] = round(float((pred[m] == y[m]).mean()), 4)
    print(json.dumps(res, indent=1))
    out.append(res)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+",
                    default=[os.path.join(HERE, "hc3_clean.jsonl"), os.path.join(HERE, "hape_clean.jsonl")])
    ap.add_argument("--out", default=os.path.join(HERE, "..", "model", "style_weights.json"))
    ap.add_argument("--exclude", default=os.path.join(HERE, "eval_sets.jsonl"),
                    help="texts in this file are held out (they are used by evaluate.py)")
    args = ap.parse_args()

    rows = []
    for path in args.data:
        rows += [json.loads(l) for l in open(path, encoding="utf-8")]
    if os.path.exists(args.exclude):
        held = {json.loads(l)["text"] for l in open(args.exclude, encoding="utf-8")}
        before = len(rows)
        rows = [r for r in rows if r["text"] not in held]
        print(f"excluded {before - len(rows)} texts that appear in the evaluation sets")
    qids = sorted({r["qid"] for r in rows})
    random.Random(42).shuffle(qids)
    test_q = set(qids[: len(qids) // 5])
    train = [r for r in rows if r["qid"] not in test_q]
    test = [r for r in rows if r["qid"] in test_q]
    print(f"train {len(train)}  test {len(test)}")

    names = F.FEATURE_NAMES

    def featurise(rs):
        return np.array([[F.extract(r["text"])[0][k] for k in names] for r in rs])

    Xtr, Xte = featurise(train), featurise(test)
    ytr = np.array([r["label"] for r in train], dtype=float)
    yte = np.array([r["label"] for r in test], dtype=float)

    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
    diff = Xtr[ytr == 1].mean(0) - Xtr[ytr == 0].mean(0)
    signs = np.sign(diff)
    signs[[i for i, k in enumerate(names) if k in ERA_DEPENDENT]] = 0
    w, b = fit_logreg((Xtr - mu) / sd, ytr, signs=signs)

    report = []
    evaluate("stylometric", (Xte - mu) / sd, yte, [r["source"] for r in test], w, b, report)

    # Per-feature class means (for the write-up)
    Xall = np.vstack([Xtr, Xte])
    yall = np.concatenate([ytr, yte])
    table = []
    for i, k in enumerate(names):
        table.append({"feature": k, "label": F.FEATURE_INFO[k][0],
                      "human_mean": round(float(Xall[yall == 0, i].mean()), 4),
                      "ai_mean": round(float(Xall[yall == 1, i].mean()), 4),
                      "weight": round(float(w[i]), 4)})
    table.sort(key=lambda t: -abs(t["weight"]))
    print("\nfeature                       human     ai   weight")
    for t in table:
        print(f"{t['feature']:<26}{t['human_mean']:>9.3f}{t['ai_mean']:>8.3f}{t['weight']:>9.3f}")

    model = {
        "trained_on": "HC3 (human vs ChatGPT-2022 answers) + HAP-E (human vs GPT-4o / GPT-4o-mini / Llama-3-70B-Instruct continuations)",
        "feature_names": names,
        "mean": mu.round(6).tolist(),
        "std": sd.round(6).tolist(),
        "weights": w.round(6).tolist(),
        "bias": round(float(b), 6),
        "evaluation": report,
        "feature_table": table,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(model, fh, indent=1)
    print("saved", os.path.abspath(args.out))


if __name__ == "__main__":
    main()
