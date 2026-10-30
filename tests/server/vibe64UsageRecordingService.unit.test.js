import assert from "node:assert/strict";
import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { activeUsageRecording, stopActiveUsageRecording } from "@local/vibe64-usage-recording/server/activeRecordings";
import { mergePrependEnvironment } from "@local/vibe64-usage-recording/server/tracers";
import nodejs from "../../packages/vibe64-usage-recording/src/server/tracers/nodejs.js";
import { createService } from "../../packages/vibe64-usage-recording/src/server/service.js";

const HASH = `sha256:${"b".repeat(64)}`;
const SESSION_ID = "session-one";
const SCOPE = "project:demo";
const NOT_LOADED = "The application did not load the recorder. This Output target may not run a supported runtime directly.";
const TARGETS = Object.freeze([
  { id: "web", label: "Web app", web: true, available: true, disabledReason: "", runtimes: ["nodejs"], parameters: [] },
  { id: "sessions-cli", label: "List sessions", web: false, available: true, disabledReason: "", runtimes: ["nodejs"],
    parameters: [{ id: "limit", label: "Limit", required: false, default: "10" }] },
  { id: "docs", label: "Build docs", web: false, available: true, disabledReason: "", runtimes: ["go"], parameters: [] }
]);

const inProject = (operation) => runWithProjectRequestContext({ slug: "demo" }, operation);

async function waitFor(read, predicate, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value)) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
    await delay(15);
    value = await read();
  }
  return value;
}

async function recorder(t, { status = "active", startResult = null, admission, timing = {}, targets = TARGETS } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-service-"));
  const sourceRoot = path.join(root, "state/sessions/active", SESSION_ID, "source");
  const sessionRoot = path.join(root, "state/roots", SESSION_ID);
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  const session = {
    sessionId: SESSION_ID, status, sessionRoot,
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" }
  };
  const starts = [];
  const published = [];
  const service = createService({
    admission,
    events: { publish: async (event) => published.push(event) },
    projectService: { createRuntime: async () => ({ getSession: async () => session }) },
    terminals: {
      usageRecordingTargets: async () => ({ ok: true, previewTargetId: "web", targets }),
      startOutputTargetTerminal: async (sessionId, input) => {
        starts.push(input);
        return startResult ? startResult(input) : { ok: true };
      }
    },
    timing: { durationMs: 60_000, eventMs: 0, pollMs: 10, readyMs: 5000, stopIdleMs: 150, ...timing }
  });
  t.after(async () => {
    await stopActiveUsageRecording(SCOPE, SESSION_ID);
    await delay(200);
    await rm(root, { force: true, recursive: true });
  });
  const call = (method, input = {}) => inProject(() => service[method]({ sessionId: SESSION_ID, ...input }));
  const current = async () => (await call("readCurrent")).recording;
  return { call, current, published, root, session, sessionRoot, sourceRoot, starts };
}

// A stand-in tracer: the lines a recorder writes into the recording directory.
function tracer(directory, pid = 4242) {
  const file = path.join(directory, `hits-nodejs-${pid}.ndjson`);
  const write = (lines) => appendFile(file, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
  const at = new Date().toISOString();
  return {
    file,
    ready: () => write([
      { type: "header", schema: "vibe64.usage-trace.v1", runtime: "nodejs", runtimeVersion: "26.5.0", pid, startedAt: at },
      { type: "tracer", state: "ready" },
      { type: "file", fileIndex: 0, path: "lib/routes.mjs", hash: HASH },
      { type: "function", functionIndex: 0, fileIndex: 0, name: "listSessions", start: { line: 3, column: 1 }, end: { line: 6, column: 2 } }
    ]),
    hit: (scope, kind = "request", label) => write([
      { type: "scope", scope, kind, ...(label ? { label } : {}), startedAt: at },
      { type: "hits", scope, counts: [[0, 2]] }
    ]),
    write,
    idle: () => write([{ type: "tracer", state: "idle" }])
  };
}

const launchOf = (input) => activeUsageRecording(SCOPE, SESSION_ID)?.launch(input) || null;
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

test("prepended tracer variables keep both values' segments", () => {
  const merge = (value, existing) => mergePrependEnvironment({ NAME: value },
    existing === undefined ? {} : { NAME: existing }, ":").NAME;
  assert.equal(merge("/ours:", undefined), "/ours:");
  assert.equal(merge("/ours:", ""), "/ours:");
  assert.equal(merge("/ours:", ":/extra"), "/ours::/extra");
  assert.equal(merge("/ours:", "/x"), "/ours:/x");
  assert.equal(merge("/py", "/a"), "/py:/a");
  assert.equal(merge("/py", ":/a"), "/py::/a");
  assert.equal(merge("/py", undefined), "/py");
  assert.deepEqual(mergePrependEnvironment({ PATH: "C:\\ours" }, { PATH: "C:\\theirs" }, ";"), { PATH: "C:\\ours;C:\\theirs" });
  assert.deepEqual(mergePrependEnvironment({}, { PYTHONPATH: "/app" }), {});
});

test("targets list Preview and each terminal Output target with what can be recorded", async (t) => {
  const { call } = await recorder(t);
  const expected = await readJson(new URL("../fixtures/usage-map/recording/api/targets.json", import.meta.url));
  assert.deepEqual(await call("readTargets"), expected);
});

test("a Preview recording numbers requests, follows its tracers and stops with results", async (t) => {
  const { call, current, published, starts } = await recorder(t);
  const { recording } = await call("start", { targetId: "preview" });
  assert.equal(recording.state, "starting");
  assert.deepEqual(recording.target, { id: "preview", kind: "web", label: "Preview" });
  assert.deepEqual(recording.tracers, [{ runtime: "nodejs", state: "starting", reason: "" }]);
  await waitFor(async () => starts.length, (count) => count === 1, "the Preview restart");
  assert.deepEqual(starts[0], { restartPreview: true });
  await assert.rejects(call("start", { targetId: "preview" }), { statusCode: 409, code: "vibe64_usage_recording_active" });

  // Every web launch of the session carries the recorder; terminal targets do not.
  assert.equal(launchOf({ web: false, outputTargetId: "sessions-cli" }), null);
  const launch = launchOf({ web: true, outputTargetId: "web", environment: { PYTHONPATH: "/app" } });
  const directory = launch.environment.VIBE64_USAGE_RECORDING_DIR;
  assert.equal(launch.environment.VIBE64_USAGE_TARGET_KIND, "web");
  assert.equal(launch.usageRecordingPreload, await realpath(nodejs.prepare({}).nodePreload));
  assert.equal("NODE_OPTIONS" in launch.environment, false);
  const stored = await readJson(path.join(directory, "recording.json"));
  assert.equal(stored.target.label, "Preview");
  assert.deepEqual(await readJson(path.join(directory, "control.json")), { state: "recording" });
  assert.equal((await stat(directory)).mode & 0o7777, 0o2770);

  // The proxy's numbering: sequential ids, a valid interaction only, no query.
  const active = activeUsageRecording(SCOPE, SESSION_ID);
  const first = active.proxyRequest({ method: "get", path: "/api/sessions?token=secret#x", interaction: "i_0001" });
  const second = active.proxyRequest({ method: "POST", path: "/api/sessions", interaction: "i_1;drop" });
  assert.deepEqual([first.requestId, first.interaction, second.requestId, second.interaction], ["r_000001", "i_0001", "r_000002", null]);
  first.finish({ status: 200 });
  second.finish({ status: 201 });

  const trace = tracer(directory);
  await trace.ready();
  await trace.hit("r_000001");
  const recordingNow = await waitFor(current, (value) => value?.state === "recording" && value.counts.requests === 1, "recording");
  assert.deepEqual(recordingNow.tracers, [{ runtime: "nodejs", state: "ready", reason: "" }]);
  assert.ok(published.some((event) => event.realtime.payload.state === "recording" && event.realtime.payload.projectSlug === "demo"));
  assert.equal(published.at(-1).realtime.event, "vibe64.usage-recording.changed");
  assert.deepEqual(published.at(-1).realtime.audience, { room: `vibe64:project:demo:session:${SESSION_ID}` });

  // Stop always agrees at once, and again.
  const stopping = (await call("stop", { recordingId: recording.id })).recording;
  assert.equal(stopping.state, "stopping");
  assert.equal(stopping.stopReason, "person");
  assert.equal((await call("stop", { recordingId: recording.id })).recording.state, "stopping");
  assert.deepEqual(await readJson(path.join(directory, "control.json")), { state: "stopping" });
  assert.equal(activeUsageRecording(SCOPE, SESSION_ID), null);
  await trace.idle();
  const stopped = await waitFor(current, (value) => value?.state === "stopped", "stopped");
  assert.equal(stopped.stopReason, "person");
  assert.deepEqual(stopped.tracers, [{ runtime: "nodejs", state: "idle", reason: "" }]);
  assert.equal((await call("stop", { recordingId: recording.id })).recording.state, "stopped");

  const requests = await call("readRequests", { recordingId: recording.id });
  assert.deepEqual(requests.requests.map(({ id, method, path: requestPath, status, functionCount }) => ({ id, method, path: requestPath, status, functionCount })),
    [{ id: "r_000001", method: "GET", path: "/api/sessions", status: 200, functionCount: 1 }]);
  assert.equal((await call("readRequests", { recordingId: recording.id, includeEmpty: true })).requests.length, 2);
  assert.deepEqual((await call("readRequestFunctions", { recordingId: recording.id, requestId: "r_000001" })).functions,
    [{ path: "lib/routes.mjs", hash: HASH, name: "listSessions", start: { line: 3, column: 1 }, end: { line: 6, column: 2 }, count: 2, plumbing: false }]);
  assert.ok((await readdir(directory)).includes("index.json"));

  await call("dismiss", { recordingId: recording.id });
  assert.equal(await current(), null);
  assert.equal((await call("list")).recordings[0].dismissedAt !== null, true);
  assert.deepEqual(await call("delete", { recordingId: recording.id }), { ok: true });
  assert.deepEqual((await call("list")).recordings, []);
});

test("module and asset loads are counted, and a full request log says so", async (t) => {
  const { call, current } = await recorder(t);
  const { recording } = await call("start", { targetId: "preview" });
  assert.deepEqual(recording.requestLog, { assets: 0, full: false });
  const directory = launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR;
  const active = activeUsageRecording(SCOPE, SESSION_ID);
  const assets = [
    { path: "/@vite/client" }, { path: "/@fs/app/node_modules/vue/index.js" }, { path: "/@id/virtual:icons" },
    { path: "/node_modules/.vite/deps/vue.js" }, { path: "/src/App.vue" }, { path: "/src/main.ts" },
    { path: "/api/logo", fetchDest: "image" }, { path: "/theme", fetchDest: "style" },
    { path: "/fonts/inter", fetchDest: "font" }, { path: "/api/bundle", fetchDest: "script" }
  ];
  for (const asset of assets) assert.equal(active.proxyRequest({ method: "GET", ...asset }), null, asset.path);
  // Requests a page makes itself are listed, whatever their path looks like.
  const listed = [
    active.proxyRequest({ method: "GET", path: "/", fetchDest: "document" }),
    active.proxyRequest({ method: "GET", path: "/api/config.js", fetchDest: "empty" }),
    active.proxyRequest({ method: "POST", path: "/api/sessions" })
  ];
  assert.deepEqual(listed.map((request) => request.requestId), ["r_000001", "r_000002", "r_000003"]);
  listed.forEach((request) => request.finish({ status: 200 }));
  assert.deepEqual((await current()).requestLog, { assets: 10, full: false });
  const logged = await waitFor(async () => (await readFile(path.join(directory, "requests.ndjson"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean),
    (lines) => lines.length === 3, "three logged requests");
  assert.deepEqual(logged.map((line) => JSON.parse(line).path), ["/", "/api/config.js", "/api/sessions"]);

  // The log keeps its line limit, and the recording says it stopped logging.
  for (let index = 3; index < 20_000; index += 1) active.proxyRequest({ method: "GET", path: "/api/ping" }).finish({ status: 204 });
  assert.equal((await current()).requestLog.full, false);
  const unlogged = active.proxyRequest({ method: "GET", path: "/api/late" });
  unlogged.finish({ status: 200 });
  assert.deepEqual((await current()).requestLog, { assets: 10, full: true });
  const trace = tracer(directory);
  await trace.ready();
  await trace.hit(unlogged.requestId);
  await waitFor(current, (value) => value?.state === "recording", "recording");
  assert.equal((await call("stop", { recordingId: recording.id })).recording.requestLog.full, true);
  await trace.idle();
  // Stopping waits for the 20,000 queued log lines; allow for a busy machine.
  await waitFor(current, (value) => value?.state === "stopped", "stopped", 30_000);
  const { requests } = await call("readRequests", { recordingId: recording.id });
  // A request the full log missed still shows what ran, without a made-up path.
  assert.deepEqual(requests.map(({ id, method, path: requestPath }) => ({ id, method, path: requestPath })),
    [{ id: unlogged.requestId, method: null, path: null }]);
  assert.equal((await readJson(path.join(directory, "recording.json"))).requestLog.full, true);
});

test("stop during starting succeeds, and a session that ends stops its recording", async (t) => {
  const { call, current } = await recorder(t);
  const { recording } = await call("start", { targetId: "preview" });
  assert.equal((await call("stop", { recordingId: recording.id })).recording.state, "stopping");
  const stopped = await waitFor(current, (value) => value?.state === "stopped", "stopped");
  assert.equal(stopped.stopReason, "person");
  assert.deepEqual(stopped.tracers, [{ runtime: "nodejs", state: "unavailable", reason: NOT_LOADED }]);

  const next = (await call("start", { targetId: "preview" })).recording;
  await inProject(() => stopActiveUsageRecording(SCOPE, SESSION_ID));
  const ended = await waitFor(current, (value) => value?.id === next.id && value.state === "stopped", "session end");
  assert.equal(ended.stopReason, "session-ended");
});

test("a terminal target records its run and stops when it exits", async (t) => {
  const { call, current, starts } = await recorder(t);
  await assert.rejects(call("start", { targetId: "output:sessions-cli", parameters: { unknown: "1" } }),
    { statusCode: 422, code: "vibe64_usage_recording_parameters_invalid" });
  const { recording } = await call("start", { targetId: "output:sessions-cli", parameters: { limit: "5" } });
  await waitFor(async () => starts.length, (count) => count === 1, "the target start");
  assert.deepEqual(starts[0], { forceRestart: true, outputParameters: { limit: "5" }, outputTargetId: "sessions-cli" });
  assert.equal(launchOf({ web: true, outputTargetId: "web" }), null);
  const launch = launchOf({ web: false, outputTargetId: "sessions-cli" });
  assert.equal(launch.environment.VIBE64_USAGE_TARGET_KIND, "terminal");
  // Parameter values are passed to the launch only, never stored.
  const directory = launch.environment.VIBE64_USAGE_RECORDING_DIR;
  assert.equal((await readFile(path.join(directory, "recording.json"), "utf8")).includes("\"5\""), false);
  const trace = tracer(directory, 77);
  await trace.ready();
  await trace.hit("run_77", "run");
  launch.exited();
  const stopped = await waitFor(current, (value) => value?.state === "stopped", "target exit");
  assert.equal(stopped.stopReason, "target-exited");
  assert.equal(stopped.counts.requests, 1);
  const { requests } = await call("readRequests", { recordingId: recording.id });
  assert.deepEqual(requests.map(({ id, method, path: requestPath }) => ({ id, method, path: requestPath })),
    [{ id: "run_77", method: null, path: "List sessions" }]);

  // A run that exits without loading the recorder has nothing to show.
  await call("start", { targetId: "output:sessions-cli" });
  await waitFor(async () => starts.length, (count) => count === 2, "the second start");
  launchOf({ web: false, outputTargetId: "sessions-cli" }).exited();
  const unavailable = await waitFor(current, (value) => value?.state === "unavailable", "unavailable");
  assert.deepEqual(unavailable.tracers, [{ runtime: "nodejs", state: "unavailable", reason: NOT_LOADED }]);
});

test("recordings stop at their duration, request and size limits, and on a read error", async (t) => {
  await t.test("time-limit", async (t2) => {
    const { call, current } = await recorder(t2, { timing: { durationMs: 80 } });
    await call("start", { targetId: "preview" });
    assert.equal((await waitFor(current, (value) => value?.state === "stopped", "time limit")).stopReason, "time-limit");
  });
  await t.test("request-limit", async (t2) => {
    const { call, current } = await recorder(t2);
    await call("start", { targetId: "preview" });
    const trace = tracer(launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR);
    await trace.ready();
    const lines = [];
    for (let index = 1; index <= 2000; index += 1) {
      const scope = `r_${String(index).padStart(6, "0")}`;
      lines.push({ type: "scope", scope, kind: "request", startedAt: new Date().toISOString() }, { type: "hits", scope, counts: [[0, 1]] });
    }
    await trace.write(lines);
    const stopped = await waitFor(current, (value) => value?.state === "stopped", "request limit");
    assert.equal(stopped.stopReason, "request-limit");
    assert.equal(stopped.counts.requests, 2000);
  });
  await t.test("size-limit", async (t2) => {
    const { call, current } = await recorder(t2);
    await call("start", { targetId: "preview" });
    const directory = launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR;
    const diagnostic = `${JSON.stringify({ type: "diagnostic", code: "PARSE_FAILED", path: `lib/${"x".repeat(60 * 1024)}.mjs` })}\n`;
    for (const pid of [11, 12, 13]) {
      const trace = tracer(directory, pid);
      await trace.ready();
      await appendFile(trace.file, diagnostic.repeat(260));
    }
    assert.equal((await waitFor(current, (value) => value?.state === "stopped", "size limit", 15_000)).stopReason, "size-limit");
  });
  await t.test("error", { skip: process.getuid?.() === 0 }, async (t2) => {
    const { call, current } = await recorder(t2);
    await call("start", { targetId: "preview" });
    const trace = tracer(launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR);
    await trace.ready();
    await chmod(trace.file, 0);
    assert.equal((await waitFor(current, (value) => value?.state === "stopped", "read error")).stopReason, "error");
  });
});

test("a target that cannot start or never loads the recorder ends without results", async (t) => {
  await t.test("launch refused", async (t2) => {
    const { call, current } = await recorder(t2, { startResult: () => ({ ok: false, error: "Output target is disabled." }) });
    await call("start", { targetId: "preview" });
    const failed = await waitFor(current, (value) => value?.state === "failed", "failure");
    assert.deepEqual(failed.tracers, [{ runtime: "nodejs", state: "failed", reason: "Output target is disabled." }]);
    assert.equal(activeUsageRecording(SCOPE, SESSION_ID), null);
  });
  await t.test("recorder never ready", async (t2) => {
    const { call, current } = await recorder(t2, { timing: { readyMs: 100 } });
    await call("start", { targetId: "preview" });
    const unavailable = await waitFor(current, (value) => value?.state === "unavailable", "readiness timeout");
    assert.deepEqual(unavailable.tracers, [{ runtime: "nodejs", state: "unavailable", reason: NOT_LOADED }]);
  });
  await t.test("recorder explains itself", async (t2) => {
    const { call, current } = await recorder(t2, { timing: { readyMs: 150 } });
    await call("start", { targetId: "preview" });
    const trace = tracer(launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR);
    await trace.write([
      { type: "header", schema: "vibe64.usage-trace.v1", runtime: "nodejs", runtimeVersion: "20.1.0", pid: 4242, startedAt: new Date().toISOString() },
      { type: "diagnostic", code: "NODE_TOO_OLD" }
    ]);
    const unavailable = await waitFor(current, (value) => value?.state === "unavailable", "diagnostic");
    assert.equal(unavailable.tracers[0].reason, "Recording needs Node.js 22.15 or later.");
  });
  await t.test("previously started Preview", async (t2) => {
    const { call, starts } = await recorder(t2, {
      startResult: (input) => (input.restartPreview ? { ok: false, code: "vibe64_preview_not_started", error: "No Preview yet." } : { ok: true })
    });
    await call("start", { targetId: "preview" });
    await waitFor(async () => starts.length, (count) => count === 2, "the first Preview start");
    assert.deepEqual(starts[1], { ensurePreview: true, outputTargetId: "web" });
  });
});

test("start is refused for inactive sessions, unknown or unavailable targets and by the host", async (t) => {
  const archived = await recorder(t, { status: "archived" });
  await assert.rejects(archived.call("start", { targetId: "preview" }), { statusCode: 409, code: "vibe64_usage_recording_session_inactive" });
  const decisions = [];
  const refused = await recorder(t, {
    admission: async (input) => {
      decisions.push(input);
      return { admitted: false, reason: "Another recording is running in demo. Stop it first." };
    }
  });
  await assert.rejects(refused.call("start", { targetId: "nope" }), { statusCode: 422, code: "vibe64_usage_recording_target_unknown" });
  await assert.rejects(refused.call("start", { targetId: "output:docs" }), { statusCode: 422, message: "Recording not available for `go`" });
  await assert.rejects(refused.call("start", { targetId: "preview", parameters: { limit: "1" } }), { statusCode: 422 });
  await assert.rejects(refused.call("start", { targetId: "preview" }), {
    statusCode: 503,
    code: "vibe64_usage_recording_refused",
    message: "Another recording is running in demo. Stop it first.",
    details: { reason: "Another recording is running in demo. Stop it first." }
  });
  assert.deepEqual(decisions, [{ sessionId: SESSION_ID, projectSlug: "demo", targetKind: "web", runtimes: ["nodejs"] }]);
  // A refusal starts nothing and writes nothing.
  assert.deepEqual(await readdir(path.join(refused.sessionRoot)), []);
});

test("interactions are recorded only while Preview records, validated and capped", async (t) => {
  const { call, current } = await recorder(t);
  const { recording } = await call("start", { targetId: "preview" });
  assert.equal(recording.highestInteraction, 0);
  const directory = launchOf({ web: true }).environment.VIBE64_USAGE_RECORDING_DIR;
  const interaction = (id, extra = {}) => call("recordInteraction", {
    recordingId: recording.id, id, at: "2026-10-30T10:00:19.800Z", label: "button \"Add\"", componentFile: "src/components/SessionList.vue", ...extra
  });
  const taken = (nextInteraction) => ({ statusCode: 409, code: "vibe64_usage_recording_interaction_taken", details: { nextInteraction } });
  assert.deepEqual(await interaction("i_0001"), { ok: true });
  assert.equal((await current()).highestInteraction, 1, "a Preview page that loads now continues after i_0001");
  // A page that numbered from the start again (a reload, a second tab) is
  // refused, with the next free number.
  await assert.rejects(interaction("i_0001"), taken(2));
  for (const invalid of [{ componentFile: "/etc/passwd" }, { componentFile: "../x.vue" }, { at: "yesterday" }, { label: "x".repeat(81) }, { kind: "hover" }]) {
    await assert.rejects(interaction("i_0002", invalid), { statusCode: 422 }, JSON.stringify(invalid));
  }
  await assert.rejects(interaction("x_0002"), { statusCode: 422 });
  for (let index = 2; index <= 499; index += 1) await interaction(`i_${String(index).padStart(4, "0")}`, index === 2 ? { kind: "enter" } : {});
  assert.deepEqual(await interaction("i_0700"), { ok: true });
  assert.equal((await current()).highestInteraction, 700, "the highest number, not the count");
  await assert.rejects(interaction("i_0002"), taken(701));
  await assert.rejects(interaction("i_0501"), { statusCode: 422, code: "vibe64_usage_recording_interaction_limit" });
  const lines = (await readFile(path.join(directory, "interactions.ndjson"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 500);
  assert.deepEqual(JSON.parse(lines[0]), { id: "i_0001", at: "2026-10-30T10:00:19.800Z", label: "button \"Add\"", kind: "click", componentFile: "src/components/SessionList.vue" });
  assert.equal(JSON.parse(lines[1]).kind, "enter");
  await call("stop", { recordingId: recording.id });
  await waitFor(current, (value) => value?.state === "stopped", "stopped");
  await assert.rejects(interaction("i_0600"), { statusCode: 409 });
});

test("a recording left running by an earlier server process ends as an error", async (t) => {
  const { call, sessionRoot } = await recorder(t);
  const directory = path.join(sessionRoot, "usage-recordings", "rec_abcdefghijklmnopqrst");
  await mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  await writeFile(path.join(directory, "recording.json"), JSON.stringify({
    schema: "vibe64.usage-recording.v1", id: "rec_abcdefghijklmnopqrst", sessionId: SESSION_ID, state: "recording",
    target: { id: "preview", kind: "web", label: "Preview" }, runtimes: ["nodejs"], tracers: [], startedAt,
    stoppedAt: null, stopReason: null, counts: { requests: 0, functions: 0 }, truncated: false, dismissedAt: null, sourceIdentity: null
  }));
  await writeFile(path.join(directory, "control.json"), JSON.stringify({ state: "recording" }));
  const { recording } = await call("readCurrent");
  assert.equal(recording.state, "stopped");
  assert.equal(recording.stopReason, "error");
  assert.deepEqual(await readJson(path.join(directory, "control.json")), { state: "stopping" });
  assert.equal((await readJson(path.join(directory, "recording.json"))).state, "stopped");
});
