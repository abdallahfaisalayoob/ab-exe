"""A rule-based "humanizer" - Part 3 of the assignment, as a working demo.

It undoes, one by one, the surface tells the detector looks for:

  1. AI-favoured vocabulary   -> plain everyday synonyms
  2. stock phrases / filler   -> deleted or simplified
  3. transition openers       -> mostly dropped ("Additionally, X" -> "X")
  4. participial tails        -> split into a new sentence
  5. em dashes                -> commas / full stops
  6. no contractions          -> contractions
  7. uniform sentence length  -> split long sentences, merge short ones
                                 (raises "burstiness")
  8. markdown / bullet lists  -> flowing prose

Every edit is logged so the UI can show *what* was changed and *why*.

This is deliberately transparent and limited: it shows the mechanism, and
the detector's re-score shows how far surface edits get you (they move the
stylometric score a lot, the neural classifiers much less). See REPORT.md.
"""

import random
import re

from .text_utils import normalize, sentence_spans, words

SYNONYMS = {
    "delve into": "look at", "delves into": "looks at", "delving into": "looking at",
    "delve": "dig", "utilize": "use", "utilizes": "uses", "utilizing": "using",
    "utilization": "use", "leverage": "use", "leveraging": "using", "leverages": "uses",
    "facilitate": "help", "facilitates": "helps", "commence": "start",
    "endeavor": "try", "endeavors": "efforts", "numerous": "lots of",
    "various": "different", "pivotal": "big", "crucial": "important",
    "crucially": "importantly", "paramount": "most important", "vital": "important",
    "multifaceted": "complicated", "intricate": "complex", "intricacies": "details",
    "nuanced": "subtle", "comprehensive": "full", "robust": "strong",
    "seamless": "smooth", "seamlessly": "smoothly", "holistic": "overall",
    "foster": "build", "fosters": "builds", "fostering": "building",
    "enhance": "improve", "enhances": "improves", "enhancing": "improving",
    "showcase": "show", "showcases": "shows", "showcasing": "showing",
    "underscore": "show", "underscores": "shows", "underscoring": "showing",
    "embark on": "start", "embark": "set out", "navigate": "deal with",
    "navigating": "dealing with", "realm": "area", "landscape": "scene",
    "tapestry": "mix", "testament": "sign", "myriad": "lots of", "plethora": "lot",
    "vibrant": "lively", "bustling": "busy", "meticulous": "careful",
    "meticulously": "carefully", "invaluable": "really useful", "profound": "deep",
    "garner": "get", "boasts": "has", "boast": "have", "captivating": "gripping",
    "significant": "real", "significantly": "a lot", "essential": "key",
    "ensure": "make sure", "ensuring": "making sure", "ensures": "makes sure",
    "individuals": "people", "obtain": "get", "purchase": "buy", "assist": "help",
    "approximately": "about", "demonstrate": "show", "demonstrates": "shows",
    "subsequently": "later", "prior to": "before", "in order to": "to",
    "a wide range of": "all sorts of", "a variety of": "different",
    "cornerstone": "base", "interplay": "mix", "noteworthy": "worth noticing",
    "empower": "help", "empowering": "helping", "harness": "use", "harnessing": "using",
    "unlock": "open up", "elevate": "raise", "streamline": "simplify",
}

DELETE_PHRASES = [
    r"it is important to (?:note|remember|understand) that\s*",
    r"it'?s (?:important|worth) (?:to note |noting |mentioning )?that\s*",
    r"it is worth (?:noting|mentioning) that\s*",
    r"in today'?s (?:fast-paced|digital|modern|ever-changing) world,?\s*",
    r"when it comes to\s+",
    r"i hope this helps[.!]?\s*",
    r"(?:as an ai(?: language model)?,?)\s*",
]

REPLACE_PHRASES = [
    (r"\bit is (?:essential|crucial|vital|important) to\b", "we need to"),
    (r"\bin conclusion,?\s*", "So, "),
    (r"\bin summary,?\s*", "Basically, "),
    (r"\bto summari[sz]e,?\s*", "In short, "),
    (r"\bplays? an? (?:crucial|vital|key|significant|important|pivotal) role in\b", "matters a lot for"),
    (r"\ba testament to\b", "proof of"),
    (r"\bserves as an?\b", "is a"),
    (r"\bstands as an?\b", "is a"),
    (r"\bnot only (.{1,60}?) but also\b", r"\1 and also"),
    (r"\bon the other hand\b", "then again"),
    (r"\bthere are (?:several|many|a number of) (reasons|factors|ways)\b", r"there are a few \1"),
]

TRANSITION_DROP = re.compile(
    r"^(?:Additionally|Furthermore|Moreover|In addition|Notably|Importantly|"
    r"Ultimately|Overall|Consequently|Thus),\s+")

CONTRACTIONS = [
    (r"\bdo not\b", "don't"), (r"\bdoes not\b", "doesn't"), (r"\bdid not\b", "didn't"),
    (r"\bis not\b", "isn't"), (r"\bare not\b", "aren't"), (r"\bwas not\b", "wasn't"),
    (r"\bwere not\b", "weren't"), (r"\bcannot\b", "can't"), (r"\bcan not\b", "can't"),
    (r"\bwill not\b", "won't"), (r"\bwould not\b", "wouldn't"), (r"\bshould not\b", "shouldn't"),
    (r"\bcould not\b", "couldn't"), (r"\bhave not\b", "haven't"), (r"\bhas not\b", "hasn't"),
    (r"\bit is\b", "it's"), (r"\bthat is\b", "that's"), (r"\bthere is\b", "there's"),
    (r"\bwhat is\b", "what's"), (r"\byou are\b", "you're"), (r"\bwe are\b", "we're"),
    (r"\bthey are\b", "they're"), (r"\bI am\b", "I'm"), (r"\bI have\b", "I've"),
    (r"\byou will\b", "you'll"), (r"\bwe will\b", "we'll"), (r"\bit will\b", "it'll"),
    (r"\blet us\b", "let's"),
]

PARTICIPLE = re.compile(
    r",\s+(highlighting|ensuring|making|reflecting|showcasing|underscoring|emphasizing|"
    r"allowing|enabling|fostering|providing|contributing to|creating|offering|"
    r"demonstrating|illustrating|solidifying|cementing|marking)\b([^.!?]*)([.!?])", re.I)

PARTICIPLE_VERB = {
    "highlighting": "That highlights", "ensuring": "That makes sure", "making": "That makes",
    "reflecting": "That reflects", "showcasing": "That shows", "underscoring": "That shows",
    "emphasizing": "That stresses", "allowing": "That lets", "enabling": "That lets",
    "fostering": "That builds", "providing": "That gives", "contributing to": "That adds to",
    "creating": "That creates", "offering": "That offers", "demonstrating": "That shows",
    "illustrating": "That shows", "solidifying": "That locks in", "cementing": "That locks in",
    "marking": "That marks",
}

OPENERS = ["Honestly, ", "Thing is, ", "And ", "But ", "Plus, ", "Still, ", "Really, "]


def _case_like(src, repl):
    if src[:1].isupper():
        return repl[:1].upper() + repl[1:]
    return repl


def humanize(text, strength=1.0, seed=0):
    """Return {"text": new_text, "edits": [{"kind", "before", "after"}...]}."""
    rng = random.Random(seed)
    text = normalize(text)
    edits = []

    def log(kind, before, after):
        if before != after:
            edits.append({"kind": kind, "before": before.strip(), "after": after.strip()})

    # 8. markdown -> prose
    def unbullet(m):
        log("Removed list formatting", m.group(0), "")
        return ""
    text = re.sub(r"(?m)^\s*(?:[-*•]|\d+[.)])\s+", unbullet, text)
    text = re.sub(r"\*\*([^*]+)\*\*:?", lambda m: (log("Removed bold heading", m.group(0), m.group(1)), m.group(1))[1], text)
    text = re.sub(r"(?m)^#{1,6}\s*", "", text)

    # 2. stock phrases
    for pat in DELETE_PHRASES:
        def _del(m):
            log("Deleted filler phrase", m.group(0), "")
            return ""
        text = re.sub(pat, _del, text, flags=re.I)
    for pat, repl in REPLACE_PHRASES:
        def _rep(m, repl=repl):
            new = _case_like(m.group(0), m.expand(repl))
            log("Simplified stock phrase", m.group(0), new)
            return new
        text = re.sub(pat, _rep, text, flags=re.I)

    # 1. vocabulary (longest keys first so "delve into" beats "delve")
    for key in sorted(SYNONYMS, key=len, reverse=True):
        def _syn(m, key=key):
            new = _case_like(m.group(0), SYNONYMS[key])
            log("Plain word for AI-favoured word", m.group(0), new)
            return new
        text = re.sub(r"\b" + re.escape(key) + r"\b", _syn, text, flags=re.I)

    # 4. participial tails -> separate sentence
    def _part(m):
        verb = m.group(1).lower()
        new = ". " + PARTICIPLE_VERB.get(verb, "That's") + m.group(2) + m.group(3)
        log("Split participial tail", m.group(0), new)
        return new
    text = PARTICIPLE.sub(_part, text)

    # 5. em dashes
    def _dash(m):
        log("Replaced em dash", m.group(0), ", ")
        return ", "
    text = re.sub(r"\s*(?:—|--|\s–\s)\s*", _dash, text)

    # 6. contractions
    for pat, repl in CONTRACTIONS:
        def _con(m, repl=repl):
            new = _case_like(m.group(0), repl)
            log("Added contraction", m.group(0), new)
            return new
        text = re.sub(pat, _con, text)

    # 3 + 7. sentence-level: drop transitions, vary length
    out_paras = []
    for para in re.split(r"\n\s*\n", text):
        spans = sentence_spans(para)
        sents = [para[s:e].strip() for s, e in spans]
        new = []
        i = 0
        while i < len(sents):
            s = sents[i]
            m = TRANSITION_DROP.match(s)
            if m and rng.random() < 0.8 * strength:
                rest = s[m.end():]
                s2 = rest[:1].upper() + rest[1:]
                log("Dropped transition opener", m.group(0), "")
                s = s2
            n = len(words(s))
            # split a long sentence at ", and" / ", which" / "; "
            if n > 26 and rng.random() < strength:
                parts = re.split(r";\s+|,\s+(?=(?:and|but|which|so|while)\b)", s, maxsplit=1)
                if len(parts) == 2 and len(words(parts[0])) > 6 and len(words(parts[1])) > 6:
                    a = parts[0].rstrip(",;") + "."
                    b = re.sub(r"^(?:and|which)\s+", "", parts[1])
                    b = b[:1].upper() + b[1:]
                    log("Split long sentence", s, a + " " + b)
                    new.extend([a, b])
                    i += 1
                    continue
            # merge two medium sentences into one longer one
            if (i + 1 < len(sents) and 8 <= n <= 16 and 8 <= len(words(sents[i + 1])) <= 16
                    and rng.random() < 0.35 * strength and s.endswith(".")):
                nxt = sents[i + 1]
                merged = s[:-1] + " - " + nxt[:1].lower() + nxt[1:]
                log("Merged short sentences", s + " " + nxt, merged)
                new.append(merged)
                i += 2
                continue
            # occasionally start with a casual opener
            if i > 0 and rng.random() < 0.12 * strength and s[:1].isupper() and not s.startswith("I "):
                op = rng.choice(OPENERS)
                s2 = op + s[:1].lower() + s[1:]
                log("Casual sentence opener", s[:30], s2[:30 + len(op)])
                s = s2
            new.append(s)
            i += 1
        out_paras.append(" ".join(new))
    text = "\n\n".join(p for p in out_paras if p.strip())

    # tidy spacing / punctuation produced by deletions
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r",\s*,", ",", text)
    text = re.sub(r"\.\s*\.", ".", text)
    text = re.sub(r"(^|[.!?]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    return {"text": text, "edits": edits}
