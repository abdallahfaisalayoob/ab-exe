# AI Text Detection: Detector, Findings and Humanizer

**Abdallah Faisal Ayoob · 23i-6058**

This report covers the three parts of the assignment:

1. **Part 1:** build an AI-text detector that runs locally and explains itself (the app in this folder).
2. **Part 2:** what makes writing look AI-generated to a detector.
3. **Part 3:** what a "humanizer" would do to undo it.

All numbers below were produced by the scripts in `training/` and can be re-run.

---

## Part 1: The detector

### Design

I took the approach the assignment allowed: reuse what existing detectors (GPTZero,
QuillBot, Originality, the research literature) already know, and combine it into one
system that runs on a laptop. The result is an **ensemble of four detectors**:

| # | Component | Type | Role |
|---|---|---|---|
| 1 | DeBERTa-v3-large (`desklib/ai-text-detector-v1.01`) | Transformer fine-tuned on RAID (millions of human/AI texts, 11 LLMs, adversarial attacks) | Main signal |
| 2 | RoBERTa (`Oxidane/tmr-ai-text-detector`) | Transformer trained with hard-negative mining (low false positives) | Second opinion, and the per-sentence highlights |
| 3 | RoBERTa (`fakespot-ai/roberta-base-ai-text-detection-v1`) | Transformer trained on a different corpus | Diversity |
| 4 | **Stylometric model (built for this project)** | Logistic regression on 24 hand-designed writing features, trained on 16,000+ texts | Explanations: the "why" |

A small logistic regression (the **stacker**) learns how much to trust each component.
I fit it with **grouped cross-validation** on the evaluation data, so no essay is scored
by a model that saw any version of it. The decision threshold is set so that at most
**2% of human texts** are flagged.

Neural classifiers are accurate but opaque. The stylometric model is weaker but every
number in it means something. Combining them gives both accuracy *and* an explanation. The UI shows:

* an overall AI-likelihood and verdict;
* a **"Why?"** list in plain English (e.g. *"Stock AI phrase: 4× — 'plays a crucial role',
  'it is important to note' …"*);
* the text with **sentence shading** (local AI-likelihood) and **underlined tells**, each
  with a hover explanation;
* a sentence-length chart (burstiness) and a feature table comparing this text with
  typical human and typical AI values.

### Results

{{RESULTS}}

---

## Part 2: What makes text look AI-generated? <a id="part-2"></a>

Detectors look at two different layers. I measured both.

### 2.1 The statistical layer: predictability

A language model writes by repeatedly choosing a **high-probability next token**.
Training (maximum likelihood), decoding (temperature < 1, top-p sampling) and RLHF all push
towards the most "expected" continuation. So AI text has:

* **Low perplexity.** Another language model is rarely surprised by it. GPTZero's first
  version was built on this.
* **Low burstiness.** The surprise is spread evenly. Human writing alternates plain
  sentences with odd, surprising ones.
* **Top-k tokens almost everywhere.** GLTR (Gehrmann et al., 2019) showed that >90% of
  GPT tokens fall in the model's top-10 predictions, while human text frequently goes outside them.

Binoculars (Hans et al., 2024) refines this by comparing the text's perplexity with how
predictable an LLM *expects* such text to be, which removes the effect of topic. I
implemented it with two small Qwen2.5-0.5B models (`aidetect/neural.py`).
{{BINO}}

The fine-tuned classifiers (components 1–3) learn these statistical cues and many
more implicitly. That is why they are much more accurate than any rule list.

### 2.2 The surface layer: style

I measured 24 features on **16,700 texts**:

* **HC3**: the same questions answered by humans and by ChatGPT (Dec 2022), in
  Reddit ELI5, finance, medicine, open QA and computer science;
* **HAP-E**: a human text continued by a human and by GPT-4o, GPT-4o-mini and
  Llama-3-70B-Instruct, across academic, news, fiction, blog, spoken and TV-script genres.
  Same topic and genre on both sides, so only *style* differs.

I also measured the same features on the 2026 test texts (Claude Opus 5 / Sonnet 5, GPT-5.6,
Gemini 3.5, etc.) to see what has changed.

{{FEATURE_TABLE}}

### 2.3 Findings: the list

Ordered roughly by how much each one matters (stylometric weight and effect size).

**Lexical tells (word choice)**

1. **"AI vocabulary."** *delve, crucial, pivotal, foster, leverage, robust, seamless,
   multifaceted, landscape, realm, tapestry, testament, furthermore, moreover,
   additionally, various, comprehensive, ensure, enhance*, about 4× more frequent in AI text.
   RLHF raters rewarded "polished" register, and these words became the model's default
   formal vocabulary.
2. **Stock phrases.** *"It is important to note that", "plays a crucial role in",
   "in today's fast-paced world", "when it comes to", "a wide range of", "in conclusion",
   "I hope this helps"*, about 10× more frequent. The single strongest positive feature.
3. **Hedging.** *may, can, generally, typically, often, various*, about 1.5× more. Models are
   trained to avoid overclaiming.
4. **Safety boilerplate.** *"consult a qualified professional", "it depends on your specific
   situation"*, very common in HC3 medicine and finance answers.

**Sentence-level tells (syntax and rhythm)**

5. **Uniform sentence length (low burstiness).** The coefficient of variation of sentence
   length is about 0.35 for AI and about 0.55 for humans. Humans write 4-word sentences next to
   40-word ones; models settle into 15–25 words every time.
6. **Formulaic openers.** Sentences starting with *Additionally, / Furthermore, / Moreover, /
   However, / Overall,* (3× more), and many sentences starting *The / This / It / These*
   (1.7× more). This gives the "list of facts" rhythm.
7. **Repeated openers.** The same first word reused across sentences.
8. **Participial tails.** *", highlighting the importance of …", ", ensuring that …",
   ", making it …"* tacked onto the end of a clause, about 3.5× more frequent and very common in GPT-4-era text.
9. **Rule of three.** *"A, B, and C"* lists, about 1.75× more.
10. **"Not just X, it's Y" contrasts**, which are rare but highly specific to AI.
11. **Long, comma-chained sentences**, with more commas per sentence.

**Register and voice tells**

12. **No asides.** Parentheses are **2.7× more common in human text**. This is the
    single strongest *human* signal in my model. People interrupt themselves; models don't.
13. **Little first-person voice.** *I / me / my* is about 2.7× more common in human text.
    Models don't have experiences to report.
14. **No mess.** Lower-case "i", missing apostrophes, "!!", "..." and slang are about 6× rarer in AI text.
15. **Longer words.** More 8+ letter words, a more Latinate vocabulary.
16. **Em dashes. A surprising, time-dependent finding.** Popular advice says "em dash = AI".
    In my 2022–2024 training data the opposite holds (human fiction and journalism use far
    more em dashes than ChatGPT-2022 or GPT-4o continuations did). {{EMDASH}} So a tell
    is only valid for the generation of models it was measured on. A detector built on
    old rules ages badly.

**Document-level tells**

17. **Structure and formatting.** Bullet lists, bold headings, a summary sentence at the
    end ("In conclusion…"), and restating the question in the first sentence.
18. **Balanced, neutral stance.** *"On the one hand… on the other hand…"*. The model
    avoids committing to an opinion.
19. **Generic content.** Few specific names, numbers, dates or personal anecdotes, and claims
    that are true but obvious.

### 2.4 Why this matters: false positives

The same features also show up in **formal human writing** and in the writing of
**non-native English speakers**, who use simpler, more predictable vocabulary and a
textbook register. Liang et al. (2023) found that popular detectors flagged over half of
TOEFL essays as AI. My evaluation includes 183 passages from papers by authors in
non-English-speaking countries for exactly this reason: {{ESL}}

---

## Part 3: How a humanizer would undo it <a id="part-3"></a>

A humanizer is the detector run in reverse: for every tell in Part 2, apply a
transformation that removes it while keeping the meaning.

### 3.1 What a humanizer has to do

| Detector looks for | Humanizer does |
|---|---|
| AI vocabulary | Swap for plain, everyday synonyms (*utilize → use, crucial → important, delve into → look at*) |
| Stock phrases / filler | Delete them (*"It is important to note that"* → nothing) or replace them with casual ones |
| Transition openers | Drop most of them; start sentences with *And / But / So* instead |
| Participial tails | Break them into a new sentence (*", highlighting X"* → *". That highlights X"*) |
| Uniform sentence length | **Inject burstiness**: split long sentences, merge or add very short ones |
| Formal register | Contractions, first person, rhetorical questions, parenthetical asides |
| Lists / headings | Rewrite as flowing paragraphs |
| Low perplexity (statistical layer) | Paraphrase with a *different* model at higher temperature, use less predictable word choices, rearrange clause order. This is what changes the token-level statistics the neural detectors rely on. |
| Uniform "perfect" text | Add small imperfections: informal words, an occasional fragment |

The first seven rows are **surface edits**, which are easy to do with rules. The statistical layer
needs a **paraphrasing model** (e.g. DIPPER; Krishna et al., 2023). The strongest
commercial humanizers go one step further and **optimise against detectors**: they
generate several rewrites and keep the one that scores most "human" on a panel of
detectors. That is an adversarial attack, and it is why they beat commercial detectors.
Sadasivan et al. (2023) showed that recursive paraphrasing defeats every detector they tested,
watermarks included.

Cheap tricks such as Unicode homoglyphs (Cyrillic "а" for Latin "a"), zero-width
characters, or deliberate typos also fool some detectors. They are trivially detectable
and count as cheating rather than humanizing.

### 3.2 The demo: a rule-based humanizer

`aidetect/humanizer.py` implements the surface half of the table (8 transformations, every
edit logged). In the app, **Humanize demo** rewrites the text, shows each edit, and
re-scores before and after.

{{HUMANIZER}}

### 3.3 How commercial humanizers do against real detectors

The AI Humanizer Benchmark (October 2026) ran 11 commercial humanizers on the same AI
essays and checked each output with 7 commercial detectors. The share of humanized texts each detector
still caught:

{{COMMERCIAL}}

### 3.4 Takeaways

* Detection and humanizing are an **arms race**. Any fixed list of tells (Part 2) can
  be removed by a fixed list of rewrites (Part 3). This is why modern detectors are
  trained classifiers rather than rule lists, and why they are retrained as new models
  and humanizers appear.
* Humanizers trade **meaning for bypass rate**. In the benchmark, the tool with the best bypass
  (WriteHuman, 98%) kept only 53% of the meaning; the most aggressive rewrites are noticeably
  worse writing.
* A detector score is **evidence, not proof**. Some human texts look AI-like and some AI
  texts look human, so a score should start a conversation (e.g. look at drafts and version
  history), not end one.

---

## References

* Guo et al. (2023). *How Close is ChatGPT to Human Experts?* (HC3 dataset).
* Reinhart et al. (2024). *Do LLMs write like humans? Variation in grammatical and rhetorical styles* (HAP-E corpus).
* Dugan et al. (2024). *RAID: A Shared Benchmark for Robust Evaluation of Machine-Generated Text Detectors.*
* Hans et al. (2024). *Spotting LLMs with Binoculars: Zero-Shot Detection of Machine-Generated Text.*
* Gehrmann, Strobelt & Rush (2019). *GLTR: Statistical Detection and Visualization of Generated Text.*
* Mitchell et al. (2023). *DetectGPT: Zero-Shot Machine-Generated Text Detection using Probability Curvature.*
* Liang et al. (2023). *GPT detectors are biased against non-native English writers.*
* Krishna et al. (2023). *Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense* (DIPPER).
* Sadasivan et al. (2023). *Can AI-Generated Text be Reliably Detected?*
* AI Humanizer Benchmark (2026), cycles 2026-09 and 2026-10. CC BY 4.0.
* TextSight (2026). *AI text detection benchmark 2026.* CC BY-SA 4.0.
