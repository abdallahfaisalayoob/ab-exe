"""Run every detector component over the evaluation sets and cache scores.

    python training/score_components.py --sets DIR

Writes one JSON line per text to training/component_scores.jsonl (resumable).
`evaluate.py` then builds the ensemble and the head-to-head vs QuillBot.

Evaluation sets (all downloaded by `fetch_benchmarks.py`):
  humanized    726 AI texts rewritten by 11 commercial "humanizers", each
               with QuillBot's own verdict (AI Humanizer Benchmark, Oct 2026)
  ai_raw       66 unedited essays/posts from Claude, GPT-5.6, Gemini (same
               benchmark) + 56 genre-matched passages from TextSight 2026
  human_*      provably pre-ChatGPT human writing: Wikipedia (<2022),
               non-native-English academic papers, Reddit/finance/medical
               answers (HC3), classic literature
"""

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from aidetect import features as F  # noqa: E402
from aidetect import neural  # noqa: E402
from aidetect.text_utils import normalize  # noqa: E402

COMPONENTS = ["binoculars", "tmr", "desklib", "fakespot"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sets", default=os.path.join(HERE, "eval_sets.jsonl"))
    ap.add_argument("--out", default=os.path.join(HERE, "component_scores.jsonl"))
    ap.add_argument("--only", default=",".join(COMPONENTS))
    args = ap.parse_args()
    comps = args.only.split(",")

    done = {}
    if os.path.exists(args.out):
        for line in open(args.out, encoding="utf-8"):
            r = json.loads(line)
            done[r["id"]] = r
    rows = [json.loads(l) for l in open(args.sets, encoding="utf-8")]
    t0 = time.time()
    with open(args.out, "a", encoding="utf-8") as out:
        for i, r in enumerate(rows):
            rec = done.get(r["id"], {"id": r["id"]})
            if all(c in rec for c in comps) and "style" in rec:
                continue
            text = normalize(r["text"])
            if "style" not in rec:
                rec["style"] = F.extract(text)[0]
            for c in comps:
                if c in rec:
                    continue
                if c == "binoculars":
                    b = neural.binoculars(text)
                    rec[c] = b["score"] if b else None
                else:
                    rec[c] = neural.classify(c, text)
            out.write(json.dumps(rec) + "\n")  # later lines override earlier ones
            out.flush()
            if i % 50 == 0:
                print(f"{i}/{len(rows)}  {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
