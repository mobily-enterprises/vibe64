# Connected development: pip and uv (Python)

Proves that a consuming Python app can use an unpublished local checkout of a
Python library during connected development, with pip and with uv's pip
interface, without touching any tracked file.

## Layout

- `library/` — distribution `acme-library` 1.0.0 (src layout, module
  `acme_library`, `marker()` returns `library 1.0.0`). Its build backend is a
  tiny dependency-free in-tree PEP 517/660 backend (`_build/fixture_backend.py`)
  so that building needs no package index; see Network below.
- `app/` — tracked `requirements.txt` (`acme-library>=1.0,<2`) and `app.py`
  printing the marker.
  - `tooling/connected.py` — `prepare <sourcesFile>` / `verify <sourcesFile>`,
    standard library only, no Node.
  - `genesis/stack.md` — the `## Connected development` section.
  - `.gitignore` — `.development/`, `.venv/`, `__pycache__/`.
- `prove.sh` — the reproducible acceptance run (pip, then uv when installed).

## Native mechanism

An untracked virtual environment plus an editable install
([pip `-e`](https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs),
PEP 660), in the same resolution as the app's normal requirements.

`prepare`:

1. Reads the sources map and, for each `type: pip` (also `uv`/`python`)
   project, the distribution name from `sourceRoot/pyproject.toml`.
2. Creates `.venv` if missing (`python3 -m venv .venv`, or with uv
   `uv venv --python <same python3> .venv`).
3. Installs the tracked requirements and every connected source together:
   - pip: `.venv/bin/python -m pip install -r requirements.txt -e <sourceRoot>`
   - uv: `uv pip install --python .venv/bin/python -r requirements.txt -e <sourceRoot>`

   The editable checkout satisfies the app's own requirement on the same name
   (its version must match `>=1.0,<2`, so a genuine incompatibility is
   reported, not hidden); all other requirements resolve normally. The editable
   wheel's `.pth` file puts `<sourceRoot>/src` on `sys.path`, so source edits
   are live.

Select the installer with `CONNECTED_PYTHON_INSTALLER=pip|uv` (default pip).

Nothing tracked is written: the environment lives in git-ignored `.venv/`, and
`requirements.txt`/`pyproject.toml` are only read. uv's project mode
(`uv sync`) would need `[tool.uv.sources]` in the tracked `pyproject.toml`
and rewrites `uv.lock`, so the uv pip interface is the untracked equivalent.

`verify` runs a probe inside `.venv` for each connected distribution: its
PEP 610 `direct_url.json` must say `dir_info.editable: true` with a `file:`
URL equal to `sourceRoot`, and every module of the distribution found on the
checkout's `sys.path` entries must import from inside `sourceRoot`. Then it
runs `pip check` / `uv pip check`. It fails when the environment holds a
non-editable copy or a different checkout.

The app runs with the environment's interpreter: `.venv/bin/python app.py`.

## Commands

```
python3 tooling/connected.py prepare .development/connected.json
python3 tooling/connected.py verify  .development/connected.json
.venv/bin/python app.py
CONNECTED_PYTHON_INSTALLER=uv python3 tooling/connected.py prepare .development/connected.json
```

`./prove.sh` copies `library/` and `app/` to a fresh temporary directory,
commits the app, changes the library copy's marker, writes the sources map,
then for pip and for uv: removes `.venv`, runs prepare twice, verify, the app
(asserting the changed marker) and checks `git status --porcelain` is empty;
finally removes the directory.

## Network

None. `prove.sh` sets `PIP_NO_INDEX=1` and `UV_OFFLINE=1` (caches in the temp
directory, `UV_NO_CONFIG=1`). This only works because the library's build
backend has no build requirements. A real library using setuptools,
hatchling or flit needs that backend for the editable build: by default pip
and uv fetch it from the index into an isolated build environment (cached
afterwards), or use `--no-build-isolation` with the backend preinstalled in
`.venv`. The app's other requirements come from the index as usual.

## Tool versions

Python 3.12.3, pip 24.0 (the venv's bundled pip), uv 0.5.9, Git 2.43.0.
Editable installs of `pyproject.toml` projects need pip >= 21.3 (PEP 660).

## Limitations

- Editable installs make source edits live, but metadata changes in the
  checkout (version, dependencies, entry points, new top-level packages) need
  prepare to run again. uv treats an already-installed editable as satisfied
  ("Audited"), so use `uv pip install --reinstall-package <name> ...` when
  metadata changed; pip rebuilds the editable on each run.
- The connected version must still satisfy the app's requirement range.
- Some backends' editable modes use import hooks instead of `.pth` path
  entries; verify then relies on `top_level.txt` if present. Strict-mode
  setuptools editables may need the probe extended for that project.
- The app must run with `.venv`'s interpreter (activated, or by path).

## Composition relationship

If the composed repository is itself an installable Python project (a plugin
or sub-package the app imports), the same editable install applies. If it is
raw source composed into the app tree (not a distribution), pip has no native
mechanism; the project's script needs custom treatment (e.g. a `.pth` file in
`.venv` or linking into the expected directory). This fixture proves only the
`dependency` case.

## Transcript (second from-scratch run, temp path shortened to `$WORK`)

```
=== installer: pip
+ /usr/bin/python3 -m venv .venv
+ .venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt -e $WORK/library
+ .venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt -e $WORK/library
+ .venv/bin/python -c <editable probe> acme-library $WORK/library
verified acme-library 1.0.0 editable -> $WORK/library (imports acme_library)
+ .venv/bin/python -m pip check --disable-pip-version-check
No broken requirements found.
app prints: library 1.0.0 + local change
PASS pip
=== installer: uv
+ uv venv --quiet --python /usr/bin/python3 .venv
+ uv pip install --python .venv/bin/python -r requirements.txt -e $WORK/library
Resolved 1 package in 2ms
Prepared 1 package in 202ms
Installed 1 package in 1ms
 + acme-library==1.0.0 (from file://$WORK/library)
+ uv pip install --python .venv/bin/python -r requirements.txt -e $WORK/library
Audited 2 packages in 1ms
+ .venv/bin/python -c <editable probe> acme-library $WORK/library
verified acme-library 1.0.0 editable -> $WORK/library (imports acme_library)
+ uv pip check --python .venv/bin/python
Checked 1 package in 0.56ms
All installed packages are compatible
app prints: library 1.0.0 + local change
PASS uv
PASS pip
```
