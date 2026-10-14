"""Stylometric features that separate human writing from LLM writing.

Every feature is a single number computed from the text, so the final
verdict can always be traced back to measurable evidence. `MARKERS` are
the regex patterns used both for counting and for highlighting.
"""

import math
import re
import statistics

from .text_utils import normalize, paragraphs, sentence_spans, words

# --------------------------------------------------------------------------
# Lexicons
# --------------------------------------------------------------------------

# Words that LLMs (ChatGPT, Claude, Gemini...) over-use relative to people.
AI_VOCAB = [
    "delve", "delves", "delving", "tapestry", "testament", "pivotal",
    "crucial", "crucially", "realm", "landscape", "navigate", "navigating",
    "foster", "fosters", "fostering", "leverage", "leveraging", "multifaceted",
    "nuanced", "intricate", "intricacies", "seamless", "seamlessly", "robust",
    "holistic", "underscore", "underscores", "underscoring", "showcase",
    "showcases", "showcasing", "embark", "comprehensive", "furthermore",
    "moreover", "additionally", "notably", "vibrant", "bustling",
    "paramount", "unwavering", "resonate", "resonates", "elevate", "streamline",
    "harness", "harnessing", "unlock", "unlocking", "empower", "empowering",
    "meticulous", "meticulously", "commendable", "invaluable", "endeavor",
    "endeavors", "enhance", "enhancing", "facilitate", "facilitates", "utilize",
    "utilizing", "utilization", "various", "numerous", "significant",
    "significantly", "essential", "ensure", "ensuring", "overall", "ultimately",
    "key", "vital", "dynamic", "innovative", "insights", "garner", "boast",
    "boasts", "captivating", "profound", "plethora", "myriad", "realm",
    "evolving", "ever-evolving", "interplay", "cornerstone", "align", "aligns",
    "crucial", "noteworthy", "intrinsic", "encompass", "encompasses",
    "nestled", "beacon", "symphony", "embrace", "embracing",
]
AI_VOCAB = sorted(set(AI_VOCAB))

# Multi-word stock phrases typical of assistant-style answers.
AI_PHRASES = [
    r"it is important to (?:note|remember|consider|understand)",
    r"it'?s (?:important|worth) (?:to note|noting|mentioning)",
    r"it is worth (?:noting|mentioning)",
    r"in today'?s (?:fast-paced|digital|modern|ever-changing|world)",
    r"plays? an? (?:crucial|vital|key|significant|important|pivotal) role",
    r"in conclusion",
    r"in summary",
    r"to summari[sz]e",
    r"overall,",
    r"a testament to",
    r"rich tapestry",
    r"navigate the complexities",
    r"when it comes to",
    r"there are (?:several|many|a few|a number of) (?:reasons|factors|ways|things)",
    r"(?:can|may) vary (?:depending|significantly|widely)",
    r"depending on (?:the|your) (?:specific|individual|particular)",
    r"a (?:wide|broad) (?:range|variety) of",
    r"a number of (?:factors|reasons|different)",
    r"(?:serves|stands) as an?",
    r"let'?s (?:dive|delve|explore|break)",
    r"i hope this helps",
    r"as an ai(?: language model)?",
    r"not only\b[^.]{1,80}\bbut also",
    r"(?:it'?s|this is) not (?:just|only|merely) (?:about )?[^.,;]{1,40}[,;—-]+ (?:it'?s|but)",
    r"whether you'?re",
    r"on the other hand",
    r"(?:is|are) generally considered",
    r"(?:helps?|help) to (?:ensure|maintain|improve|reduce)",
    r"(?:it|this) is (?:also )?(?:possible|likely) that",
    r"(?:you|one) (?:may|might) (?:want|wish) to",
    r"(?:consult|speak) with a (?:qualified|healthcare|financial|medical|professional)",
    r"if you have any (?:further |other )?(?:questions|concerns)",
]

TRANSITIONS = [
    "additionally", "furthermore", "moreover", "however", "overall",
    "ultimately", "in addition", "consequently", "therefore", "thus",
    "in conclusion", "in summary", "notably", "importantly", "similarly",
    "finally", "firstly", "secondly", "lastly", "as a result", "for example",
    "for instance", "on the other hand", "in contrast", "nevertheless",
]

HEDGES = [
    "may", "might", "can", "could", "generally", "typically", "often",
    "usually", "various", "several", "potentially", "likely", "certain",
    "some", "tend", "tends", "possible",
]

INFORMAL = [
    "lol", "lmao", "tbh", "imo", "imho", "idk", "kinda", "sorta", "gonna",
    "wanna", "gotta", "yeah", "yep", "nope", "dunno", "ok", "okay", "stuff",
    "like", "pretty", "basically", "literally", "honestly", "actually",
    "guess", "anyway", "anyways", "dude", "guys", "huh", "hmm", "ugh", "wow",
    "omg", "btw", "cuz", "cause", "u", "ur", "thats", "dont", "im", "ive",
    "cant", "wont", "didnt", "isnt", "doesnt", "edit", "iirc", "afaik",
]

FIRST_PERSON = {"i", "me", "my", "mine", "myself"}

_vocab_re = re.compile(r"\b(?:" + "|".join(re.escape(w) for w in AI_VOCAB) + r")\b", re.I)
_phrase_re = re.compile("|".join("(?:" + p + ")" for p in AI_PHRASES), re.I)
_transition_re = re.compile(
    r"^\W*(?:" + "|".join(re.escape(t) for t in TRANSITIONS) + r")\b,?", re.I)
_participle_re = re.compile(
    r",\s+(?:highlighting|ensuring|making|reflecting|showcasing|underscoring|"
    r"emphasizing|emphasising|allowing|enabling|fostering|providing|"
    r"contributing|creating|offering|leading|resulting|demonstrating|"
    r"illustrating|solidifying|cementing|signaling|signalling|marking)\b", re.I)
_triplet_re = re.compile(
    r"\b[\w-]+(?:\s[\w-]+){0,2},\s[\w-]+(?:\s[\w-]+){0,2},?\s(?:and|or)\s[\w-]+", re.I)
_emdash_re = re.compile(r"—|–(?=\s)|\s--\s|(?<=\w)--(?=\w)")
_contraction_re = re.compile(r"\b\w+['’](?:t|s|re|ve|ll|d|m)\b", re.I)
_markdown_re = re.compile(r"(?m)^\s*(?:[-*•]\s+|\d+[.)]\s+|#{1,6}\s)|\*\*[^*]+\*\*")
_contrast_re = re.compile(
    r"\bnot (?:just|only|merely|simply)\b[^.!?]{1,60}?[,;—]\s*(?:but|it'?s|it is)\b", re.I)

# Patterns used for in-text highlighting: (key, regex, label, explanation)
MARKERS = [
    ("phrase", _phrase_re, "Stock AI phrase",
     "Formulaic phrase that chat assistants use far more than people do."),
    ("vocab", _vocab_re, "AI-favoured word",
     "Word that is statistically over-represented in LLM output."),
    ("participle", _participle_re, "Participial tail",
     "', highlighting/ensuring/making ...' tacked on to the end of a clause - "
     "a very common LLM sentence shape."),
    ("transition", _transition_re, "Transition opener",
     "Sentence opens with a formal connective (Additionally, Furthermore...). "
     "LLMs chain sentences this way; people mostly just start talking."),
    ("emdash", _emdash_re, "Em dash",
     "Em dashes are heavily over-used by modern LLMs."),
    ("contrast", _contrast_re, "'Not just X, but Y'",
     "Rhetorical contrast template ('It's not just X - it's Y')."),
    ("triplet", _triplet_re, "Rule of three",
     "Lists of exactly three items ('A, B, and C') appear much more in LLM text."),
    ("markdown", _markdown_re, "List / markdown formatting",
     "Bullet points, numbered lists and **bold** headings are typical chat-assistant layout."),
]

# --------------------------------------------------------------------------
# Feature definitions
# --------------------------------------------------------------------------

# name -> (label, description of what a HIGH value means)
FEATURE_INFO = {
    "sent_len_mean": ("Average sentence length",
                      "Average words per sentence."),
    "sent_len_cv": ("Burstiness (sentence-length variation)",
                    "How much sentence lengths vary. Humans mix very short and very long "
                    "sentences; LLMs produce evenly sized ones."),
    "sent_len_short": ("Very short sentences",
                       "Share of sentences with 6 words or fewer."),
    "avg_word_len": ("Average word length",
                     "Average characters per word; LLMs prefer longer, Latinate words."),
    "long_word_ratio": ("Long-word ratio",
                        "Share of words with 8+ letters."),
    "mattr": ("Vocabulary diversity (MATTR)",
              "Moving-average type/token ratio over 50-word windows."),
    "contraction_rate": ("Contractions",
                         "Contractions (don't, it's, I'm) per 100 words. LLMs default to a formal "
                         "register and contract less."),
    "first_person_rate": ("First-person voice",
                          "I / me / my per 100 words. People write from personal experience."),
    "informal_rate": ("Informal / slang words",
                      "Slang, fillers and chatty words per 100 words."),
    "lowercase_i": ("Lower-case 'i' and sloppy typing",
                    "Lower-case 'i', missing apostrophes, doubled punctuation - human sloppiness."),
    "exclaim_q_rate": ("Exclamations & questions",
                       "Share of sentences ending in ! or ?."),
    "paren_rate": ("Parentheses / asides",
                   "Parenthetical asides per sentence."),
    "comma_per_sent": ("Commas per sentence",
                       "LLM sentences are long and comma-chained."),
    "ai_vocab_rate": ("AI-favoured vocabulary",
                      "Words like 'delve', 'crucial', 'additionally', 'various' per 100 words."),
    "ai_phrase_rate": ("Stock AI phrases",
                       "Phrases like 'it is important to note', 'plays a crucial role' per 100 words."),
    "transition_rate": ("Transition-word sentence openers",
                        "Share of sentences that start with Additionally/Furthermore/However..."),
    "hedge_rate": ("Hedging words",
                   "may / can / generally / typically / various per 100 words."),
    "triplet_rate": ("Rule-of-three lists",
                     "'A, B, and C' lists per sentence."),
    "participle_rate": ("Participial tails",
                        "', highlighting/ensuring ...' endings per sentence."),
    "emdash_rate": ("Em dashes",
                    "Em dashes per 100 words."),
    "contrast_rate": ("'Not just X, but Y' constructions",
                      "Rhetorical contrast templates per sentence."),
    "markdown_rate": ("List / markdown structure",
                      "Bullets, numbered items and bold headings per sentence."),
    "opener_repeat": ("Repetitive sentence openers",
                      "Share of sentences whose first word repeats an earlier sentence's first word."),
    "the_it_start": ("Topic-restating openers",
                     "Share of sentences beginning with The/This/It/These - an expository, "
                     "encyclopaedic rhythm."),
}

FEATURE_NAMES = list(FEATURE_INFO)


def _per100(count, n_words):
    return 100.0 * count / max(n_words, 1)


def _mattr(tokens, window=50):
    """Moving-average type/token ratio, O(n) with a sliding counter."""
    if not tokens:
        return 0.0
    if len(tokens) <= window:
        return len(set(tokens)) / len(tokens)
    counts = {}
    for t in tokens[:window]:
        counts[t] = counts.get(t, 0) + 1
    total = len(counts)
    steps = len(tokens) - window + 1
    for i in range(1, steps):
        out, inc = tokens[i - 1], tokens[i + window - 1]
        counts[out] -= 1
        if not counts[out]:
            del counts[out]
        counts[inc] = counts.get(inc, 0) + 1
        total += len(counts)
    return total / steps / window


def extract(text):
    """Return (features: dict[name -> float], stats: dict) for a text."""
    text = normalize(text)
    spans = sentence_spans(text)
    sents = [text[s:e] for s, e in spans] or [text]
    toks = words(text)
    low = [t.lower() for t in toks]
    nw = len(toks)
    ns = len(sents)

    sent_lens = [len(words(s)) for s in sents]
    sent_lens = [l for l in sent_lens if l > 0] or [0]
    mean_len = statistics.fmean(sent_lens)
    cv = (statistics.pstdev(sent_lens) / mean_len) if mean_len else 0.0

    openers = []
    for s in sents:
        w = words(s)
        if w:
            openers.append(w[0].lower())
    seen, repeats = set(), 0
    for o in openers:
        if o in seen:
            repeats += 1
        seen.add(o)

    sloppy = len(re.findall(r"(?<![A-Za-z'])i(?![A-Za-z'])", text))
    sloppy += len(re.findall(r"[!?]{2,}|\.{3,}|…", text))
    sloppy += len(re.findall(r"\b(?:dont|cant|wont|im|ive|didnt|doesnt|isnt|thats)\b", text))

    f = {
        "sent_len_mean": mean_len,
        "sent_len_cv": cv,
        "sent_len_short": sum(1 for l in sent_lens if l <= 6) / len(sent_lens),
        "avg_word_len": (sum(len(t) for t in toks) / nw) if nw else 0.0,
        "long_word_ratio": (sum(1 for t in toks if len(t) >= 8) / nw) if nw else 0.0,
        "mattr": _mattr(low),
        "contraction_rate": _per100(len(_contraction_re.findall(text)), nw),
        "first_person_rate": _per100(sum(1 for t in low if t in FIRST_PERSON), nw),
        "informal_rate": _per100(sum(1 for t in low if t in INFORMAL), nw),
        "lowercase_i": _per100(sloppy, nw),
        "exclaim_q_rate": sum(1 for s in sents if s.rstrip("\"')” ").endswith(("!", "?"))) / ns,
        "paren_rate": text.count("(") / ns,
        "comma_per_sent": text.count(",") / ns,
        "ai_vocab_rate": _per100(len(_vocab_re.findall(text)), nw),
        "ai_phrase_rate": _per100(len(_phrase_re.findall(text)), nw),
        "transition_rate": sum(1 for s in sents if _transition_re.search(s)) / ns,
        "hedge_rate": _per100(sum(1 for t in low if t in HEDGES), nw),
        "triplet_rate": len(_triplet_re.findall(text)) / ns,
        "participle_rate": len(_participle_re.findall(text)) / ns,
        "emdash_rate": _per100(len(_emdash_re.findall(text)), nw),
        "contrast_rate": len(_contrast_re.findall(text)) / ns,
        "markdown_rate": len(_markdown_re.findall(text)) / ns,
        "opener_repeat": repeats / max(len(openers), 1),
        "the_it_start": sum(1 for o in openers if o in {"the", "this", "it", "these", "they", "its"})
        / max(len(openers), 1),
    }
    for k, v in f.items():
        if not math.isfinite(v):
            f[k] = 0.0

    stats = {
        "words": nw,
        "sentences": ns,
        "paragraphs": len(paragraphs(text)),
        "sentence_lengths": sent_lens,
    }
    return f, stats


def find_markers(text):
    """Return highlight spans: list of dicts {start, end, key, label, why}."""
    out = []
    for key, rx, label, why in MARKERS:
        if key == "transition":
            for s, e in sentence_spans(text):
                m = rx.search(text[s:e])
                if m:
                    out.append({"start": s + m.start(), "end": s + m.end(),
                                "key": key, "label": label, "why": why})
            continue
        for m in rx.finditer(text):
            st, en = m.start(), m.end()
            if key == "participle":
                st += 1  # skip the comma itself
                while st < en and text[st].isspace():
                    st += 1
            out.append({"start": st, "end": en, "key": key, "label": label, "why": why})

    # Resolve overlaps: earlier MARKERS entries (stronger evidence) win.
    priority = {k: i for i, (k, *_rest) in enumerate(MARKERS)}
    out.sort(key=lambda d: (priority[d["key"]], d["start"]))
    kept = []
    for d in out:
        if d["key"] == "triplet":
            continue  # triplets are counted, but too broad to paint in the text
        if any(not (d["end"] <= k["start"] or d["start"] >= k["end"]) for k in kept):
            continue
        kept.append(d)
    kept.sort(key=lambda d: d["start"])
    return kept
