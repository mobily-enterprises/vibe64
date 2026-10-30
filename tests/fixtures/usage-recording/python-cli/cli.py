"""Usage recording fixture: a command-line run.

  python3 cli.py report      highlights a short sample and prints a summary
  python3 cli.py bench       prints the milliseconds a highlighting workload took
  python3 cli.py probe       prints what the interpreter started with, as JSON
"""
import json
import os
import sys
import time

from textkit import highlight

SAMPLE = '''
def total(items, rate=0.2):
    """Sum the prices."""
    subtotal = sum(item["price"] * item.get("quantity", 1) for item in items)
    return round(subtotal * (1 + rate), 2)  # tax included
'''


def report():
    html = highlight(SAMPLE)
    print("%d characters of HTML" % len(html))


def bench():
    text = SAMPLE * 40
    started = time.perf_counter()
    for _ in range(25):
        highlight(text)
    print(round((time.perf_counter() - started) * 1000, 3))


def probe():
    print(json.dumps({
        "projectSitecustomize": getattr(sys, "fixture_sitecustomize_ran", False),
        "sysPath": sys.path,
        "recorderLoaded": "vibe64_usage" in sys.modules,
        "pid": os.getpid()
    }))


if __name__ == "__main__":
    {"report": report, "bench": bench, "probe": probe}[sys.argv[1]]()
