CLASSES = {"keyword": "k", "builtin": "nb", "string": "s", "number": "m", "comment": "c", "operator": "o", "name": "n"}


def format_html(tokens):
    lines = [[]]
    for token in tokens:
        for index, part in enumerate(token.value.split("\n")):
            if index:
                lines.append([])
            if part:
                lines[-1].append(wrap(token.kind, escape(part)))
    return "\n".join(number_line(index, parts) for index, parts in enumerate(lines, 1))


def wrap(kind, text):
    css = CLASSES.get(kind)
    return '<span class="%s">%s</span>' % (css, text) if css else text


def escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def number_line(index, parts):
    return '<span class="ln">%3d</span> %s' % (index, "".join(parts))
