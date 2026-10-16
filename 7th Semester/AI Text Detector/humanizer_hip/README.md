# HIP humanizer (Part 3 experiment)

Reproduction of **HIP: Humanization by Iterative Paraphrasing** from
Xu, Zhong, Raghunathan, Fang & Kolter (2026), *Base Models Look Human To AI Detectors*,
[arXiv:2605.19516](https://arxiv.org/abs/2605.19516).

## Why

Our own rewrites, made with a chat model, kept scoring 90-100% on GPTZero. The paper explains this:
detectors like GPTZero recognise the fingerprint that chat/instruction tuning leaves on text, while
**base** models look human (GPTZero rated Llama-3-8B base text 96.7% human and its instruct
version 30.3%). HIP fine-tunes a base model to map AI-style text back to human text, then
applies it for several rounds.

## Files

| File | What |
|---|---|
| `HIP_humanizer_colab.ipynb` | the notebook to run on Google Colab (free T4 GPU) |
| `build_notebook.py` | source of the notebook; `python build_notebook.py --smoke` runs every cell on CPU with tiny models as a test |

## Pipeline

1. ~2,500 real human passages (HAP-E + HC3).
2. Qwen2.5-1.5B-Instruct rewrites each one in AI style, giving pairs of *AI version → human original*.
3. QLoRA fine-tune of **Qwen3-4B-Base** on those pairs (r=64, 1 epoch).
4. 10 rounds of paraphrasing on the input text, keeping every round.
5. Each round is scored with the DeBERTa detector (desklib) plus a meaning-similarity score
   (MiniLM embeddings). The chosen rounds are then tested on GPTZero / ZeroGPT by hand.

Expected trade-off (from the paper): more rounds look more human but drift further from the
original meaning. **Always check facts in the output.**
