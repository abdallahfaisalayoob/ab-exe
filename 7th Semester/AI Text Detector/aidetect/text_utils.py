"""Tokenisation helpers: sentences, words and character spans."""

import re

WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")

# Abbreviations that end in a period but do not end a sentence.
_ABBREV = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g",
    "i.e", "eg", "ie", "u.s", "u.k", "no", "fig", "approx", "inc", "ltd",
    "co", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept",
    "oct", "nov", "dec", "a.m", "p.m",
}


def normalize(text):
    """Light clean-up applied to every input (training data and user text)."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace(" ", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def sentence_spans(text):
    """Return a list of (start, end) character spans, one per sentence.

    Sentences end at . ! ? (plus closing quotes/brackets) followed by
    whitespace, or at a line break. Bullet lines count as sentences.
    """
    spans = []
    start = 0
    n = len(text)
    i = 0
    while i < n:
        ch = text[i]
        if ch == "\n":
            if text[start:i].strip():
                spans.append((start, i))
            start = i + 1
        elif ch in ".!?":
            j = i + 1
            while j < n and text[j] in ".!?\"'”’)]":
                j += 1
            if j >= n or text[j] in " \n\t":
                if ch == ".":
                    m = re.search(r"([A-Za-z.]+)\.$", text[start:i + 1])
                    prev = m.group(1).lower() if m else ""
                    if prev in _ABBREV or (len(prev) == 1 and prev.isalpha()):
                        i = j
                        continue
                if text[start:j].strip():
                    spans.append((start, j))
                start = j
                i = j
                continue
        i += 1
    if text[start:].strip():
        spans.append((start, n))

    # Trim leading whitespace from each span.
    out = []
    for s, e in spans:
        while s < e and text[s].isspace():
            s += 1
        if s < e:
            out.append((s, e))
    return out


def words(text):
    return WORD_RE.findall(text)


def paragraphs(text):
    return [p for p in re.split(r"\n\s*\n", text) if p.strip()]
