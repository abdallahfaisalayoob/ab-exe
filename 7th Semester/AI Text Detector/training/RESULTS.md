# Evaluation results

Texts scored: 1586 (848 AI, 738 human). Ensemble numbers are 5-fold grouped cross-validation; thresholds set for <= 2% false positives on human text.

## Head-to-head vs QuillBot: 726 humanized AI texts

Share of texts correctly flagged as AI (higher is better). Every text here is AI-written, then rewritten by a commercial humanizer.

| Humanizer | n | QuillBot | Ours (ensemble) |
|---|---:|---:|---:|
| aihumanize | 66 | 5% | 36% |
| cleverhumanizer | 66 | 14% | 76% |
| gptinf | 66 | 11% | 58% |
| hix-bypass | 66 | 6% | 26% |
| rehumanize | 66 | 85% | 95% |
| smarthumanizer | 66 | 9% | 52% |
| stealthgpt | 66 | 33% | 86% |
| superhumanizer | 66 | 21% | 50% |
| undetectable-ai | 66 | 89% | 98% |
| undetectedgpt | 66 | 3% | 56% |
| writehuman | 66 | 3% | 30% |
| **All** | **726** | **25.3%** | **60.3%** |

## Per test set

AI sets: % flagged as AI (want high). Human sets: % wrongly flagged as AI (want low).

| Set | n | ensemble (ours) | desklib | tmr | fakespot | style |
|---|---:|---:|---:|---:|---:|---:|
| ai_raw | 122 | 86.1% | 85.2% | 41.8% | 79.5% | 8.2% |
| humanized | 726 | 60.3% | 60.5% | 30.3% | 35.4% | 3.9% |
| human_esl_academic | 183 | 0.5% | 0.5% | 0.0% | 2.2% | 1.6% |
| human_hc3_finance | 90 | 4.4% | 5.6% | 10.0% | 1.1% | 2.2% |
| human_hc3_medicine | 77 | 6.5% | 6.5% | 2.6% | 0.0% | 0.0% |
| human_hc3_open_qa | 20 | 0.0% | 0.0% | 10.0% | 0.0% | 5.0% |
| human_hc3_reddit_eli5 | 61 | 0.0% | 0.0% | 1.6% | 3.3% | 1.6% |
| human_hc3_wiki_csai | 52 | 1.9% | 1.9% | 0.0% | 1.9% | 0.0% |
| human_literature | 100 | 0.0% | 0.0% | 0.0% | 0.0% | 1.0% |
| human_wikipedia | 155 | 2.6% | 1.3% | 0.0% | 3.9% | 3.9% |
| **AUC (all)** | | **0.940** | **0.943** | **0.791** | **0.783** | **0.662** |

## Raw (unedited) AI text by generating model

| Model | n | Ours |
|---|---:|---:|
| claude-haiku-4-5 | 12 | 100% |
| claude-haiku-4-5-20251001 | 5 | 100% |
| claude-opus-5 | 12 | 17% |
| claude-sonnet-5 | 6 | 100% |
| gemini-2.5-flash | 6 | 100% |
| gemini-3.5-flash | 5 | 80% |
| gpt-4.1 | 12 | 100% |
| gpt-5.6-luna | 6 | 100% |
| gpt-5.6-terra | 5 | 100% |
| gpt-oss-120b | 12 | 100% |
| qwen-3.8-27b | 8 | 38% |
| unknown(2026-09) | 33 | 97% |

## Ensemble weights (on component logits)

| Component | Weight |
|---|---:|
| desklib | 0.757 |
| tmr | -0.042 |
| fakespot | 0.005 |
| style | 0.092 |
| bias | -0.294 |
| decision threshold (probability) | 0.861 |

## Our rule-based humanizer vs each component

122 raw AI texts, rewritten by `aidetect/humanizer.py` (mean 7 edits per text).

| Component | Mean AI-prob before | after | Flagged before (p>=0.5) | after |
|---|---:|---:|---:|---:|
| desklib | 0.95 | 0.89 | 97% | 89% |
| tmr | 0.78 | 0.68 | 80% | 70% |
| fakespot | 0.94 | 0.87 | 95% | 87% |
| style | 0.35 | 0.38 | 36% | 34% |
| **ensemble (at its threshold)** | | | **86%** | **80%** |
