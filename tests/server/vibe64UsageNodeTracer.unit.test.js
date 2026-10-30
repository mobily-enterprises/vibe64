import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "@babel/parser";

import { USAGE_RECORDING_LIMITS, usageTraceLineProblem } from "@local/vibe64-usage-recording/shared/contract";
import { USAGE_TRACERS } from "@local/vibe64-usage-recording/server/tracers";
import { instrumentSource } from "../../packages/vibe64-usage-recording/runtime/node/instrument.mjs";
import { createTraceWriter } from "../../packages/vibe64-usage-recording/runtime/node/writer.mjs";

const PRELOAD = fileURLToPath(new URL("../../packages/vibe64-usage-recording/runtime/node/preload.mjs", import.meta.url));
const HTTP_FIXTURE = fileURLToPath(new URL("../fixtures/usage-recording/node-http", import.meta.url));
const CLI_FIXTURE = fileURLToPath(new URL("../fixtures/usage-recording/node-cli", import.meta.url));
// Stands in for a Node.js release without module.registerHooks.
const WITHOUT_HOOKS = `data:text/javascript,${encodeURIComponent("import m from \"node:module\"; delete m.registerHooks;")}`;

const children = new Set();
const roots = [];

after(async () => {
  for (const child of children) child.kill("SIGKILL");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "v64-node-usage-"));
  roots.push(root);
  return root;
}

function childEnvironment({ directory, sourceRoot, targetKind = "web", traced = true, preImports = [] } = {}) {
  const imports = [...preImports, ...(traced ? [pathToFileURL(PRELOAD).href] : [])].map((url) => `--import=${url}`);
  const env = { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS || "", ...imports].join(" ").trim() };
  for (const name of ["VIBE64_USAGE_RECORDING_DIR", "VIBE64_USAGE_SOURCE_ROOT", "VIBE64_USAGE_TARGET_KIND"]) delete env[name];
  if (directory !== undefined) env.VIBE64_USAGE_RECORDING_DIR = directory;
  if (sourceRoot !== undefined) env.VIBE64_USAGE_SOURCE_ROOT = sourceRoot;
  if (targetKind !== null) env.VIBE64_USAGE_TARGET_KIND = targetKind;
  return env;
}

async function startServer(env) {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: HTTP_FIXTURE, env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.once("exit", () => children.delete(child));
  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${errors}`)), 10_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /LISTENING (\d+)/u.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}): ${errors}`));
    });
  });
  return { child, port, pid: child.pid, errors: () => errors };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = once(server.child, "exit");
  server.child.kill("SIGTERM");
  const timer = setTimeout(() => server.child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(timer);
}

function request(port, pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path: pathname, method, headers, agent: false }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, text }));
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

const proxied = (id) => ({ headers: { "x-vibe64-recording-request": id } });

function runCli(env) {
  const result = spawnSync(process.execPath, ["cli.mjs"], { cwd: CLI_FIXTURE, env, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ONE\nTWO\nTHREE\n3\n");
  return result;
}

function traceFiles(directory) {
  return readdirSync(directory).filter((name) => /^hits-nodejs-\d+(?:-\d+)?\.ndjson$/u.test(name)).sort();
}

// Every line of every trace file, each checked against the shared line format.
function readTrace(directory) {
  const trace = { lines: [], functions: new Map(), files: new Map(), scopes: new Map(), counts: new Map() };
  for (const name of traceFiles(directory)) {
    const text = readFileSync(path.join(directory, name), "utf8");
    assert.ok(text === "" || text.endsWith("\n"), `${name} ends with a complete line`);
    for (const raw of text.split("\n").filter(Boolean)) {
      assert.ok(Buffer.byteLength(raw) <= USAGE_RECORDING_LIMITS.traceLineBytes);
      const line = JSON.parse(raw);
      assert.equal(usageTraceLineProblem(line), "", raw);
      trace.lines.push(line);
      if (line.type === "file") trace.files.set(line.fileIndex, line);
      if (line.type === "function") trace.functions.set(line.functionIndex, line);
      if (line.type === "scope") trace.scopes.set(line.scope, { ...trace.scopes.get(line.scope), ...line });
      if (line.type === "hits") {
        assert.ok(trace.scopes.has(line.scope), `scope ${line.scope} is declared before its hits`);
        const counts = trace.counts.get(line.scope) || new Map();
        for (const [functionIndex, count] of line.counts) {
          assert.ok(trace.functions.has(functionIndex), `function ${functionIndex} is declared before its hits`);
          const key = functionKey(trace, functionIndex);
          counts.set(key, (counts.get(key) || 0) + count);
        }
        trace.counts.set(line.scope, counts);
      }
    }
  }
  return trace;
}

function functionKey(trace, functionIndex) {
  const entry = trace.functions.get(functionIndex);
  return `${trace.files.get(entry.fileIndex).path}:${entry.start.line}:${entry.start.column}:${entry.name}`;
}

const countsOf = (trace, scope) => Object.fromEntries([...(trace.counts.get(scope) || new Map())].sort());

async function waitFor(check, description, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function waitForScopes(directory, scopes) {
  return waitFor(() => {
    const trace = readTrace(directory);
    return scopes.every((scope) => trace.counts.has(scope) && trace.scopes.get(scope)?.endedAt) ? trace : null;
  }, `scopes ${scopes.join(", ")}`);
}

describe("a recorded web process", () => {
  let directory = "";
  let traced = null;
  let untraced = null;

  before(async () => {
    directory = path.join(await temporaryRoot(), "recording");
    await mkdir(directory);
    traced = await startServer(childEnvironment({ directory, sourceRoot: HTTP_FIXTURE }));
    untraced = await startServer(childEnvironment({ traced: false }));
  });

  after(async () => {
    await stopServer(traced);
    await stopServer(untraced);
  });

  test("concurrent requests record the same functions as each request alone", async () => {
    const concurrent = await Promise.all([
      request(traced.port, "/alpha", proxied("r_000001")),
      request(traced.port, "/beta", proxied("r_000002")),
      request(traced.port, "/gamma", proxied("r_000003"))
    ]);
    assert.deepEqual(concurrent.map((response) => response.text), ["hello alpha", "total 6", "ammag"]);
    for (const [pathname, id] of [["/alpha", "r_000011"], ["/beta", "r_000012"], ["/gamma", "r_000013"]]) {
      await request(traced.port, pathname, proxied(id));
    }
    const trace = await waitForScopes(directory, ["r_000001", "r_000002", "r_000003", "r_000011", "r_000012", "r_000013"]);
    assert.deepEqual(countsOf(trace, "r_000001"), countsOf(trace, "r_000011"));
    assert.deepEqual(countsOf(trace, "r_000002"), countsOf(trace, "r_000012"));
    assert.deepEqual(countsOf(trace, "r_000003"), countsOf(trace, "r_000013"));
    for (const id of ["r_000001", "r_000011"]) assert.equal(trace.scopes.get(id).kind, "request");

    // ESM, TypeScript and CommonJS project files are all recorded.
    const alpha = countsOf(trace, "r_000001");
    assert.equal(alpha["lib/routes.mjs:12:1:alphaStep"], 1);
    assert.equal(alpha["lib/format.ts:5:8:formatGreeting"], 1);
    assert.equal(alpha["lib/legacy.cjs:4:3:legacyTotal"], undefined);
    const beta = countsOf(trace, "r_000002");
    assert.equal(beta["lib/legacy.cjs:4:3:legacyTotal"], 1);
    assert.equal(beta["lib/legacy.cjs:5:26:"], 3);
    assert.equal(beta["lib/routes.mjs:10:15:delay"], 2);
    assert.equal(countsOf(trace, "r_000003")["lib/routes.mjs:20:19:gammaStep"], 1);

    const format = [...trace.files.values()].find((file) => file.path === "lib/format.ts");
    const formatBytes = readFileSync(path.join(HTTP_FIXTURE, "lib/format.ts"));
    assert.equal(format.hash, `sha256:${createHash("sha256").update(formatBytes).digest("hex")}`);
    const formatGreeting = [...trace.functions.values()].find((entry) => entry.name === "formatGreeting");
    assert.deepEqual([formatGreeting.start, formatGreeting.end], [{ line: 5, column: 8 }, { line: 8, column: 2 }]);
    assert.ok(trace.lines.findIndex((line) => line.type === "tracer" && line.state === "ready") === 1);
  });

  test("local requests, rejected proxy ids and background work get their own scopes", async () => {
    await request(traced.port, "/gamma?token=abc#frag");
    await request(traced.port, "/beta", proxied("r_12"));
    const local = `l_${traced.pid}_1`;
    const rejected = `l_${traced.pid}_2`;
    const trace = await waitForScopes(directory, [local, rejected]);
    assert.deepEqual(
      [trace.scopes.get(local).kind, trace.scopes.get(local).label, trace.scopes.get(rejected).label],
      ["local-request", "GET /gamma", "GET /beta"]
    );
    const background = `bg_${traced.pid}`;
    assert.equal(trace.scopes.get(background).kind, "background");
    assert.ok(countsOf(trace, background)["lib/routes.mjs:27:8:housekeeping"] > 0);
    assert.equal(countsOf(trace, background)["lib/routes.mjs:12:1:alphaStep"], undefined);
  });

  test("a file the parser rejects is reported and still runs", async () => {
    assert.deepEqual(await request(traced.port, "/odd", proxied("r_000021")), { status: 200, text: "odd true" });
    await waitFor(() => readTrace(directory).lines.some((line) => (
      line.type === "diagnostic" && line.code === "PARSE_FAILED" && line.path === "lib/odd.cjs"
    )), "the parse diagnostic");
    assert.ok(![...readTrace(directory).files.values()].some((file) => file.path === "lib/odd.cjs"));
  });

  test("error stacks point at the same lines and columns as an unrecorded process", async () => {
    const recorded = await request(traced.port, "/boom", proxied("r_000022"));
    const plain = await request(untraced.port, "/boom");
    assert.match(plain.text, /routes\.mjs:24:9\)/u);
    assert.equal(recorded.text, plain.text);
  });

  test("no request contents reach the recording", async () => {
    const secret = "SECRET_7f3a";
    const response = await request(traced.port, `/alpha?token=${secret}_QUERY`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}_AUTH`,
        cookie: `session=${secret}_COOKIE`,
        "content-type": "application/json",
        "x-vibe64-recording-request": "r_000099"
      },
      body: JSON.stringify({ password: `${secret}_BODY` })
    });
    assert.equal(response.text, "hello alpha");
    await request(traced.port, `/beta?token=${secret}_LOCAL`, { headers: { authorization: `Basic ${secret}` } });
    const trace = await waitForScopes(directory, ["r_000099", `l_${traced.pid}_3`]);
    assert.equal(trace.scopes.get(`l_${traced.pid}_3`).label, "GET /beta");
    for (const name of readdirSync(directory)) {
      assert.ok(!readFileSync(path.join(directory, name), "utf8").includes(secret), `${name} holds no request contents`);
    }
  });
});

describe("stopping and setup", () => {
  test("Stop writes the idle line and recording stops growing", async () => {
    const directory = await temporaryRoot();
    // A malformed control file means keep recording.
    writeFileSync(path.join(directory, "control.json"), "{");
    const server = await startServer(childEnvironment({ directory, sourceRoot: HTTP_FIXTURE }));
    try {
      await request(server.port, "/alpha", proxied("r_000001"));
      await waitForScopes(directory, ["r_000001"]);
      writeFileSync(path.join(directory, "control.json"), JSON.stringify({ state: "stopping" }));
      const [name] = traceFiles(directory);
      await waitFor(() => readFileSync(path.join(directory, name), "utf8").endsWith("{\"type\":\"tracer\",\"state\":\"idle\"}\n"), "the idle line");
      const size = lstatSync(path.join(directory, name)).size;
      for (const id of ["r_000002", "r_000003", "r_000004"]) {
        assert.equal((await request(server.port, "/beta", proxied(id))).text, "total 6");
      }
      await new Promise((resolve) => setTimeout(resolve, USAGE_RECORDING_LIMITS.flushIntervalMs * 1.5));
      assert.equal(lstatSync(path.join(directory, name)).size, size);
      assert.ok(!readTrace(directory).scopes.has("r_000002"));
    } finally {
      await stopServer(server);
    }
    // The exit after Stop writes nothing either.
    assert.ok(readFileSync(path.join(directory, traceFiles(directory)[0]), "utf8").endsWith("\"idle\"}\n"));
  });

  test("a process started after Stop records and writes nothing", async () => {
    const directory = await temporaryRoot();
    writeFileSync(path.join(directory, "control.json"), JSON.stringify({ state: "stopping" }));
    const server = await startServer(childEnvironment({ directory, sourceRoot: HTTP_FIXTURE }));
    try {
      assert.equal((await request(server.port, "/alpha", proxied("r_000001"))).text, "hello alpha");
      await new Promise((resolve) => setTimeout(resolve, USAGE_RECORDING_LIMITS.flushIntervalMs * 1.5));
    } finally {
      await stopServer(server);
    }
    runCli(childEnvironment({ directory, sourceRoot: CLI_FIXTURE, targetKind: "terminal" }));
    assert.deepEqual(readdirSync(directory), ["control.json"]);
  });

  test("a terminal run is recorded under its run scope and flushed on exit", async () => {
    const directory = await temporaryRoot();
    const result = runCli(childEnvironment({ directory, sourceRoot: CLI_FIXTURE, targetKind: "terminal" }));
    assert.deepEqual(traceFiles(directory), [`hits-nodejs-${result.pid}.ndjson`]);
    assert.equal(lstatSync(path.join(directory, traceFiles(directory)[0])).mode & 0o777 & ~0o660, 0);
    const trace = readTrace(directory);
    const run = trace.scopes.get(`run_${result.pid}`);
    assert.equal(run.kind, "run");
    assert.ok(run.endedAt);
    assert.deepEqual(countsOf(trace, `run_${result.pid}`), { "lib/words.mjs:1:8:shout": 3, "lib/words.mjs:5:27:countWords": 1 });
    assert.deepEqual(trace.lines[0], { ...trace.lines[0], type: "header", runtime: "nodejs", runtimeVersion: process.versions.node, pid: result.pid });
  });

  test("misconfigured recordings leave the process untouched", async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, "recording");
    await mkdir(directory);
    const linked = path.join(root, "linked");
    symlinkSync(directory, linked);
    const cases = [
      { directory: "recording", sourceRoot: CLI_FIXTURE, targetKind: "terminal" },
      { directory: linked, sourceRoot: CLI_FIXTURE, targetKind: "terminal" },
      { directory: path.join(root, "missing"), sourceRoot: CLI_FIXTURE, targetKind: "terminal" },
      { directory, sourceRoot: path.join(root, "missing"), targetKind: "terminal" },
      { directory, sourceRoot: "node-cli", targetKind: "terminal" },
      { directory, sourceRoot: CLI_FIXTURE, targetKind: "desktop" },
      { directory, sourceRoot: CLI_FIXTURE, targetKind: null }
    ];
    for (const setup of cases) runCli(childEnvironment(setup));
    assert.deepEqual(readdirSync(directory), []);
    assert.ok(!existsSync(path.join(root, "missing")));
    assert.ok(!existsSync(path.join(CLI_FIXTURE, "recording")));
  });

  test("Node.js without in-thread module hooks reports it once and stays inert", async () => {
    const directory = await temporaryRoot();
    const result = runCli(childEnvironment({ directory, sourceRoot: CLI_FIXTURE, targetKind: "terminal", preImports: [WITHOUT_HOOKS] }));
    const trace = readTrace(directory);
    assert.deepEqual(trace.lines.map((line) => line.type), ["header", "diagnostic"]);
    assert.deepEqual(trace.lines[1], { type: "diagnostic", code: "NODE_TOO_OLD" });
    assert.equal(trace.lines[0].pid, result.pid);
  });

  test("the Node.js tracer hands the exec helper its preload", () => {
    const tracer = USAGE_TRACERS.find((entry) => entry.runtime === "nodejs");
    assert.deepEqual(tracer.prepare({}), { available: true, environment: {}, prependEnvironment: {}, nodePreload: PRELOAD });
  });
});

describe("trace writer", () => {
  test("a new file never replaces an existing one", async () => {
    const directory = await temporaryRoot();
    writeFileSync(path.join(directory, "hits-nodejs-41.ndjson"), "existing\n");
    writeFileSync(path.join(directory, "hits-nodejs-41-2.ndjson"), "existing\n");
    const writer = createTraceWriter({ directory, pid: 41 });
    assert.ok(writer.start([{ type: "tracer", state: "ready" }]));
    assert.equal(writer.fileName, "hits-nodejs-41-3.ndjson");
    assert.equal(readFileSync(path.join(directory, "hits-nodejs-41.ndjson"), "utf8"), "existing\n");
  });

  test("the size limit ends the file with a truncated line", async () => {
    const directory = await temporaryRoot();
    const writer = createTraceWriter({ directory, pid: 42, maxFileBytes: 2048 });
    writer.start();
    writer.declareFile(0, "a.mjs", `sha256:${"0".repeat(64)}`);
    const scope = { id: "run_42", kind: "run", label: "", startedAt: "2026-10-30T00:00:00.000Z", endedAt: "", counts: new Map(), lineWritten: false, endWritten: false };
    for (let flush = 0; flush < 50 && writer.active; flush += 1) {
      writer.declareFunction(0, { functionIndex: flush, name: `f${flush}`, start: { line: flush + 1, column: 1 }, end: { line: flush + 1, column: 9 } });
      writer.hit(scope, flush);
      writer.flush();
    }
    assert.equal(writer.active, false);
    const text = readFileSync(path.join(directory, writer.fileName), "utf8");
    assert.ok(text.length <= 2048);
    assert.ok(text.endsWith("{\"type\":\"truncated\",\"reason\":\"size-limit\"}\n"));
    writer.hit(scope, 1);
    writer.flush();
    writer.finish();
    assert.equal(readFileSync(path.join(directory, writer.fileName), "utf8"), text);
  });

  test("a flush is asked for once enough new entries are waiting, and hits are per-flush deltas", async () => {
    const directory = await temporaryRoot();
    let asked = 0;
    const writer = createTraceWriter({ directory, pid: 43, flushEntries: 3, onFlushNeeded: () => { asked += 1; } });
    writer.start();
    const scope = { id: "bg_43", kind: "background", label: "", startedAt: "2026-10-30T00:00:00.000Z", endedAt: "", counts: new Map(), lineWritten: false, endWritten: false };
    for (const functionIndex of [0, 0, 1, 1]) writer.hit(scope, functionIndex);
    assert.equal(asked, 0);
    writer.hit(scope, 2);
    assert.equal(asked, 1);
    writer.flush();
    writer.hit(scope, 0);
    writer.flush();
    writer.flush();
    const lines = readFileSync(path.join(directory, writer.fileName), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.slice(1), [
      { type: "scope", scope: "bg_43", kind: "background", startedAt: "2026-10-30T00:00:00.000Z" },
      { type: "hits", scope: "bg_43", counts: [[0, 2], [1, 2], [2, 1]] },
      { type: "hits", scope: "bg_43", counts: [[0, 1]] }
    ]);
  });
});

describe("source instrumentation", () => {
  const instrument = (source, options = {}) => instrumentSource(source, { parse, ...options });

  test("adds no lines, keeps directives first and wraps expression bodies", () => {
    const source = [
      "function strict(a) {",
      "  \"use strict\"",
      "  return a;",
      "}",
      "const double = (value) => value * 2;",
      "const object = { method() { return 1; }, arrow: async () => ({ ok: true }), \"quoted\": function () {} };"
    ].join("\n");
    const { code, functions } = instrument(source);
    assert.equal(code.split("\n").length, source.split("\n").length);
    assert.match(code, /"use strict";__vibe64UsageHit\(0\);/u);
    assert.match(code, /\(value\) => \(__vibe64UsageHit\(1\), value \* 2\);/u);
    assert.ok(code.includes("async () => ((__vibe64UsageHit(3), { ok: true }))"));
    assert.deepEqual(functions.map((entry) => entry.name), ["strict", "double", "method", "arrow", "quoted"]);
    assert.deepEqual(functions[1], { functionIndex: 1, name: "double", start: { line: 5, column: 16 }, end: { line: 5, column: 36 } });
  });

  test("names class members, skips type-only declarations and starts after decorators", () => {
    const source = [
      "export default class Shelf {",
      "  #count = 0;",
      "  @logged",
      "  add(item: string): void { this.#count += 1; }",
      "  #reset = () => { this.#count = 0; };",
      "  get size() { return this.#count; }",
      "  abstractLike?(): void;",
      "}",
      "export function overloaded(value: string): string;",
      "export function overloaded(value: unknown) { return value; }",
      "export const handlers = { save: (input: number) => input };"
    ].join("\n");
    const { functions } = instrument(source, { typescript: true, nextFunctionIndex: 10 });
    assert.deepEqual(functions.map((entry) => [entry.functionIndex, entry.name, entry.start.line, entry.start.column]), [
      [10, "add", 4, 3],
      [11, "#reset", 5, 12],
      [12, "size", 6, 3],
      [13, "overloaded", 10, 8],
      [14, "save", 11, 33]
    ]);
  });

  test("CommonJS keeps script parsing and a syntax error throws for the caller", () => {
    const { functions } = instrument("return module.exports = function main() {};", { commonjs: true });
    assert.deepEqual(functions.map((entry) => entry.name), ["main"]);
    assert.throws(() => instrument("const target = new.target;", { commonjs: true }), SyntaxError);
  });
});
