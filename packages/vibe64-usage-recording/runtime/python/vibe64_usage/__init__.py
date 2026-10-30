"""Vibe64 usage recorder for Python.

This runtime's sitecustomize starts it for a recorded Output target. It writes
which project functions ran, per request or per run, into the recording
directory Vibe64 created. It writes nothing else: file paths, content hashes,
function names and positions, call counts, scope ids, the process id and, for
a request that did not come through the Preview, its method and path without
the query. It never raises into the application, and it stays inert whenever
its configuration is not exactly right.

Python older than 3.12 only writes a PYTHON_TOO_OLD diagnostic, so this module
must keep loading on older versions; the recorder itself is in tracer.py.
"""
import errno
import json
import os
import stat
import sys
import time

TRACE_SCHEMA = "vibe64.usage-trace.v1"
MINIMUM_PYTHON = (3, 12)
TARGET_KINDS = ("web", "terminal")
SMALL_FILE_BYTES = 64 * 1024

_started = False


def start(environ=None):
    global _started
    if _started:
        return
    _started = True
    try:
        _start(os.environ if environ is None else environ)
    except Exception:
        pass


def _start(environ):
    directory = recording_directory(environ.get("VIBE64_USAGE_RECORDING_DIR", ""))
    if not directory or control_stopping(directory):
        return
    if sys.version_info < MINIMUM_PYTHON or not hasattr(sys, "monitoring"):
        write_diagnostic_trace(directory, "PYTHON_TOO_OLD")
        return
    source_root = environ.get("VIBE64_USAGE_SOURCE_ROOT", "")
    target_kind = environ.get("VIBE64_USAGE_TARGET_KIND", "")
    if target_kind not in TARGET_KINDS or not os.path.isabs(source_root) or not os.path.isdir(source_root):
        write_diagnostic_trace(directory, "CONFIGURATION_INVALID")
        return
    from vibe64_usage import tracer
    tracer.start(directory, source_root, target_kind)


def recording_directory(value):
    """The recording directory when it is absolute, exists and is not a symlink."""
    if not value or not os.path.isabs(value):
        return ""
    try:
        mode = os.lstat(value).st_mode
    except OSError:
        return ""
    return value if stat.S_ISDIR(mode) else ""


def read_json(path):
    try:
        with open(path, "rb") as handle:
            return json.loads(handle.read(SMALL_FILE_BYTES).decode("utf-8"))
    except Exception:
        return None


def control_stopping(directory):
    """Only {"state": "stopping"} stops; a missing or malformed file keeps recording."""
    control = read_json(os.path.join(directory, "control.json"))
    return isinstance(control, dict) and control.get("state") == "stopping"


def now_iso():
    now = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now)) + ".%03dZ" % (int(now * 1000) % 1000)


def header_line():
    return {
        "type": "header",
        "schema": TRACE_SCHEMA,
        "runtime": "python",
        "runtimeVersion": "%d.%d.%d" % tuple(sys.version_info[:3]),
        "pid": os.getpid(),
        "startedAt": now_iso()
    }


def open_trace_file(directory):
    """Creates this process's own hits file; a taken name (exec keeps the pid) gets a suffix."""
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND
    flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
    pid = os.getpid()
    for attempt in range(1, 100):
        suffix = "" if attempt == 1 else "-%d" % attempt
        try:
            return os.open(os.path.join(directory, "hits-python-%d%s.ndjson" % (pid, suffix)), flags, 0o660)
        except OSError as error:
            if error.errno != errno.EEXIST:
                return None
    return None


def encode_lines(lines):
    return "".join(json.dumps(line, separators=(",", ":")) + "\n" for line in lines).encode("ascii")


def write_all(fd, data):
    view = memoryview(data)
    while view:
        view = view[os.write(fd, view):]


def write_diagnostic_trace(directory, code):
    fd = open_trace_file(directory)
    if fd is None:
        return
    try:
        write_all(fd, encode_lines([header_line(), {"type": "diagnostic", "code": code}]))
    finally:
        os.close(fd)
