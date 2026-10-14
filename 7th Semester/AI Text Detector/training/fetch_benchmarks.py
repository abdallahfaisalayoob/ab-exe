"""Download the public benchmarks and build training/eval_sets.jsonl.

    python training/fetch_benchmarks.py

Sources (all openly licensed):
  * AI Humanizer Benchmark, cycles 2026-09/10 (CC BY 4.0)
      https://huggingface.co/datasets/ai-humanizer-benchmark/ai-humanizer-benchmark
      -> AI source texts + 726 humanized rewrites, each with QuillBot's score
  * TextSight AI-detection benchmark 2026 (CC BY-SA 4.0)
      https://huggingface.co/datasets/textsightai/ai-text-detection-benchmark-2026
      -> genre-matched modern AI text + provably-human Wikipedia/PMC/literature
  * HC3 (human answers only, test questions) - see prepare_hc3.py
"""

import json
import os
import random
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "downloads")
HB = "https://huggingface.co/datasets/ai-humanizer-benchmark/ai-humanizer-benchmark/resolve/main/flat/"
TS = "https://huggingface.co/datasets/textsightai/ai-text-detection-benchmark-2026/resolve/main/data/"


def get(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        print("downloading", url)
        urllib.request.urlretrieve(url, path)
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def main(hc3_path=os.path.join(HERE, "hc3_clean.jsonl"), out=os.path.join(HERE, "eval_sets.jsonl")):
    rng = random.Random(1)
    rows = []

    for t in get(HB + "tests.jsonl", "hb_tests.jsonl"):
        q = t.get("detector_quillbot")
        rows.append({"id": "hum-" + t["cycle"] + "-" + t["test_id"], "set": "humanized",
                     "label": 1, "text": t["output"], "group": t["cycle"] + t["sample_id"],
                     "humanizer": t["humanizer"],
                     "quillbot_ai": None if q in (None, "") else round(1 - float(q), 4)})
    for s in get(HB + "samples.jsonl", "hb_samples.jsonl"):
        rows.append({"id": "src-" + s["cycle"] + "-" + s["sample_id"], "set": "ai_raw",
                     "label": 1, "text": s["text"], "group": s["cycle"] + s["sample_id"],
                     "model": s.get("source_model") or "unknown(2026-09)",
                     "category": s["category"]})

    for r in get(TS + "ai_generated_2026-09-29.jsonl", "ts_ai.jsonl"):
        rows.append({"id": r["id"], "set": "ai_raw", "label": 1, "text": r["text"],
                     "group": r["id"], "model": r["source"], "category": r.get("genre")})
    for f, name, k in [("human_wikipedia_pre2022", "human_wikipedia", None),
                       ("human_pmc_ccby_nonanglophone", "human_esl_academic", None),
                       ("human_literature_publicdomain", "human_literature", 100)]:
        data = get(TS + f + ".jsonl", "ts_" + f + ".jsonl")
        if k:
            data = rng.sample(data, k)
        for r in data:
            rows.append({"id": r["id"], "set": name, "label": 0, "text": r["text"], "group": r["id"]})

    if os.path.exists(hc3_path):
        hc3 = [json.loads(l) for l in open(hc3_path, encoding="utf-8")]
        hum = [r for r in hc3 if r["label"] == 0]
        for i, r in enumerate(rng.sample(hum, 300)):
            rows.append({"id": f"hc3h-{i}", "set": "human_hc3_" + r["source"], "label": 0,
                         "text": r["text"], "group": r["qid"]})
    else:
        print("note: run prepare_hc3.py first to include HC3 human answers")

    with open(out, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    from collections import Counter
    print(Counter(r["set"] for r in rows))
    print("wrote", out)


if __name__ == "__main__":
    import sys
    main(*sys.argv[1:])
