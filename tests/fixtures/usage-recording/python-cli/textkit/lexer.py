import re

KEYWORDS = frozenset(("def", "return", "for", "in", "if", "else", "import", "from", "class", "while"))
BUILTINS = frozenset(("sum", "round", "len", "print", "range", "min", "max"))
RULES = (
    ("comment", re.compile(r"#[^\n]*")),
    ("string", re.compile(r'"""(?:.|\n)*?"""|"[^"\n]*"|\'[^\'\n]*\'')),
    ("number", re.compile(r"\d+(?:\.\d+)?")),
    ("name", re.compile(r"[A-Za-z_]\w*")),
    ("operator", re.compile(r"[-+*/=<>!%]=?|[()\[\]{}:,.]")),
    ("space", re.compile(r"\s+")),
)


class Token:
    __slots__ = ("kind", "value")

    def __init__(self, kind, value):
        self.kind = kind
        self.value = value


def tokenize(text):
    position = 0
    while position < len(text):
        kind, value = match_at(text, position)
        position += len(value)
        yield Token(refine(kind, value), value)


def match_at(text, position):
    for kind, pattern in RULES:
        found = pattern.match(text, position)
        if found:
            return kind, found.group(0)
    return "error", text[position]


def refine(kind, value):
    if kind != "name":
        return kind
    if value in KEYWORDS:
        return "keyword"
    return "builtin" if value in BUILTINS else "name"
