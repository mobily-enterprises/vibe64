from textkit.formatter import format_html
from textkit.lexer import tokenize


def highlight(text):
    return format_html(tokenize(text))
