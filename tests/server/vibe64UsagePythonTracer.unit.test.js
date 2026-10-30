import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { mergePrependEnvironment, usageRecordingEnvironment, usageTracersForRuntimes } from "@local/vibe64-usage-recording/server/tracers";
import { usageTraceLineProblem } from "@local/vibe64-usage-recording/shared/contract";

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNTIME = path.join(REPOSITORY, "packages/vibe64-usage-recording/runtime/python");
const HTTP_ROOT = path.join(REPOSITORY, "tests/fixtures/usage-recording/python-http");
const CLI_ROOT = path.join(REPOSITORY, "tests/fixtures/usage-recording/python-cli");
const RECORDING_ID = "rec_abcdefghijklmnopqrst";
const HITS_FILE = /^hits-python-[0-9]+(-[0-9]+)?\.ndjson$/u;
const [pythonTracer] = usageTracersForRuntimes(["python"]);

const pythonVersion = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 12))"], { encoding: "utf8" });
const skip = pythonVersion.stdout?.trim() === "True" ? false : "needs python3 3.12 or newer";

async function recordingDirectory(t, { label = "Report", state = "recording" } = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-python-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const directory = path.join(parent, RECORDING_ID);
  await mkdir(directory);
  await writeFile(path.join(directory, "control.json"), JSON.stringify({ state }));
  await writeFile(path.join(directory, "recording.json"), JSON.stringify({ target: { id: "output:report", kind: "terminal", label } }));
  return directory;
}

// The environment the recording service gives a recorded launch, on top of a
// minimal base. PYTHONDONTWRITEBYTECODE keeps __pycache__ out of the checkout.
function pythonEnvironment({ directory, sourceRoot, targetKind, pythonPath = "", recording = true }) {
  const environment = { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" };
  if (!recording) return { ...environment, PYTHONPATH: pythonPath };
  const prepared = pythonTracer.prepare({ recordingDirectory: directory, sourceRoot, recordingId: RECORDING_ID, targetKind });
  assert.equal(prepared.available, true);
  return {
    ...environment,
    ...prepared.environment,
    PYTHONPATH: [prepared.prependEnvironment.PYTHONPATH, pythonPath].filter(Boolean).join(path.delimiter),
    ...usageRecordingEnvironment({ recordingDirectory: directory, sourceRoot, targetKind })
  };
}

function runPython(args, { cwd = CLI_ROOT, env }) {
  const result = spawnSync("python3", args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

const functionKey = (line) => `${line.path}#${line.name}@${line.start.line}:${line.start.column}`;

// Reads every hits file, checking each line against the contract and the
// declaration order, and merges them into scopes of function-key counts.
function readRecording(directory) {
  const recording = { files: [], scopes: new Map(), functions: new Map(), diagnostics: [], states: [] };
  for (const name of readdirSync(directory).filter((entry) => HITS_FILE.test(entry)).sort()) {
    const lines = readFileSync(path.join(directory, name), "utf8").split("\n").filter(Boolean).map((text) => JSON.parse(text));
    const files = new Map();
    const functions = new Map();
    const scopeLines = new Set();
    assert.equal(lines[0].type, "header", name);
    assert.equal(name.startsWith(`hits-python-${lines[0].pid}`), true, name);
    recording.files.push({ name, header: lines[0], lines });
    for (const line of lines) {
      assert.equal(usageTraceLineProblem(line), "", JSON.stringify(line));
      if (line.type === "file") files.set(line.fileIndex, line);
      if (line.type === "function") {
        assert.ok(files.has(line.fileIndex), `file declared before ${JSON.stringify(line)}`);
        const declared = { ...line, path: files.get(line.fileIndex).path, hash: files.get(line.fileIndex).hash };
        functions.set(line.functionIndex, declared);
        recording.functions.set(functionKey(declared), declared);
      }
      if (line.type === "diagnostic") recording.diagnostics.push(line.code);
      if (line.type === "tracer") recording.states.push(line.state);
      if (line.type === "scope") {
        scopeLines.add(line.scope);
        const scope = recording.scopes.get(line.scope) || { functions: new Map() };
        recording.scopes.set(line.scope, Object.assign(scope, line));
      }
      if (line.type === "hits") {
        assert.ok(scopeLines.has(line.scope), `scope line before hits for ${line.scope}`);
        const counts = recording.scopes.get(line.scope).functions;
        for (const [index, count] of line.counts) {
          assert.ok(functions.has(index), `function ${index} declared before its hits`);
          const key = functionKey(functions.get(index));
          counts.set(key, (counts.get(key) || 0) + count);
        }
      }
    }
  }
  return recording;
}

const namesIn = (scope) => new Set([...scope.functions.keys()].map((key) => key.split("#")[1].split("@")[0]));

async function waitFor(check, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function startServer(t, env) {
  const child = spawn("python3", ["server.py"], { cwd: HTTP_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  await waitFor(() => output.includes("\n") || child.exitCode !== null, "the fixture server did not start");
  assert.equal(child.exitCode, null, errors);
  return { child, port: Number(output.split("\n")[0]) };
}

function request(port, pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: { ...headers, "content-length": Buffer.byteLength(body) } }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const proxied = (id) => ({ headers: { "x-vibe64-recording-request": id } });

async function stopRecording(directory) {
  await writeFile(path.join(directory, "control.json"), JSON.stringify({ state: "stopping" }));
  await waitFor(() => readRecording(directory).states.includes("idle"), "the recorder did not go idle");
}

function socketCount(pid) {
  return readdirSync(`/proc/${pid}/fd`).filter((fd) => {
    try { return readlinkSync(`/proc/${pid}/fd/${fd}`).startsWith("socket:"); } catch { return false; }
  }).length;
}

test("prepare puts the Python runtime first on PYTHONPATH and sets nothing else", async () => {
  for (const targetKind of ["web", "terminal"]) {
    const prepared = pythonTracer.prepare({ recordingDirectory: "/r", sourceRoot: "/s", recordingId: RECORDING_ID, targetKind });
    assert.deepEqual(prepared, { available: true, environment: {}, prependEnvironment: { PYTHONPATH: RUNTIME } });
  }
  assert.equal(path.isAbsolute(RUNTIME), true);
  assert.equal(RUNTIME.includes(path.delimiter), false, "one segment, never a trailing separator");
  assert.equal(existsSync(path.join(RUNTIME, "sitecustomize.py")), true);
});

test("the prepared PYTHONPATH merges with a project's own without an empty segment", () => {
  const { prependEnvironment } = pythonTracer.prepare({ recordingDirectory: "/r", sourceRoot: "/s", recordingId: RECORDING_ID, targetKind: "web" });
  assert.deepEqual(mergePrependEnvironment(prependEnvironment, {}, ":"), { PYTHONPATH: RUNTIME });
  assert.deepEqual(mergePrependEnvironment(prependEnvironment, { PYTHONPATH: "" }, ":"), { PYTHONPATH: RUNTIME });
  assert.deepEqual(mergePrependEnvironment(prependEnvironment, { PYTHONPATH: "/project/src" }, ":"), { PYTHONPATH: `${RUNTIME}:/project/src` });
});

test("an older Python writes PYTHON_TOO_OLD and stays inert", { skip }, async (t) => {
  for (const file of ["sitecustomize.py", "vibe64_usage/__init__.py"]) {
    runPython(["-c", "import ast, sys; ast.parse(open(sys.argv[1]).read(), feature_version=(3, 7))", path.join(RUNTIME, file)], { env: { PATH: process.env.PATH } });
  }
  const directory = await recordingDirectory(t);
  const env = pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal" });
  const probe = [
    "import sys",
    "sys.version_info = (3, 11, 9, 'final', 0)",
    `sys.path.insert(0, ${JSON.stringify(RUNTIME)})`,
    "import vibe64_usage",
    "vibe64_usage.start()",
    "print([sys.monitoring.get_tool(tool) for tool in range(6)], 'vibe64_usage.tracer' in sys.modules)"
  ].join("\n");
  assert.equal(runPython(["-S", "-c", probe], { env }).trim(), "[None, None, None, None, None, None] False");
  const recording = readRecording(directory);
  assert.equal(recording.files.length, 1);
  assert.equal(recording.files[0].header.runtimeVersion, "3.11.9");
  assert.deepEqual(recording.files[0].lines.slice(1), [{ type: "diagnostic", code: "PYTHON_TOO_OLD" }]);
});

test("the project's own sitecustomize still runs, recorded or not", { skip }, async (t) => {
  const site = path.join(CLI_ROOT, "site");
  const directory = await recordingDirectory(t);
  const recorded = JSON.parse(runPython(["cli.py", "probe"], { env: pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal", pythonPath: site }) }));
  assert.equal(recorded.projectSitecustomize, true);
  assert.equal(recorded.recorderLoaded, true);
  assert.equal(recorded.sysPath.includes(site), true);
  assert.equal(recorded.sysPath.includes(RUNTIME), false, "the runtime directory leaves sys.path");
  assert.deepEqual(readRecording(directory).states, ["ready"]);

  const untraced = JSON.parse(runPython(["cli.py", "probe"], { env: pythonEnvironment({ recording: false, pythonPath: site }) }));
  assert.deepEqual(recorded.sysPath, untraced.sysPath);

  // Inert configurations still hand over to the project's sitecustomize and write nothing.
  const stopped = await recordingDirectory(t, { state: "stopping" });
  const inert = [
    { ...pythonEnvironment({ directory: stopped, sourceRoot: CLI_ROOT, targetKind: "terminal", pythonPath: site }) },
    { ...pythonEnvironment({ directory: stopped, sourceRoot: CLI_ROOT, targetKind: "terminal", pythonPath: site }), VIBE64_USAGE_RECORDING_DIR: "relative/dir" },
    { ...pythonEnvironment({ directory: stopped, sourceRoot: CLI_ROOT, targetKind: "terminal", pythonPath: site }), VIBE64_USAGE_RECORDING_DIR: path.join(stopped, "missing") }
  ];
  for (const env of inert) {
    assert.equal(JSON.parse(runPython(["cli.py", "probe"], { env })).projectSitecustomize, true);
  }
  assert.deepEqual((await readdir(stopped)).sort(), ["control.json", "recording.json"]);
});

test("code outside the source root is disabled after its first call", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const outside = path.join(path.dirname(directory), "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "outside_helper.py"), "def outside_function():\n    return 1\n");
  await writeFile(path.join(outside, "harness.py"), [
    "import json, sys",
    "import outside_helper",
    "from vibe64_usage import tracer",
    "monitoring = sys.monitoring",
    "event = monitoring.events.PY_START",
    "original = monitoring.register_callback(tracer.RECORDER.tool, event, None)",
    "calls = {}",
    "def counting(code, offset):",
    "    calls[code.co_name] = calls.get(code.co_name, 0) + 1",
    "    return original(code, offset)",
    "monitoring.register_callback(tracer.RECORDER.tool, event, counting)",
    `sys.path.insert(0, ${JSON.stringify(CLI_ROOT)})`,
    "from textkit.formatter import escape",
    "for _ in range(500):",
    "    outside_helper.outside_function()",
    "    escape('<')",
    "print(json.dumps(calls))"
  ].join("\n"));
  const calls = JSON.parse(runPython(["harness.py"], { cwd: outside, env: pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal" }) }));
  assert.equal(calls.outside_function, 1, "DISABLE: reported once, never again");
  assert.equal(calls.escape, 500);
  const recording = readRecording(directory);
  assert.deepEqual([...new Set([...recording.functions.values()].map((line) => line.path))].sort(), ["textkit/__init__.py", "textkit/formatter.py", "textkit/lexer.py"]);
  const [run] = [...recording.scopes.values()];
  assert.equal(run.functions.get([...run.functions.keys()].find((key) => key.includes("#escape@"))), 500);
});

test("a CLI run records its run scope with counts and flushes at exit", { skip }, async (t) => {
  const directory = await recordingDirectory(t, { label: "Highlight report" });
  runPython(["cli.py", "report"], { env: pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal" }) });
  const recording = readRecording(directory);
  const { pid } = recording.files[0].header;
  assert.deepEqual([...recording.scopes.keys()], [`run_${pid}`]);
  const run = recording.scopes.get(`run_${pid}`);
  assert.equal(run.kind, "run");
  assert.equal(run.label, "Highlight report");
  assert.ok(run.endedAt, "exit closes the run scope");
  assert.deepEqual(recording.states, ["ready"], "a run shorter than a flush tick is written at exit");
  const counts = Object.fromEntries([...run.functions].map(([key, count]) => [key.split("#")[1].split("@")[0] || key.split("#")[0], count]));
  assert.equal(counts.report, 1);
  assert.equal(counts.highlight, 1);
  assert.ok(counts.match_at > 10 && counts.match_at === counts.refine);
  assert.equal(counts["cli.py"], 1, "module code runs once as the file's module function");
  const lastLine = readFileSync(path.join(CLI_ROOT, "cli.py"), "utf8").trimEnd().split("\n").length;
  assert.equal(recording.functions.get("cli.py#@1:1").end.line, lastLine, "the module function ends at the end of the file");
});

test("a forked child records into its own file and index space", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const script = "import os, sys; from textkit import highlight; highlight('a = 1'); pid = os.fork()\nif pid == 0:\n    highlight('b = 2'); sys.exit(0)\nos.waitpid(pid, 0)";
  runPython(["-c", script], { env: pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal" }) });
  const recording = readRecording(directory);
  assert.equal(recording.files.length, 2);
  const pids = recording.files.map((file) => file.header.pid);
  assert.deepEqual([...recording.scopes.keys()].sort(), pids.map((pid) => `run_${pid}`).sort());
  for (const pid of pids) assert.equal(namesIn(recording.scopes.get(`run_${pid}`)).has("highlight"), true);
  for (const file of recording.files) assert.equal(file.lines.filter((line) => line.type === "file" && line.path === "textkit/lexer.py").length, 1);
});

test("http.server requests are recorded per request, alone or concurrent, then idle after stop", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const { child, port } = await startServer(t, pythonEnvironment({ directory, sourceRoot: HTTP_ROOT, targetKind: "web" }));
  const routes = ["/catalog", "/item/7", "/cart"];
  for (const route of routes) assert.equal((await request(port, `${route}?token=warm`)).status, 200);
  assert.equal((await request(port, "/cart", proxied("r_12"))).status, 200);
  for (const [index, route] of routes.entries()) await request(port, route, proxied(`r_00000${index + 1}`));
  await Promise.all(routes.map((route, index) => request(port, route, proxied(`r_00000${index + 4}`))));
  await stopRecording(directory);

  const recording = readRecording(directory);
  const { pid } = recording.files[0].header;
  for (const [index] of routes.entries()) {
    const alone = recording.scopes.get(`r_00000${index + 1}`);
    const concurrent = recording.scopes.get(`r_00000${index + 4}`);
    assert.equal(alone.kind, "request");
    assert.equal(alone.label, undefined, "the proxy owns request labels");
    assert.deepEqual(concurrent.functions, alone.functions, routes[index]);
  }
  const concurrent = [4, 5, 6].map((index) => recording.scopes.get(`r_00000${index}`));
  assert.ok(concurrent.map((scope) => scope.startedAt).sort().at(-1) < concurrent.map((scope) => scope.endedAt).sort()[0], "the three requests overlapped");
  assert.equal(namesIn(recording.scopes.get("r_000001")).has("list_items"), true);
  assert.equal(namesIn(recording.scopes.get("r_000002")).has("list_items"), false);
  assert.equal(namesIn(recording.scopes.get("r_000002")).has("item_detail"), true);

  const locals = [...recording.scopes.values()].filter((scope) => scope.kind === "local-request");
  assert.deepEqual(locals.map((scope) => scope.label), ["GET /catalog", "GET /item/7", "GET /cart", "GET /cart"]);
  assert.ok(locals.every((scope) => scope.scope.startsWith(`l_${pid}_`) && scope.endedAt));
  const background = recording.scopes.get(`bg_${pid}`);
  assert.equal(namesIn(background).has("main"), true);
  assert.equal(namesIn(background).has("route"), false, "request work never lands in the background scope");

  // Idle: later requests run untraced and the file stops growing.
  const size = readFileSync(path.join(directory, recording.files[0].name)).length;
  await request(port, "/catalog", proxied("r_000009"));
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal(readFileSync(path.join(directory, recording.files[0].name)).length, size);
  assert.equal(child.exitCode, null);
});

test("the recorder opens no socket of its own", { skip: skip || (existsSync("/proc/self/fd") ? false : "needs /proc") }, async (t) => {
  const directory = await recordingDirectory(t);
  const traced = await startServer(t, pythonEnvironment({ directory, sourceRoot: HTTP_ROOT, targetKind: "web" }));
  const untraced = await startServer(t, pythonEnvironment({ recording: false }));
  // The listener and the stdio pipes (socket pairs) only.
  const started = socketCount(untraced.child.pid);
  assert.equal(socketCount(traced.child.pid), started);
  await request(traced.port, "/cart", proxied("r_000001"));
  await request(untraced.port, "/cart");
  // Each server closes its request's connection after replying.
  await waitFor(() => socketCount(traced.child.pid) === started && socketCount(untraced.child.pid) === started, "a socket stayed open");
});

test("a recording holds no header, cookie, query, body or argument value", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const { port } = await startServer(t, pythonEnvironment({ directory, sourceRoot: HTTP_ROOT, targetKind: "web" }));
  const secrets = ["Bearer-SECRET-AUTH-1", "SECRET-COOKIE-2", "SECRET-QUERY-3", "SECRET-CARD-4"];
  const order = { method: "POST", body: JSON.stringify({ card: secrets[3], lines: [{ id: 7, quantity: 2 }] }) };
  const headers = { authorization: `Bearer ${secrets[0]}`, cookie: `session=${secrets[1]}` };
  assert.equal((await request(port, `/checkout?token=${secrets[2]}`, { ...order, headers: { ...headers, "x-vibe64-recording-request": "r_000001" } })).status, 200);
  assert.equal((await request(port, `/checkout?token=${secrets[2]}#${secrets[2]}`, { ...order, headers })).status, 200);
  await stopRecording(directory);
  const recording = readRecording(directory);
  assert.equal(namesIn(recording.scopes.get("r_000001")).has("place_order"), true);
  assert.deepEqual([...recording.scopes.values()].filter((scope) => scope.label).map((scope) => scope.label), ["POST /checkout"]);
  for (const name of await readdir(directory)) {
    const text = await readFile(path.join(directory, name), "utf8");
    for (const secret of secrets) assert.equal(text.includes(secret), false, `${secret} in ${name}`);
  }
});

// The §3.7.5 join rules, applied against canonical positions (the def or lambda
// keyword, decorators excluded) read with Python's own parser.
function joinKind(recorded, canonical) {
  const candidates = canonical.filter((entry) => entry.path === recorded.path);
  if (candidates.some((entry) => entry.line === recorded.start.line && entry.column === recorded.start.column)) return "exact";
  const near = candidates.filter((entry) => recorded.name && entry.name === recorded.name && Math.abs(entry.line - recorded.start.line) <= 3);
  return near.length === 1 ? "name-line" : "none";
}

test("decorated functions join their canonical function, and the name-line rule covers decorator lines", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const { port } = await startServer(t, pythonEnvironment({ directory, sourceRoot: HTTP_ROOT, targetKind: "web" }));
  for (const route of ["/catalog", "/item/7", "/cart"]) await request(port, route);
  await request(port, "/checkout", { method: "POST", body: "{\"lines\": []}" });
  await stopRecording(directory);

  const canonical = JSON.parse(runPython(["-c", [
    "import ast, json, pathlib, sys",
    "found = []",
    "for file in sorted(pathlib.Path(sys.argv[1]).rglob('*.py')):",
    "    path = file.relative_to(sys.argv[1]).as_posix()",
    "    found.append({'path': path, 'name': '', 'line': 1, 'column': 1})",
    "    for node in ast.walk(ast.parse(file.read_bytes())):",
    "        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):",
    "            decorators = getattr(node, 'decorator_list', [])",
    "            found.append({'path': path, 'name': getattr(node, 'name', ''), 'line': node.lineno, 'column': node.col_offset + 1,",
    "                          'firstLine': decorators[0].lineno if decorators else node.lineno})",
    "print(json.dumps(found))"
  ].join("\n"), HTTP_ROOT], { env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" } }));

  const recorded = [...readRecording(directory).functions.values()];
  for (const line of recorded) assert.equal(joinKind(line, canonical), "exact", JSON.stringify(line));
  const decorated = canonical.filter((entry) => entry.firstLine && entry.firstLine !== entry.line);
  assert.deepEqual(decorated.map((entry) => entry.name).sort(), ["cheapest", "item_detail", "label", "list_items", "place_order", "wrapper", "wrapper"].sort());
  for (const entry of decorated.filter((candidate) => candidate.name !== "wrapper")) {
    const line = recorded.find((candidate) => candidate.path === entry.path && candidate.name === entry.name);
    assert.ok(line, `${entry.name} ran`);
    const atDecorator = { ...line, start: { line: entry.firstLine, column: 1 } };
    assert.equal(joinKind(atDecorator, canonical), "name-line", entry.name);
  }
  assert.ok(recorded.some((line) => line.name === "" && line.start.line > 1), "lambdas join by position");
});

test("recording costs at most 2.5 times the untraced time on the CPU benchmark", { skip }, async (t) => {
  const directory = await recordingDirectory(t);
  const traced = pythonEnvironment({ directory, sourceRoot: CLI_ROOT, targetKind: "terminal" });
  const untraced = pythonEnvironment({ recording: false });
  const runs = { traced: [], untraced: [] };
  for (let round = 0; round < 3; round += 1) {
    runs.untraced.push(Number(runPython(["cli.py", "bench"], { env: untraced })));
    runs.traced.push(Number(runPython(["cli.py", "bench"], { env: traced })));
  }
  const ratio = Math.min(...runs.traced) / Math.min(...runs.untraced);
  t.diagnostic(`benchmark ms ${JSON.stringify(runs)} ratio ${ratio.toFixed(2)}`);
  assert.ok(ratio <= 2.5, `ratio ${ratio.toFixed(2)}`);
});
