"""Measure what our rule-based humanizer does to each detector component.

    python training/eval_humanizer.py

For every raw AI text in the evaluation set: humanize it, re-score it with
each component, and report the mean score and detection rate before/after.
Results are appended to training/RESULTS.md.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from aidetect import detector, neural  # noqa: E402
from aidetect import features as F  # noqa: E402
from aidetect.humanizer import humanize  # noqa: E402
from aidetect.text_utils import normalize  # noqa: E402


def ensemble_flag(comps):
    import math
    z = detector.ENSEMBLE["bias"]
    for k, w in detector.ENSEMBLE["components"].items():
        p = min(max(comps[k], 1e-4), 1 - 1e-4)
        z += w * math.log(p / (1 - p))
    return 1 / (1 + math.exp(-z)) >= detector.ENSEMBLE["threshold"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", default=os.path.join(HERE, "eval_sets.jsonl"))
    ap.add_argument("--scores", default=os.path.join(HERE, "component_scores.jsonl"))
    ap.add_argument("--results", default=os.path.join(HERE, "RESULTS.md"))
    args = ap.parse_args()

    scores = {}
    for line in open(args.scores, encoding="utf-8"):
        r = json.loads(line)
        scores[r["id"]] = r
    rows = [json.loads(l) for l in open(args.sets, encoding="utf-8")]
    rows = [r for r in rows if r["set"] == "ai_raw" and r["id"] in scores]

    names = ["desklib", "tmr", "fakespot", "style"]
    before = {k: [] for k in names + ["ensemble"]}
    after = {k: [] for k in names + ["ensemble"]}
    n_edits = []
    for i, r in enumerate(rows):
        s = scores[r["id"]]
        b = {k: s[k] for k in names[:3]}
        b["style"] = detector.style_score(s["style"])[0]
        h = humanize(r["text"])
        t = normalize(h["text"])
        a = {k: neural.classify(k, t) for k in names[:3]}
        a["style"] = detector.style_score(F.extract(t)[0])[0]
        for k in names:
            before[k].append(b[k])
            after[k].append(a[k])
        before["ensemble"].append(ensemble_flag(b))
        after["ensemble"].append(ensemble_flag(a))
        n_edits.append(len(h["edits"]))
        if i % 20 == 0:
            print(f"{i}/{len(rows)}", flush=True)

    n = len(rows)
    lines = ["", "## Our rule-based humanizer vs each component", "",
             f"{n} raw AI texts, rewritten by `aidetect/humanizer.py` "
             f"(mean {sum(n_edits) / n:.0f} edits per text).", "",
             "| Component | Mean AI-prob before | after | Flagged before (p>=0.5) | after |",
             "|---|---:|---:|---:|---:|"]
    for k in names:
        mb, ma = sum(before[k]) / n, sum(after[k]) / n
        fb = sum(p >= 0.5 for p in before[k]) / n
        fa = sum(p >= 0.5 for p in after[k]) / n
        lines.append(f"| {k} | {mb:.2f} | {ma:.2f} | {fb:.0%} | {fa:.0%} |")
    lines.append(f"| **ensemble (at its threshold)** | | | **{sum(before['ensemble']) / n:.0%}** | "
                 f"**{sum(after['ensemble']) / n:.0%}** |")
    print("\n".join(lines))
    with open(args.results, "a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
