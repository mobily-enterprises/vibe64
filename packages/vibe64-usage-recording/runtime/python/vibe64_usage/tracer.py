"""Records which project functions run, per request or per run (Python 3.12+).

sys.monitoring reports every function start (PY_START) to one callback. Code
outside the source root, in an installed or vendored package, or in this
recorder answers DISABLE once and is never reported again. Project code is
counted against the scope current in its context: the Preview request whose id
Vibe64's proxy sent, a request this process served directly, or the process's
own run or background scope. Request scopes come from the stdlib http.server
request handler, which Django's and Werkzeug's development servers also use;
any other server's requests count in the background scope.

A daemon thread writes the counts every second, reads control.json and goes
idle when Vibe64 stops the recording. Exit writes what is left.
"""
import atexit
import contextvars
import functools
import hashlib
import os
import re
import sys
import threading

from vibe64_usage import (
    control_stopping,
    encode_lines,
    header_line,
    now_iso,
    open_trace_file,
    read_json,
    write_all
)

monitoring = sys.monitoring
PY_START = monitoring.events.PY_START
DISABLE = monitoring.DISABLE
# Ids 0, 1, 2 and 5 are named for debuggers, coverage, profilers and optimizers.
TOOL_IDS = (3, 4)
CO_OPTIMIZED = 0x0001
REQUEST_HEADER = "x-vibe64-recording-request"
REQUEST_ID = re.compile(r"r_[0-9]{6}\Z")
SKIPPED_DIRECTORIES = frozenset(("node_modules", "vendor", "site-packages", "dist-packages"))
FILE_BYTES = 16 * 1024 * 1024
END_LINES_BYTES = 256
FLUSH_SECONDS = 1.0
FLUSH_ENTRIES = 2000
PAIRS_PER_LINE = 2000
NAME_CHARS = 256
PATH_LABEL_CHARS = 256
RUN_LABEL_CHARS = 80
DEF_SEARCH_LINES = 64
DEF_LINE = re.compile(r"([ \t\f]*)(?:async[ \t]+)?def[ \t]+(\w+)")
LAMBDA = re.compile(r"\blambda\b")
NEWLINE = re.compile(r"\r\n|\r|\n")
HANDLER_SCOPE = "_vibe64_usage_scope"
PATCHED = "_vibe64_usage_patched"
MISSING = object()

RECORDER = None


def start(directory, source_root, target_kind):
    global RECORDER
    recorder = Recorder(directory, source_root, target_kind)
    if recorder.start():
        RECORDER = recorder


class Scope:
    __slots__ = ("id", "kind", "label", "started_at", "ended_at", "counts", "written", "line_state")

    def __init__(self, scope_id, kind, label=None):
        self.id = scope_id
        self.kind = kind
        self.label = label
        self.started_at = now_iso()
        self.ended_at = None
        self.counts = {}
        self.reset()

    def reset(self):
        self.written = {}
        self.line_state = 0  # 0: no scope line yet, 1: written open, 2: written with endedAt

    def line(self):
        line = {"type": "scope", "scope": self.id, "kind": self.kind}
        if self.label:
            line["label"] = self.label
        line["startedAt"] = self.started_at
        if self.ended_at:
            line["endedAt"] = self.ended_at
        return line


class SourceFile:
    """What a function line needs from one project file: def and lambda columns."""
    __slots__ = ("index", "defs", "lambdas", "end")

    def __init__(self, index, data):
        self.index = index
        lines = NEWLINE.split(data.decode("utf-8", "replace"))
        while len(lines) > 1 and not lines[-1].strip():
            lines.pop()
        self.end = (len(lines), len(lines[-1].encode("utf-8")) + 1)
        self.defs = {}
        self.lambdas = {}
        for number, text in enumerate(lines, 1):
            match = DEF_LINE.match(text)
            if match:
                self.defs.setdefault(match.group(2), []).append((number, len(match.group(1)) + 1))
            if "lambda" in text:
                self.lambdas[number] = [len(text[:found.start()].encode("utf-8")) + 1 for found in LAMBDA.finditer(text)]


def function_position(code, source):
    """(name, start, end) in the canonical form, or None for code that is not a function."""
    name = code.co_name
    if not code.co_flags & CO_OPTIMIZED:
        # Module code runs as the file's module function; class bodies are not functions.
        return ("", (1, 1), source.end) if name == "<module>" else None
    if name == "<lambda>":
        start = lambda_start(code, source)
        name = ""
    elif name.startswith("<"):
        return None  # a generator expression runs as part of its function
    else:
        start = def_start(code, source, name)
    end = start
    for _, end_line, _, end_column in code.co_positions():
        if end_line is not None and end_column is not None and (end_line, end_column + 1) > end:
            end = (end_line, end_column + 1)
    return name[:NAME_CHARS], start, end


def def_start(code, source, name):
    # co_firstlineno is the first decorator's line; the canonical start is the def.
    first = code.co_firstlineno
    for line, column in source.defs.get(name, ()):
        if line > first + DEF_SEARCH_LINES:
            break
        if line >= first:
            return line, column
    return first, 1


def lambda_start(code, source):
    first = code.co_firstlineno
    columns = source.lambdas.get(first) or [1]
    body = min((column for line, _, column, _ in code.co_positions() if line == first and column), default=None)
    before_body = [column for column in columns if body is None or column - 1 < body]
    return first, (before_body or columns)[-1]


def request_label(handler):
    method = str(getattr(handler, "command", "") or "?")[:16]
    target = str(getattr(handler, "path", "") or "")
    path = target.split("#", 1)[0].split("?", 1)[0]
    if not path.startswith("/"):
        path = "/" + path.split("://", 1)[-1].partition("/")[2]
    return method + " " + path[:PATH_LABEL_CHARS]


def acquire_tool_id():
    for tool in TOOL_IDS:
        if monitoring.get_tool(tool) is None:
            try:
                monitoring.use_tool_id(tool, "vibe64-usage")
                return tool
            except ValueError:
                continue
    return None


class Recorder:
    def __init__(self, directory, source_root, target_kind):
        self.directory = directory
        self.root = os.path.realpath(source_root) + os.sep
        runtime = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
        candidates = (runtime, sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix)
        # This recorder and a Python installation or virtualenv inside the source root are not project code.
        self.excluded = tuple({real for real in (os.path.realpath(path) + os.sep for path in candidates)
                               if real.startswith(self.root)})
        self.target_kind = target_kind
        self.run_label = None
        if target_kind == "terminal":
            recording = read_json(os.path.join(directory, "recording.json"))
            label = recording.get("target", {}).get("label") if isinstance(recording, dict) else None
            self.run_label = label[:RUN_LABEL_CHARS] if isinstance(label, str) and label else None
        self.current = contextvars.ContextVar("vibe64_usage_scope")
        self.lock = threading.RLock()
        self.functions = {}  # id(code) -> functionIndex; self.codes keeps those ids from being reused
        self.active = False
        self.tool = None
        self.fd = None
        self.reset_process()

    def reset_process(self):
        self.pid = os.getpid()
        self.codes = []
        self.functions.clear()
        self.files = {}
        self.file_count = 0
        self.pending = []
        self.bytes = 0
        self.local_count = 0
        if self.target_kind == "terminal":
            self.process_scope = Scope("run_%d" % self.pid, "run", self.run_label)
        else:
            self.process_scope = Scope("bg_%d" % self.pid, "background")
        self.scopes = [self.process_scope]
        self.wake = threading.Event()

    # Lifecycle

    def start(self):
        if not self.open_file():
            return False
        self.tool = acquire_tool_id()
        if self.tool is None:
            self.write([{"type": "diagnostic", "code": "NO_FREE_MONITORING_TOOL"}])
            self.close_file()
            return False
        monitoring.register_callback(self.tool, PY_START, self.callback())
        monitoring.set_events(self.tool, PY_START)
        self.active = True
        self.write([{"type": "tracer", "state": "ready"}])
        install_http_server_hook(self)
        atexit.register(self.exit)
        os.register_at_fork(before=lambda: self.lock.acquire(), after_in_parent=lambda: self.lock.release(),
                            after_in_child=self.after_fork_in_child)
        self.start_flusher()
        return True

    def open_file(self):
        self.fd = open_trace_file(self.directory)
        return self.fd is not None and self.write([header_line()])

    def close_file(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def start_flusher(self):
        threading.Thread(target=self.run_flusher, name="vibe64-usage-recorder", daemon=True).start()

    def run_flusher(self):
        while True:
            self.wake.wait(FLUSH_SECONDS)
            self.wake.clear()
            if not self.active:
                return
            try:
                if control_stopping(self.directory) or not os.path.isdir(self.directory):
                    self.stop()
                    return
                self.flush()
            except Exception:
                self.fail()
                return

    def stop(self):
        with self.lock:
            if not self.active:
                return
            self.go_idle()
            self.flush()
            self.write([{"type": "tracer", "state": "idle"}])
            self.close_file()

    def exit(self):
        # Registered before the application's own exit handlers, so it runs after them.
        try:
            with self.lock:
                if self.active:
                    self.process_scope.ended_at = now_iso()
                    self.flush()
                    self.active = False
        except Exception:
            pass

    def fail(self):
        try:
            with self.lock:
                if self.active:
                    self.go_idle()
                    self.write([{"type": "diagnostic", "code": "RECORDER_FAILED"}, {"type": "tracer", "state": "idle"}])
                    self.close_file()
        except Exception:
            pass

    def go_idle(self):
        self.active = False
        self.wake.set()
        try:
            monitoring.set_events(self.tool, 0)
            monitoring.register_callback(self.tool, PY_START, None)
            monitoring.free_tool_id(self.tool)
        except Exception:
            pass

    def after_fork_in_child(self):
        # The child is its own process: its own hits file, index space and flusher.
        self.lock = threading.RLock()
        if not self.active:
            return
        try:
            self.close_file()
            requests = [scope for scope in self.scopes if scope is not self.process_scope]
            self.reset_process()
            for scope in requests:
                scope.counts.clear()
                scope.reset()
            self.scopes.extend(requests)
            if not self.open_file():
                self.go_idle()
                return
            self.write([{"type": "tracer", "state": "ready"}])
            self.start_flusher()
        except Exception:
            self.go_idle()

    # Counting

    def callback(self):
        functions_get = self.functions.get
        current_get = self.current.get
        declare = self.declare
        recorder = self

        def on_start(code, offset):
            try:
                index = functions_get(id(code))
                if index is None:
                    index = declare(code)
                    if index is None:
                        return DISABLE
                counts = (current_get(None) or recorder.process_scope).counts
                counts[index] = counts.get(index, 0) + 1
            except Exception:
                recorder.fail()
            return None

        return on_start

    def declare(self, code):
        with self.lock:
            index = self.functions.get(id(code))
            if index is not None or not self.active:
                return index
            source = self.source_file(code.co_filename)
            position = source and function_position(code, source)
            if not position:
                return None
            name, start, end = position
            index = len(self.codes)
            self.queue({
                "type": "function", "functionIndex": index, "fileIndex": source.index, "name": name,
                "start": {"line": start[0], "column": start[1]}, "end": {"line": end[0], "column": end[1]}
            })
            self.codes.append(code)
            self.functions[id(code)] = index
            return index

    def source_file(self, filename):
        source = self.files.get(filename, MISSING)
        if source is MISSING:
            source = self.files[filename] = self.read_source(filename)
        return source

    def read_source(self, filename):
        if not filename.endswith(".py") or not os.path.isabs(filename):
            return None
        real = os.path.realpath(filename)
        if not real.startswith(self.root) or real.startswith(self.excluded):
            return None
        relative = real[len(self.root):].replace(os.sep, "/")
        if "\\" in relative or SKIPPED_DIRECTORIES.intersection(relative.split("/")):
            return None
        try:
            with open(real, "rb") as handle:
                data = handle.read()
        except OSError:
            self.queue({"type": "diagnostic", "code": "READ_FAILED", "path": relative})
            return None
        source = SourceFile(self.file_count, data)
        self.file_count += 1
        self.queue({"type": "file", "fileIndex": source.index, "path": relative,
                    "hash": "sha256:" + hashlib.sha256(data).hexdigest()})
        return source

    def queue(self, line):
        self.pending.append(line)
        if len(self.pending) >= FLUSH_ENTRIES:
            self.wake.set()

    # Request scopes

    def open_request(self, handler):
        self.close_request(handler)  # the previous request on a kept-alive connection
        if not self.active:
            return
        request_id = handler.headers.get(REQUEST_HEADER) if handler.headers is not None else None
        with self.lock:
            if isinstance(request_id, str) and REQUEST_ID.match(request_id):
                scope = Scope(request_id, "request")
            else:
                self.local_count += 1
                scope = Scope("l_%d_%d" % (self.pid, self.local_count), "local-request", request_label(handler))
            self.scopes.append(scope)
        handler.__dict__[HANDLER_SCOPE] = (scope, self.current.get(None))
        self.current.set(scope)

    def close_request(self, handler):
        entry = handler.__dict__.pop(HANDLER_SCOPE, None)
        if entry is not None:
            scope, previous = entry
            scope.ended_at = now_iso()
            self.current.set(previous)

    # Writing

    def flush(self):
        with self.lock:
            if self.fd is None:
                return
            # Whether a scope ended is read before its counts, so an ended scope's counts are final.
            snapshots = [(scope, scope.ended_at is not None, list(scope.counts.items())) for scope in self.scopes]
            lines, self.pending = self.pending, []
            for scope, ended, counts in snapshots:
                written = scope.written
                delta = [[index, count - written.get(index, 0)] for index, count in counts if count != written.get(index, 0)]
                scope.written = dict(counts)
                if delta and scope.line_state == 0:
                    lines.append(scope.line())
                    scope.line_state = 2 if ended else 1
                for offset in range(0, len(delta), PAIRS_PER_LINE):
                    lines.append({"type": "hits", "scope": scope.id, "counts": delta[offset:offset + PAIRS_PER_LINE]})
                if ended and scope.line_state == 1:
                    lines.append(scope.line())
                    scope.line_state = 2
            self.scopes = [scope for scope, ended, _ in snapshots if not ended or scope is self.process_scope]
            self.write(lines)

    def write(self, lines):
        """Writes whole lines; past the per-process cap, ends the file with truncated and idle."""
        if not lines or self.fd is None:
            return self.fd is not None
        data = encode_lines(lines)
        if self.bytes + len(data) > FILE_BYTES - END_LINES_BYTES:
            self.go_idle()
            data = encode_lines([{"type": "truncated", "reason": "size-limit"}, {"type": "tracer", "state": "idle"}])
            write_all(self.fd, data)
            self.close_file()
            return False
        write_all(self.fd, data)
        self.bytes += len(data)
        return True


# http.server request boundary

def install_http_server_hook(recorder):
    """Patches http.server when it is first imported; importing it here would slow every start."""
    module = sys.modules.get("http.server")
    if module is not None:
        patch_http_server(module, recorder)
    else:
        sys.meta_path.insert(0, HttpServerImportHook(recorder))


class HttpServerImportHook:
    def __init__(self, recorder):
        self.recorder = recorder

    def find_spec(self, name, path=None, target=None):
        if name != "http.server":
            return None
        try:
            for finder in sys.meta_path:
                find_spec = getattr(finder, "find_spec", None) if finder is not self else None
                spec = find_spec(name, path, target) if find_spec else None
                if spec is not None:
                    break
            else:
                return None
            if spec.loader is not None and hasattr(spec.loader, "exec_module"):
                spec.loader = PatchingLoader(spec.loader, self)
            return spec
        except Exception:
            return None


class PatchingLoader:
    def __init__(self, loader, hook):
        self.loader = loader
        self.hook = hook

    def __getattr__(self, name):
        return getattr(self.loader, name)

    def create_module(self, spec):
        return self.loader.create_module(spec)

    def exec_module(self, module):
        self.loader.exec_module(module)
        patch_http_server(module, self.hook.recorder)
        try:
            sys.meta_path.remove(self.hook)
        except ValueError:
            pass


def patch_http_server(module, recorder):
    try:
        handler_class = module.BaseHTTPRequestHandler
        if handler_class.__dict__.get(PATCHED):
            return
        parse_request = handler_class.parse_request
        handle_one_request = handler_class.handle_one_request
        finish = handler_class.finish
    except Exception:
        return

    def guarded(action, handler):
        try:
            action(handler)
        except Exception:
            pass

    # Every http.server handler parses its request through parse_request. The scope
    # ends with handle_one_request, or with finish for handlers (wsgiref, Django)
    # that override it; a kept-alive connection's next request ends it as well.
    @functools.wraps(parse_request)
    def recorded_parse_request(self):
        parsed = parse_request(self)
        if parsed:
            guarded(recorder.open_request, self)
        return parsed

    @functools.wraps(handle_one_request)
    def recorded_handle_one_request(self):
        try:
            return handle_one_request(self)
        finally:
            guarded(recorder.close_request, self)

    @functools.wraps(finish)
    def recorded_finish(self):
        try:
            return finish(self)
        finally:
            guarded(recorder.close_request, self)

    handler_class.parse_request = recorded_parse_request
    handler_class.handle_one_request = recorded_handle_one_request
    handler_class.finish = recorded_finish
    setattr(handler_class, PATCHED, True)
