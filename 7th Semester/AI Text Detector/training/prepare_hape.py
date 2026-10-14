"""Download + convert HAP-E (Human-AI Parallel English corpus) for training.

Reinhart et al. 2024, "Do LLMs write like humans?"  (MIT licence)
https://huggingface.co/datasets/browndw/human-ai-parallel-corpus

Each document has a real human continuation ("chunk 2") and continuations
written by LLMs that were shown chunk 1. Same topic, same genre - so a
classifier has to learn *style*, not subject matter. We use the human chunk
and one randomly chosen instruction-tuned model per document (GPT-4o,
GPT-4o-mini, Llama-3-70B-Instruct): modern chat-assistant style, which HC3
(ChatGPT, Dec 2022) does not cover.

    python training/prepare_hape.py [--n 3000]      (needs pyarrow)
"""

import argparse
import json
import os
import random
import sys
import urllib.request

import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from aidetect.text_utils import normalize  # noqa: E402

URL = "https://huggingface.co/datasets/browndw/human-ai-parallel-corpus/resolve/main/text_data/hape-text_{}.parquet"
AI_MODELS = ["gpt-4o-2024-08-06", "gpt-4o-mini-2024-07-18", "llama-3-70B-Instruct"]


def load(name, cache):
    path = os.path.join(cache, name + ".parquet")
    if not os.path.exists(path):
        os.makedirs(cache, exist_ok=True)
        print("downloading", name)
        urllib.request.urlretrieve(URL.format(name), path)
    return {r["doc_id"].split("@")[0]: r["text"] for r in pq.read_table(path).to_pylist()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(HERE, "downloads"))
    ap.add_argument("--out", default=os.path.join(HERE, "hape_clean.jsonl"))
    ap.add_argument("--n", type=int, default=3000, help="documents to sample")
    args = ap.parse_args()

    human = load("human-chunk-2", args.cache)
    ai = {m: load(m, args.cache) for m in AI_MODELS}
    rng = random.Random(3)
    docs = sorted(d for d in human if all(d in ai[m] for m in AI_MODELS))
    rng.shuffle(docs)
    with open(args.out, "w", encoding="utf-8") as fh:
        for d in docs[: args.n]:
            m = rng.choice(AI_MODELS)
            genre = d.split("_")[0]
            for label, text, src in [(0, human[d], "hape_" + genre), (1, ai[m][d], "hape_" + genre)]:
                fh.write(json.dumps({"text": normalize(text), "label": label, "source": src,
                                     "qid": "hape-" + d, "model": m if label else "human"}) + "\n")
    print("wrote", 2 * min(args.n, len(docs)), "texts ->", args.out)


if __name__ == "__main__":
    main()
