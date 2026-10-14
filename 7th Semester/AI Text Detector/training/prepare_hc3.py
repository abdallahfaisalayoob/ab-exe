"""Download + clean the HC3 dataset (Human vs ChatGPT Comparison Corpus).

HC3: Guo et al., 2023, "How Close is ChatGPT to Human Experts?"
https://huggingface.co/datasets/Hello-SimpleAI/HC3

Its human answers (esp. Reddit ELI5) were stored *pre-tokenised*
("you 're", "do n't", "word , word ."). If we left that in, a detector would
just learn "spaces before commas = human". So we detokenise everything first.

Usage:  python training/prepare_hc3.py  [--out training/hc3_clean.jsonl]
"""

import argparse
import json
import os
import random
import re
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from aidetect.text_utils import normalize, words  # noqa: E402

URL = "https://huggingface.co/datasets/Hello-SimpleAI/HC3/resolve/main/all.jsonl"


def detokenize(t):
    t = re.sub(r"\s+(n't|'s|'re|'ve|'ll|'d|'m)\b", r"\1", t, flags=re.I)
    t = re.sub(r"\s+([.,;:!?%)\]])", r"\1", t)
    t = re.sub(r"([(\[$])\s+", r"\1", t)
    t = re.sub(r"(\w)\s+-\s+(\w)", r"\1-\2", t)
    t = re.sub(r'"\s+([^"]*?)\s+"', r'"\1"', t)
    t = re.sub(r"\s*\(\s*URL_\d+\s*\)", "", t)
    t = re.sub(r"URL_\d+", "", t)
    t = re.sub(r"\[\s*([^\]]*?)\s*\]", r"\1", t)
    # missing space after a full stop ("stocks.Small-cap") appears on both sides
    t = re.sub(r"([a-z])\.([A-Z][a-z])", r"\1. \2", t)
    # "\n" stored literally in some answers
    t = t.replace("\\n", "\n")
    return normalize(t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None, help="local all.jsonl (downloaded if omitted)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "hc3_clean.jsonl"))
    ap.add_argument("--per-source", type=int, default=1500,
                    help="max questions per HC3 source, to stop Reddit dominating")
    ap.add_argument("--min-words", type=int, default=40)
    args = ap.parse_args()

    src = args.src
    if src is None:
        src = os.path.join(os.path.dirname(__file__), "hc3_all.jsonl")
        if not os.path.exists(src):
            print("downloading", URL)
            urllib.request.urlretrieve(URL, src)

    rng = random.Random(0)
    by_source = {}
    with open(src, encoding="utf-8") as fh:
        for line in fh:
            d = json.loads(line)
            by_source.setdefault(d.get("source", "?"), []).append(d)

    rows = []
    for source, items in sorted(by_source.items()):
        rng.shuffle(items)
        for qi, d in enumerate(items[: args.per_source]):
            # one human + one ChatGPT answer per question keeps classes balanced
            pairs = [(0, d.get("human_answers") or []), (1, d.get("chatgpt_answers") or [])]
            for label, answers in pairs:
                for a in answers[:1]:
                    text = detokenize(a)
                    if len(words(text)) < args.min_words:
                        continue
                    rows.append({"text": text, "label": label, "source": source,
                                 "qid": f"{source}-{qi}"})

    with open(args.out, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    n_ai = sum(r["label"] for r in rows)
    print(f"wrote {len(rows)} texts ({n_ai} ChatGPT, {len(rows) - n_ai} human) -> {args.out}")


if __name__ == "__main__":
    main()
