"""Connected development for pip (and uv's pip interface).

    python3 tooling/connected.py prepare <sourcesFile>
    python3 tooling/connected.py verify  <sourcesFile>

prepare: creates the untracked virtual environment .venv and installs the
tracked requirements.txt together with an editable install (`-e <sourceRoot>`)
of every connected source, in one resolution, so the connected checkout
satisfies the app's normal requirement. Nothing tracked is written.

verify: proves, inside .venv, that each connected distribution is an editable
install of its sourceRoot (PEP 610 direct_url.json), that its modules import
from that checkout, and that the environment's requirements are consistent.

The installer is pip by default; set CONNECTED_PYTHON_INSTALLER=uv to use
`uv venv` / `uv pip install` instead.
"""

import json
import os
import shutil
import subprocess
import sys
import tomllib

CONTRACT = "vibe64.connected-sources.v1"
TYPES = {"pip", "uv", "python"}
VENV = ".venv"
VENV_PYTHON = os.path.join(VENV, "bin", "python")
REQUIREMENTS = "requirements.txt"


def fail(message):
    print(f"connected: {message}", file=sys.stderr)
    sys.exit(1)


def run(command, shown=None):
    print("+ " + (shown or " ".join(command)), file=sys.stderr, flush=True)
    if subprocess.run(command).returncode != 0:
        fail(f"{command[0]} failed")


def installer():
    name = os.environ.get("CONNECTED_PYTHON_INSTALLER", "pip")
    if name not in ("pip", "uv"):
        fail(f"CONNECTED_PYTHON_INSTALLER must be pip or uv, not {name}")
    if name == "uv" and shutil.which("uv") is None:
        fail("uv is not installed")
    return name


def connected_sources(sources_file):
    try:
        with open(sources_file, encoding="utf-8") as handle:
            sources = json.load(handle)
    except (OSError, ValueError) as error:
        fail(f"cannot read {sources_file}: {error}")
    if sources.get("contract") != CONTRACT:
        fail(f"{sources_file} is not a {CONTRACT} sources map")
    found = []
    for project in sources.get("projects", []):
        if project.get("type", "pip") not in TYPES:
            continue
        root = os.path.realpath(project.get("sourceRoot", ""))
        pyproject = os.path.join(root, "pyproject.toml")
        if not os.path.isfile(pyproject):
            fail(f"connected source has no pyproject.toml: {root}")
        with open(pyproject, "rb") as handle:
            name = tomllib.load(handle).get("project", {}).get("name")
        if not name:
            fail(f"{pyproject} has no [project] name")
        found.append({"name": name, "root": root})
    if not found:
        fail(f"{sources_file} lists no Python projects")
    return found


def prepare(sources_file):
    sources = connected_sources(sources_file)
    tool = installer()
    if not os.path.exists(VENV_PYTHON):
        if tool == "uv":
            run(["uv", "venv", "--quiet", "--python", sys.executable, VENV])
        else:
            run([sys.executable, "-m", "venv", VENV])
    editables = [arg for source in sources for arg in ("-e", source["root"])]
    requirements = ["-r", REQUIREMENTS] if os.path.isfile(REQUIREMENTS) else []
    # One resolution: the editable checkout satisfies the app's own
    # requirement on the same distribution name (and must match its version
    # range), while every other requirement resolves normally.
    if tool == "uv":
        run(["uv", "pip", "install", "--python", VENV_PYTHON, *requirements, *editables])
    else:
        run([VENV_PYTHON, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
             *requirements, *editables])


PROBE = r"""
import importlib, importlib.metadata as md, json, os, pkgutil, sys, urllib.parse, urllib.request
name, root = sys.argv[1], sys.argv[2]
dist = md.distribution(name)
direct = json.loads(dist.read_text("direct_url.json") or "null")
if not direct or not direct.get("dir_info", {}).get("editable"):
    sys.exit(f"{name} is not an editable install")
url = urllib.parse.urlparse(direct["url"])
if url.scheme != "file" or os.path.realpath(urllib.request.url2pathname(url.path)) != root:
    sys.exit(f"{name} is installed from {direct['url']}, not {root}")
inside = lambda path: os.path.realpath(path).startswith(root + os.sep)
modules = set((dist.read_text("top_level.txt") or "").split())
for entry in sys.path:
    if entry and inside(entry):
        modules.update(m.name for m in pkgutil.iter_modules([entry]))
imported = []
for module in sorted(modules):
    loaded = importlib.import_module(module)
    if not inside(loaded.__file__):
        sys.exit(f"{module} imports from {loaded.__file__}, not {root}")
    imported.append(module)
if not imported:
    sys.exit(f"no module of {name} imports from {root}")
print(f"verified {name} {dist.version} editable -> {root} (imports {', '.join(imported)})")
"""


def verify(sources_file):
    sources = connected_sources(sources_file)
    if not os.path.exists(VENV_PYTHON):
        fail("not prepared: run prepare first")
    for source in sources:
        run([VENV_PYTHON, "-c", PROBE, source["name"], source["root"]],
            f"{VENV_PYTHON} -c <editable probe> {source['name']} {source['root']}")
    if installer() == "uv":
        run(["uv", "pip", "check", "--python", VENV_PYTHON])
    else:
        run([VENV_PYTHON, "-m", "pip", "check", "--disable-pip-version-check"])


def main(argv):
    if len(argv) != 3 or argv[1] not in ("prepare", "verify"):
        fail(f"usage: python3 {argv[0]} prepare|verify <sourcesFile>")
    (prepare if argv[1] == "prepare" else verify)(argv[2])


if __name__ == "__main__":
    main(sys.argv)
