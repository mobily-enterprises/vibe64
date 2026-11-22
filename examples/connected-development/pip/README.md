# Connected development: pip (Python)

Proves Vibe64's own `pip` treatment: a consuming Python app uses an unpublished
local checkout of a Python library during connected development without
touching any tracked file, and Save moves the app's pin only once the
checkout's version is published.

## Layout

- `library/` — distribution `acme-library` 1.0.0 (src layout, module
  `acme_library`, `marker()` returns `library 1.0.0`). Its build backend is a
  tiny dependency-free in-tree PEP 517/660 backend (`_build/fixture_backend.py`)
  so that building needs no package index; see Network below.
- `app/` — tracked `requirements.txt` (`acme-library==1.0.0`, an exact pin) and
  `app.py` printing the marker. `genesis/stack.md` declares only
  `- Default package type: `pip``: Vibe64 itself puts the connection in effect;
  the project writes no Prepare or Verify command.
- `prove.sh` — the reproducible acceptance run. It calls
  `../vibe64-adapter.mjs` (the adapter steps workspace preparation runs) and
  `../vibe64-bump.mjs` (what Save asks of the adapter).

## Vibe64's pip treatment

`packages/vibe64-project/src/server/connectedAdapters/pip.js`. An untracked
virtual environment, `.venv` at the session source, plus an editable install
([pip `-e`](https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs),
PEP 660) of each connected checkout, in the same resolution as the app's
tracked requirements.

**Apply** (after the project's Prepare steps):

1. Reads each connected distribution's name and version from
   `sourceRoot/pyproject.toml` (`[project]`).
2. Refuses a tracked `.venv`, and keeps `.venv` and the derived requirements
   out of Git with its own exclude block.
3. Writes the untracked `requirements.connected.txt`: the tracked
   `requirements.txt` with each exact `==` pin of a connected distribution
   commented out. A pin would make the one resolution impossible as soon as
   the checkout's version moves past it, which is the usual state before a
   release; a range stays, so pip still reports a checkout outside it.
4. Creates `.venv` when missing (`python3 -m venv .venv`) and runs
   `.venv/bin/python -m pip install -r requirements.connected.txt -e <sourceRoot>...`.
   The editable wheel's `.pth` file puts `<sourceRoot>/src` on `sys.path`, so
   source edits are live: no watcher, no second preparation.

**Proof** (after the project's Verify steps, and from files alone in session
status): the derived requirements match `requirements.txt`; `.venv` holds the
distribution as an editable install whose PEP 610 `direct_url.json` names
`sourceRoot`. In preparation it also runs a probe in `.venv` (every module of
the distribution imports from inside `sourceRoot`) and `pip check`.

**Save** (`locked` and `bump`): `locked` reads the checkout's version beside the
tracked pin (null for a range), which is what Staging and Production install.
`bump` checks with `pip download --no-deps <name>==<version>` whether the
checkout's version is published where the project installs from; only then it
moves the pin's version in `requirements.txt`, and applies again. An
unpublished version changes nothing; an unreachable index changes nothing and
says so.

**Restore**: once no pip connection remains, preparation removes
`requirements.connected.txt`. pip cannot run there, so an editable install from
a connection that is gone stays in `.venv`; preparation names it and the
command that brings the published package back.

The app runs with the environment's interpreter: `.venv/bin/python app.py`.

## Network

None. `prove.sh` sets `PIP_NO_INDEX=1` (caches in the temp directory), and
"publishes" 1.1.0 as a wheel in a `PIP_FIND_LINKS` folder. This only works
because the library's build backend has no build requirements. A real library
using setuptools, hatchling or flit needs that backend for the editable build:
pip fetches it from the index into an isolated build environment (cached
afterwards). The app's other requirements come from the index as usual.

## Tool versions

Python 3.14.4 (usone, with the venv's bundled pip 25.1.1), Git 2.53.0, Node v26.5.0;
the proof took 10.6 s (run `cad-pyrust-3`, 2026-11-23).
Editable installs of `pyproject.toml` projects need pip >= 21.3 (PEP 660).

## Limitations

- Editable installs make source edits live, but metadata changes in the
  checkout (version, dependencies, entry points, new top-level packages) need
  the workspace prepared again; the proof reports a stale install.
- Only `requirements.txt` at the session source is read. Pins in files it
  includes (`-r`, `-c`) are not left out, so pip reports a conflict there; an
  app declared only by its own `pyproject.toml` gets the editable installs
  without its own requirements.
- A connected checkout needs a static `[project] name` in `pyproject.toml`
  (a `setup.py`-only project is refused), and `bump` needs a static version.
- Some backends' editable modes use import hooks instead of `.pth` path
  entries; the probe then relies on `top_level.txt` if present.
- The app must run with `.venv`'s interpreter (activated, or by path).
- uv is not used: Vibe64's treatment is pip's (the type is `pip`).

## Composition relationship

If the composed repository is itself an installable Python project (a plugin
or sub-package the app imports), the same editable install applies. If it is
raw source composed into the app tree (not a distribution), pip has no native
mechanism; the project's script needs custom treatment (e.g. a `.pth` file in
`.venv` or linking into the expected directory). This fixture proves only the
`dependency` case.

## Transcript (usone, 2026-11-23, temp path shortened to `$WORK`)

```
tools: Python 3.14.4, git version 2.53.0, node v26.5.0
[Connected] Created the session's virtual environment .venv.
[Connected] Library: acme-library installed editable from $WORK/library in .venv.
[Connected] Library: acme-library installed editable from $WORK/library in .venv.
[Connected] Library is in effect.
venv pip: pip 25.1.1
app prints: library 1.0.0 + local change
after another edit: library 1.0.0 + local change, edited again
=== the checkout moves past the app's pin (acme-library==1.0.0)
[Connected] Library: acme-library installed editable from $WORK/library in .venv.
[Connected] Library is in effect.
[{"package":"acme-library","connected":"1.1.0","locked":"1.0.0"}]
=== Save before 1.1.0 is published: nothing moves
bumped: []
=== publish acme-library 1.1.0 (a wheel in the find-links folder), then Save
acme_library-1.1.0-py3-none-any.whl
[Connected] Library: Staging and Production now use the published acme-library 1.1.0.
[Connected] Library: acme-library installed editable from $WORK/library in .venv.
bumped: [{"package":"acme-library","from":"1.0.0","to":"1.1.0"}]
 requirements.txt | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
[Connected] Library is in effect.
app prints: library 1.0.0 + local change, edited again
proof refused: connected proof: Connected Library is not in effect: .venv holds acme-library 1.1.0, not an editable install of $WORK/library; prepare the workspace again.
PASS pip
```
