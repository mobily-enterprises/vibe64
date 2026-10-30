import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { mergePrependEnvironment } from "@local/vibe64-usage-recording/server/tracers";
import { usageScopeKind, usageTraceLineProblem } from "@local/vibe64-usage-recording/shared/contract";
import php from "../../packages/vibe64-usage-recording/src/server/tracers/php.js";
import { buildPhpUsageModule } from "../../packages/vibe64-usage-recording/runtime/php/build.mjs";
import {
  PHP_EXTENSION_DIRECTORY,
  PHP_USAGE_INI_NAME,
  phpUsageScanDirectory
} from "../../packages/vibe64-usage-recording/runtime/php/module.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(TEST_DIR, "../fixtures/usage-recording/php-http");
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "vibe64-usage-php-"));
// Every prepare() and build in this file uses this module cache.
process.env.VIBE64_USAGE_PHP_MODULE_CACHE = path.join(SCRATCH, "cache");

function onPath(command) {
  return String(process.env.PATH || "").split(path.delimiter).some((directory) => {
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

// Building needs php-config and phpize (PHP's development package) on PATH.
const BUILD_SKIP = !onPath("php") ? "php is not on PATH" : !onPath("php-config") ? "php-config (PHP's development package) is not on PATH" : false;
let build = null;
let recordingCount = 0;

// This computer's environment without recording variables. A PHP_INI_SCAN_DIR
// set here is the person's own, and recording keeps it.
function cleanEnvironment(extra = {}) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    !name.startsWith("VIBE64_USAGE_") && name !== "NODE_OPTIONS"
  )));
  return { ...environment, ...extra };
}

// The environment the recording service gives a recorded PHP process.
function recordedEnvironment({ recordingDirectory, targetKind = "web", sourceRoot = FIXTURE, extra = {} }) {
  const base = cleanEnvironment(extra);
  const prepared = php.prepare({ recordingDirectory, sourceRoot, recordingId: "rec_abcdefghijklmnopqrst", targetKind });
  assert.equal(prepared.available, true, prepared.reason);
  return {
    ...base,
    ...prepared.environment,
    ...mergePrependEnvironment(prepared.prependEnvironment, base),
    VIBE64_USAGE_RECORDING_DIR: recordingDirectory,
    VIBE64_USAGE_SOURCE_ROOT: sourceRoot,
    VIBE64_USAGE_TARGET_KIND: targetKind
  };
}

function newRecordingDirectory() {
  const directory = path.join(SCRATCH, `recording-${++recordingCount}`);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "control.json"), "{\"state\":\"recording\"}\n");
  return directory;
}

function hitsFiles(directory) {
  return fs.readdirSync(directory).filter((name) => /^hits-php-[0-9]+(-[0-9]+)?\.ndjson$/u.test(name)).sort();
}

// Reads every hits file into { pid, lines, scopes: Map(scope -> { kind, label, endedAt, counts: Map(key -> count) }) }.
function readTrace(directory) {
  return hitsFiles(directory).map((name) => {
    const lines = fs.readFileSync(path.join(directory, name), "utf8").split("\n").filter(Boolean).map((text) => {
      assert.ok(Buffer.byteLength(text) <= 64 * 1024, "trace lines stay within 64 KiB");
      const line = JSON.parse(text);
      assert.equal(usageTraceLineProblem(line), "", text);
      return line;
    });
    assert.equal(lines[0].type, "header");
    assert.equal(lines[0].runtime, "php");
    const files = new Map();
    const functions = new Map();
    const scopes = new Map();
    for (const line of lines) {
      if (line.type === "file") files.set(line.fileIndex, line);
      if (line.type === "function") {
        assert.ok(files.has(line.fileIndex), "a file is declared before its functions");
        functions.set(line.functionIndex, { ...line, path: files.get(line.fileIndex).path });
      }
      if (line.type === "scope") {
        assert.equal(usageScopeKind(line.scope), line.kind);
        const known = scopes.get(line.scope);
        scopes.set(line.scope, { counts: new Map(), ...known, ...line });
      }
      if (line.type === "hits") {
        assert.ok(scopes.has(line.scope), "a scope line comes before its hits");
        for (const [index, count] of line.counts) {
          assert.ok(functions.has(index), "a function is declared before its hits");
          const fn = functions.get(index);
          const key = `${fn.path}#${fn.name || "-"}@${fn.start.line}`;
          const counts = scopes.get(line.scope).counts;
          counts.set(key, (counts.get(key) || 0) + count);
        }
      }
    }
    return { name, pid: lines[0].pid, lines, files, functions, scopes };
  });
}

function runPhp(args, { env, cwd = FIXTURE }) {
  return spawnSync("php", args, { cwd, env, encoding: "utf8", timeout: 30000 });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function startServer(args, { env, cwd = FIXTURE, port }) {
  const child = spawn("php", args, { cwd, env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, 3000);
    await exited;
    clearTimeout(timer);
  };
  const deadline = Date.now() + 15000;
  for (;;) {
    const connected = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => resolve(false));
    });
    if (connected) break;
    if (child.exitCode !== null || Date.now() > deadline) {
      await stop();
      throw new Error(`php ${args.join(" ")} did not start: ${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { port, stop, stderr: () => stderr };
}

function request(port, pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: { connection: "close", ...headers } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function withServer(args, options, use) {
  const server = await startServer(args, options);
  try {
    return await use(server);
  } finally {
    await server.stop();
  }
}

function scopeKeys(scope) {
  return [...scope.counts.keys()].sort();
}

after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

test("prepare says what to run while the module is not built", () => {
  const result = php.prepare({ recordingDirectory: SCRATCH, sourceRoot: FIXTURE, recordingId: "rec_abcdefghijklmnopqrst", targetKind: "web" });
  assert.equal(result.available, false);
  assert.match(result.reason, /runtime\/php\/build\.mjs/u);
  assert.match(result.reason, /phpize/u);
});


test("prepare loads the built module through PHP_INI_SCAN_DIR and keeps PHP's own scan directory", () => {
  const previous = process.env.VIBE64_USAGE_PHP_MODULE_CACHE;
  process.env.VIBE64_USAGE_PHP_MODULE_CACHE = path.join(SCRATCH, "fake-cache");
  try {
    const scanDirectory = phpUsageScanDirectory();
    fs.mkdirSync(scanDirectory, { recursive: true });
    fs.writeFileSync(path.join(scanDirectory, PHP_USAGE_INI_NAME), "extension=/nowhere/vibe64_usage.so\n");
    const prepared = php.prepare({ recordingDirectory: SCRATCH, sourceRoot: FIXTURE, recordingId: "rec_abcdefghijklmnopqrst", targetKind: "terminal" });
    assert.deepEqual(prepared, { available: true, environment: {}, prependEnvironment: { PHP_INI_SCAN_DIR: `${scanDirectory}:` } });
    // As the recording service merges it: nothing set keeps PHP's default
    // directory (the trailing empty segment); a set value keeps exactly its own segments.
    const merge = (existing) => mergePrependEnvironment(prepared.prependEnvironment, { PHP_INI_SCAN_DIR: existing }, ":").PHP_INI_SCAN_DIR;
    assert.equal(merge(undefined), `${scanDirectory}:`);
    assert.equal(merge(""), `${scanDirectory}:`);
    assert.equal(merge("/etc/php.d"), `${scanDirectory}:/etc/php.d`);
    assert.equal(merge(":/etc/php.d"), `${scanDirectory}::/etc/php.d`);
  } finally {
    process.env.VIBE64_USAGE_PHP_MODULE_CACHE = previous;
  }
});

test("the PHP module opens no socket", () => {
  const source = fs.readFileSync(path.join(PHP_EXTENSION_DIRECTORY, "vibe64_usage.c"), "utf8");
  for (const call of ["socket(", "connect(", "bind(", "listen(", "accept(", "fork(", "pthread_create("]) {
    assert.equal(source.includes(call), false, call);
  }
});

// Genesis's own function records for the fixture files (start positions as the
// call web reports them), and the usage map's join rules 1, 2 and 4.
const GENESIS_FUNCTIONS = {
  "bin/run.php": [{ name: "", line: 1, column: 1 }],
  "prepend.php": [{ name: "", line: 1, column: 1 }, { name: "fixture_prepended", line: 4, column: 1 }],
  "public/index.php": [{ name: "", line: 1, column: 1 }],
  "src/helpers.php": [{ name: "", line: 1, column: 1 }, { name: "remember", line: 4, column: 1 }],
  "src/AlphaService.php": [
    { name: "", line: 1, column: 1 }, { name: "run", line: 6, column: 5 },
    { name: "alphaOnly", line: 11, column: 5 }, { name: "", line: 13, column: 36 }
  ],
  "src/BetaService.php": [
    { name: "", line: 1, column: 1 }, { name: "run", line: 6, column: 5 },
    { name: "betaOnly", line: 11, column: 5 }, { name: "", line: 13, column: 19 }
  ]
};

function joinStatus(fn) {
  const records = GENESIS_FUNCTIONS[fn.path] || [];
  if (records.some((record) => record.line === fn.start.line && record.column === fn.start.column)) return "exact";
  const named = fn.name ? records.filter((record) => record.name === fn.name && Math.abs(record.line - fn.start.line) <= 3) : [];
  return named.length === 1 ? "name-line" : "none";
}

describe("with the module built for this computer's PHP", { skip: BUILD_SKIP }, () => {
  let serverTrace = [];

  before(() => {
    build = buildPhpUsageModule();
  });

  test("the build command reuses a module built for the same PHP and source", () => {
    assert.equal(build.cached, false);
    assert.match(path.basename(path.dirname(build.modulePath)), /^[0-9]+-nts(-debug)?-[0-9a-f]{16}$/u);
    const again = buildPhpUsageModule();
    assert.equal(again.cached, true);
    assert.equal(again.modulePath, build.modulePath);
    assert.equal(again.scanDirectory, phpUsageScanDirectory());
    const ini = fs.readFileSync(path.join(again.scanDirectory, PHP_USAGE_INI_NAME), "utf8");
    assert.ok(ini.includes(`extension="${build.modulePath}"`));
  });

  test("a recorded PHP keeps loading the extensions it is installed with", () => {
    const modules = (env) => {
      const result = runPhp(["-m"], { env });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.split("\n").map((name) => name.trim()).filter((name) => name && !name.startsWith("["));
    };
    const prepared = php.prepare({ targetKind: "web" });
    const ours = prepared.prependEnvironment.PHP_INI_SCAN_DIR;
    const baseline = modules(cleanEnvironment());
    const recorded = modules(cleanEnvironment(mergePrependEnvironment(prepared.prependEnvironment, process.env)));
    assert.ok(recorded.includes("vibe64_usage"));
    for (const name of baseline) {
      assert.ok(recorded.includes(name), `${name} still loads`);
    }
    // A person's own value keeps its meaning: an extra directory with or without PHP's default.
    const extra = path.join(SCRATCH, "extra-ini");
    fs.mkdirSync(extra, { recursive: true });
    fs.writeFileSync(path.join(extra, "memory.ini"), "memory_limit=123M\n");
    const probe = "echo ini_get('memory_limit'), ' ', extension_loaded('vibe64_usage') ? 'loaded' : 'missing';";
    for (const existing of [extra, `:${extra}`]) {
      const env = cleanEnvironment(mergePrependEnvironment(prepared.prependEnvironment, { PHP_INI_SCAN_DIR: existing }));
      assert.equal(runPhp(["-r", probe], { env }).stdout, "123M loaded");
    }
    if (process.env.PHP_INI_SCAN_DIR) {
      return;
    }
    // The rest relies on PHP's compiled-in scan directory, which a set PHP_INI_SCAN_DIR replaces.
    assert.ok(baseline.every((name) => modules(cleanEnvironment(mergePrependEnvironment(prepared.prependEnvironment, { PHP_INI_SCAN_DIR: `:${extra}` }))).includes(name)));
    if (/Additional \.ini files parsed:\s+\S+\.ini/u.test(runPhp(["--ini"], { env: cleanEnvironment() }).stdout)) {
      // Without the trailing separator PHP would scan only our directory.
      const alone = modules(cleanEnvironment({ PHP_INI_SCAN_DIR: ours.slice(0, -1) }));
      assert.ok(baseline.some((name) => !alone.includes(name)));
    }
  });

  test("the module stays inert when misconfigured or already stopping", () => {
    const directory = newRecordingDirectory();
    const link = path.join(SCRATCH, "linked-recording");
    fs.symlinkSync(directory, link);
    const recorded = recordedEnvironment({ recordingDirectory: directory, targetKind: "terminal" });
    const cases = {
      "no recording variables": { VIBE64_USAGE_RECORDING_DIR: null, VIBE64_USAGE_SOURCE_ROOT: null },
      "a relative recording directory": { VIBE64_USAGE_RECORDING_DIR: path.relative(FIXTURE, directory) },
      "a symlinked recording directory": { VIBE64_USAGE_RECORDING_DIR: link },
      "a missing source root": { VIBE64_USAGE_SOURCE_ROOT: path.join(SCRATCH, "missing") },
      "a relative source root": { VIBE64_USAGE_SOURCE_ROOT: "." }
    };
    for (const [label, change] of Object.entries(cases)) {
      const env = Object.fromEntries(Object.entries({ ...recorded, ...change }).filter(([, value]) => value !== null));
      const result = runPhp(["bin/run.php"], { env });
      assert.deepEqual([result.status, result.stdout, result.stderr], [0, "ran\n", ""], label);
      assert.deepEqual(hitsFiles(directory), [], label);
    }
    fs.writeFileSync(path.join(directory, "control.json"), "{ \"state\": \"stopping\" }\n");
    assert.equal(runPhp(["bin/run.php"], { env: recorded }).stdout, "ran\n");
    assert.deepEqual(fs.readdirSync(directory).sort(), ["control.json"], "a process started after the stop writes no file");
  });

  test("a terminal run records its run scope with exact call counts", () => {
    const directory = newRecordingDirectory();
    const result = runPhp(["bin/run.php"], { env: recordedEnvironment({ recordingDirectory: directory, targetKind: "terminal" }) });
    assert.equal(result.stdout, "ran\n", result.stderr);
    const traces = readTrace(directory);
    assert.equal(traces.length, 1);
    const [trace] = traces;
    assert.equal(trace.name, `hits-php-${trace.pid}.ndjson`);
    assert.deepEqual(trace.lines[1], { type: "tracer", state: "ready" });
    assert.deepEqual([...trace.scopes.keys()], [`run_${trace.pid}`]);
    const scope = trace.scopes.get(`run_${trace.pid}`);
    assert.equal(scope.kind, "run");
    assert.equal(scope.label, undefined);
    assert.ok(scope.endedAt);
    assert.deepEqual(Object.fromEntries(scope.counts), {
      "bin/run.php#-@1": 1,
      "src/AlphaService.php#run@6": 3,
      "src/AlphaService.php#alphaOnly@11": 3,
      "src/AlphaService.php#-@13": 9
    });

    const web = newRecordingDirectory();
    runPhp(["bin/run.php"], { env: recordedEnvironment({ recordingDirectory: web, targetKind: "web" }) });
    const [background] = readTrace(web);
    assert.equal(background.scopes.get(`bg_${background.pid}`)?.kind, "background");
  });

  test("requests under php -S -t public are recorded one by one, with the project's auto_prepend_file", async () => {
    const directory = newRecordingDirectory();
    const port = await freePort();
    const env = { ...recordedEnvironment({ recordingDirectory: directory }), PHP_CLI_SERVER_WORKERS: "3" };
    const jobs = Array.from({ length: 12 }, (_, index) => ({ id: `r_${String(index + 1).padStart(6, "0")}`, service: index % 2 ? "beta" : "alpha" }));
    await withServer(["-d", `auto_prepend_file=${FIXTURE}/prepend.php`, "-S", `127.0.0.1:${port}`, "-t", "public"], { env, port }, async () => {
      const responses = await Promise.all(jobs.map((job) => request(port, `/${job.service}?sleep=150`, { headers: { "x-vibe64-recording-request": job.id } })));
      responses.forEach((response, index) => assert.equal(JSON.parse(response.body).service, jobs[index].service));
      assert.equal((await request(port, "/alpha?token=hidden#part")).status, 200);
    });
    serverTrace = readTrace(directory);
    const scopes = new Map(serverTrace.flatMap((trace) => [...trace.scopes].map(([id, scope]) => [id, { ...scope, pid: trace.pid }])));
    const shared = ["prepend.php#-@1", "prepend.php#fixture_prepended@4", "public/index.php#-@1", "src/helpers.php#remember@4"];
    for (const job of jobs) {
      const scope = scopes.get(job.id);
      assert.equal(scope?.kind, "request", job.id);
      const own = job.service === "alpha"
        ? ["src/AlphaService.php#-@13", "src/AlphaService.php#alphaOnly@11", "src/AlphaService.php#run@6"]
        : ["src/BetaService.php#-@13", "src/BetaService.php#betaOnly@11", "src/BetaService.php#run@6"];
      assert.deepEqual(scopeKeys(scope), [...shared, ...own].sort(), job.id);
      assert.ok(scope.endedAt);
    }
    const requestsPerProcess = serverTrace.map((trace) => [...trace.scopes.keys()].filter((id) => id.startsWith("r_")).length);
    assert.ok(Math.max(...requestsPerProcess) >= 2, "a worker process recorded several requests separately");
    const local = [...scopes.values()].filter((scope) => scope.kind === "local-request");
    assert.equal(local.length, 1);
    assert.match(local[0].scope, new RegExp(`^l_${local[0].pid}_[0-9]+$`, "u"));
    assert.equal(local[0].label, "GET /alpha");
  });

  test("requests through a router script, as php artisan serve runs them, are recorded one by one", async () => {
    const directory = newRecordingDirectory();
    const port = await freePort();
    await withServer(["bin/serve.php", String(port)], { env: recordedEnvironment({ recordingDirectory: directory }), port }, async () => {
      for (const [index, service] of ["alpha", "beta", "alpha"].entries()) {
        const response = await request(port, `/${service}`, { headers: { "x-vibe64-recording-request": `r_00000${index + 1}` } });
        assert.equal(JSON.parse(response.body).service, service);
      }
    });
    const traces = readTrace(directory);
    assert.ok(traces.length >= 2, "the serving command and its php -S child each load the recorder");
    const scopes = new Map(traces.flatMap((trace) => [...trace.scopes]));
    for (const [id, service] of [["r_000001", "Alpha"], ["r_000002", "Beta"], ["r_000003", "Alpha"]]) {
      const keys = scopeKeys(scopes.get(id));
      assert.ok(keys.includes("server.php#-@1"), id);
      assert.ok(keys.includes(`src/${service}Service.php#run@6`), id);
      assert.ok(!keys.some((key) => key.includes(service === "Alpha" ? "Beta" : "Alpha")), id);
    }
  });

  test("a stopped recording leaves a running server idle", async () => {
    const directory = newRecordingDirectory();
    const port = await freePort();
    await withServer(["-S", `127.0.0.1:${port}`, "-t", "public"], { env: recordedEnvironment({ recordingDirectory: directory }), port }, async () => {
      await request(port, "/alpha", { headers: { "x-vibe64-recording-request": "r_000001" } });
      fs.writeFileSync(path.join(directory, "control.json"), "{\"state\":\"stopping\"}\n");
      await request(port, "/alpha", { headers: { "x-vibe64-recording-request": "r_000002" } });
      await request(port, "/beta", { headers: { "x-vibe64-recording-request": "r_000003" } });
    });
    const [trace] = readTrace(directory);
    assert.deepEqual([...trace.scopes.keys()], ["r_000001"]);
    assert.deepEqual(trace.lines.at(-1), { type: "tracer", state: "idle" });
  });

  test("a php -S worker that first runs after the stop writes no file", async () => {
    const directory = newRecordingDirectory();
    const port = await freePort();
    const env = { ...recordedEnvironment({ recordingDirectory: directory }), PHP_CLI_SERVER_WORKERS: "2" };
    await withServer(["-S", `127.0.0.1:${port}`, "-t", "public"], { env, port }, async () => {
      fs.writeFileSync(path.join(directory, "control.json"), "{\"state\":\"stopping\"}\n");
      await Promise.all(["r_000001", "r_000002", "r_000003", "r_000004"].map((id) => (
        request(port, "/alpha?sleep=100", { headers: { "x-vibe64-recording-request": id } })
      )));
    });
    const traces = readTrace(directory);
    assert.equal(traces.length, 1, "only the server process that started while recording has a file");
    assert.equal(traces[0].scopes.size, 0);
  });

  test("records no query, header, cookie, body, argument or environment value", async () => {
    const directory = newRecordingDirectory();
    const port = await freePort();
    const env = { ...recordedEnvironment({ recordingDirectory: directory, extra: { FIXTURE_SECRET: "SECRET-ENV" } }) };
    await withServer(["-S", `127.0.0.1:${port}`, "-t", "public"], { env, port }, async () => {
      for (const id of ["r_000001", "r_00000SECRET-ID"]) {
        const response = await request(port, "/alpha?token=SECRET-QUERY", {
          method: "POST",
          headers: { cookie: "session=SECRET-COOKIE", authorization: "Bearer SECRET-HEADER", "x-vibe64-recording-request": id },
          body: "SECRET-BODY"
        });
        assert.equal(JSON.parse(response.body).service, "alpha");
      }
    });
    const traces = readTrace(directory);
    const kinds = traces.flatMap((trace) => [...trace.scopes.values()].map((scope) => scope.kind)).sort();
    assert.deepEqual(kinds, ["local-request", "request"]);
    for (const name of fs.readdirSync(directory)) {
      assert.equal(fs.readFileSync(path.join(directory, name), "utf8").includes("SECRET"), false, name);
    }
  });

  test("a process that keeps its pid writes its own second file", (t) => {
    const probe = recordedEnvironment({ recordingDirectory: newRecordingDirectory(), targetKind: "terminal" });
    if (runPhp(["-r", "echo function_exists('pcntl_exec') ? 'yes' : 'no';"], { env: probe }).stdout !== "yes") {
      t.skip("pcntl is not available in this PHP");
      return;
    }
    const directory = newRecordingDirectory();
    const result = runPhp(["bin/run.php"], { env: recordedEnvironment({ recordingDirectory: directory, targetKind: "terminal", extra: { FIXTURE_EXEC_AGAIN: "1" } }) });
    assert.equal(result.stdout, "ran\n", result.stderr);
    const traces = readTrace(directory);
    assert.deepEqual(traces.map((trace) => trace.name), [`hits-php-${traces[0].pid}-2.ndjson`, `hits-php-${traces[0].pid}.ndjson`]);
    assert.equal(traces[0].pid, traces[1].pid);
  });

  test("the usage map joins modules exactly, named functions by name and line, and leaves closures unjoined", () => {
    const statuses = {};
    for (const trace of serverTrace) {
      for (const fn of trace.functions.values()) {
        statuses[`${fn.path}#${fn.name || "-"}@${fn.start.line}`] = joinStatus(fn);
      }
    }
    assert.deepEqual(statuses, {
      "prepend.php#-@1": "exact",
      "prepend.php#fixture_prepended@4": "exact",
      "public/index.php#-@1": "exact",
      "src/helpers.php#remember@4": "exact",
      "src/AlphaService.php#run@6": "name-line",
      "src/AlphaService.php#alphaOnly@11": "name-line",
      "src/AlphaService.php#-@13": "none",
      "src/BetaService.php#run@6": "name-line",
      "src/BetaService.php#betaOnly@11": "name-line",
      "src/BetaService.php#-@13": "none"
    });
  });
});
