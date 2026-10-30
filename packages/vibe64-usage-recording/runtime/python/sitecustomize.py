# Vibe64 usage recorder bootstrap.
#
# Vibe64 puts this directory first on PYTHONPATH only while an Output target is
# being recorded. This module starts the recorder, which stays inert unless the
# recording variables are exactly right. Then it takes this directory back off
# sys.path and runs the next sitecustomize on sys.path, so the project's own or
# Python's own sitecustomize still runs as it would without Vibe64.
#
# Keep this file and vibe64_usage/__init__.py free of newer syntax: an older
# Python must still load them and report that it is too old.
import os
import sys


def _start_recorder():
    try:
        import vibe64_usage
        vibe64_usage.start()
    except Exception:
        pass


def _remove_own_directory():
    here = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))
    kept = []
    for entry in sys.path:
        try:
            own = bool(entry) and os.path.realpath(entry) == here
        except Exception:
            own = False
        if not own:
            kept.append(entry)
    sys.path[:] = kept


def _run_next_sitecustomize():
    ours = sys.modules.pop("sitecustomize", None)
    try:
        import sitecustomize  # noqa: F401  the next one on sys.path, if any
    except ImportError as error:
        if getattr(error, "name", None) != "sitecustomize":
            raise
        if ours is not None:
            sys.modules["sitecustomize"] = ours


_start_recorder()
_remove_own_directory()
_run_next_sitecustomize()
