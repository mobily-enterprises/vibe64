"""Usage recording fixture: a command-line run.

  python3 cli.py report      highlights a short sample and prints a summary
  python3 cli.py steps       prints "ready", then highlights a workload once for each line it reads
                             and prints the milliseconds that took, on the clock and in CPU time
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


def steps():
    text = SAMPLE * 40
    highlight(text)  # the first call, with a recorder's declarations of its functions, is no step
    print("ready", flush=True)
    for _ in sys.stdin:
        clock = time.perf_counter()
        cpu = time.process_time()
        highlight(text)
        print("%.4f %.4f" % ((time.perf_counter() - clock) * 1000, (time.process_time() - cpu) * 1000), flush=True)


def probe():
    print(json.dumps({
        "projectSitecustomize": getattr(sys, "fixture_sitecustomize_ran", False),
        "sysPath": sys.path,
        "recorderLoaded": "vibe64_usage" in sys.modules,
        "pid": os.getpid()
    }))


if __name__ == "__main__":
    {"report": report, "steps": steps, "probe": probe}[sys.argv[1]]()
