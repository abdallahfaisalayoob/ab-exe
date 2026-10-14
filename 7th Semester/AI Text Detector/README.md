# AI Text Detector

An offline, explainable AI-text detector that runs on a laptop. Paste text, and it tells you
how likely it is to be AI-generated and **why**: it highlights the phrases, words and
sentence patterns that gave it away. It also includes a "humanizer" demo that rewrites the
text to remove those tells, then re-scores it.

* **Part 1:** the detector (this app)
* **Part 2:** what makes text look AI-written → [`REPORT.md`](REPORT.md#part-2)
* **Part 3:** how a humanizer undoes it → [`REPORT.md`](REPORT.md#part-3) and the
  *Humanize demo* button

## Quick start

**Windows:** double-click `run_windows.bat`
**macOS / Linux:** `./run_mac_linux.sh`

The first run creates a virtual environment and installs `torch` + `transformers`. The first
analysis downloads the detector models (~2.2 GB, once). After that, everything runs
offline. The app opens at <http://127.0.0.1:8765>.

Manual alternative:

```bash
pip install -r requirements.txt
python app.py            # full mode
python app.py --fast     # stylometry only: no installs, starts instantly, less accurate
```

> **Before a demo:** run the app once at home on Wi-Fi so the models are downloaded and
> cached. Then it works with no internet.

## How it works

```
             ┌──────────────────────────────┐
  text ───►  │ DeBERTa-v3-large classifier  │──┐
             │ RoBERTa classifier (TMR)     │──┤   logistic-regression
             │ RoBERTa classifier (Fakespot)│──┼─► ensemble  ──► AI %  + verdict
             │ Stylometric model (ours)     │──┘   (weights fit by
             └──────────────────────────────┘    training/evaluate.py)
                         │
                         └─► 24 writing features + regex markers ──► "Why?" panel
                                                                    + highlights
```

| Component | What it is | Why it's there |
|---|---|---|
| `desklib/ai-text-detector-v1.01` | DeBERTa-v3-large fine-tuned on RAID (6M+ texts, 11 LLMs, adversarial attacks) | strongest single detector; same kind of model commercial detectors use |
| `Oxidane/tmr-ai-text-detector` | RoBERTa-base trained with hard-negative mining | low false positives; also drives sentence-level shading |
| `fakespot-ai/roberta-base-ai-text-detection-v1` | RoBERTa-base trained on a different corpus | a different "opinion" for the ensemble |
| Stylometric model | Logistic regression over 24 interpretable features, trained here on 16k texts (HC3 + HAP-E) | explains the verdict; Part 2 findings |
| Binoculars (optional, `aidetect/neural.py`) | Zero-shot: Qwen2.5-0.5B base vs instruct | studied in the report; see RESULTS for whether it earned a place |

Long texts are split into ~300-word chunks and averaged. Sentence shading comes from a
3-sentence sliding window.

## Accuracy

See [`training/RESULTS.md`](training/RESULTS.md). It includes the head-to-head against
**QuillBot's AI detector** on the same 726 humanized AI texts from the AI Humanizer
Benchmark (Oct 2026), and false-positive rates on ~950 provably human texts (Wikipedia
before 2022, papers by non-native English speakers, Reddit/finance/medical answers, and
classic literature).

## Reproducing the training

```bash
pip install -r requirements.txt
python training/prepare_hc3.py          # HC3: human vs ChatGPT answers
python training/prepare_hape.py         # HAP-E: human vs GPT-4o / Llama-3 continuations
python training/fetch_benchmarks.py     # evaluation sets (+ QuillBot verdicts)
python training/train.py                # stylometric model -> model/style_weights.json
python training/score_components.py     # run all detectors on the eval sets (slow on CPU)
python training/evaluate.py             # ensemble -> model/ensemble.json + RESULTS.md
```

## Project layout

```
app.py                 local web server (standard library only)
static/index.html      the UI
aidetect/
  features.py          24 stylometric features + highlight markers
  detector.py          ensemble, explanations, sentence scores
  neural.py            transformer classifiers + Binoculars
  humanizer.py         rule-based humanizer (Part 3 demo)
  text_utils.py        sentence/word splitting
model/                 trained weights (JSON)
training/              data prep, training, evaluation scripts + RESULTS.md
samples/               demo texts (see samples/SOURCES.md)
REPORT.md              Parts 2 and 3 write-up
```

## Limitations (say these out loud in the demo)

* No detector is proof. A few percent of human texts **will** be flagged, more often for
  formal or non-native writing. Treat the score as evidence, not a verdict.
* Under ~100 words, every detector, including this one, is unreliable.
* Heavily humanized or hand-edited AI text is the hardest case; see RESULTS.md.
