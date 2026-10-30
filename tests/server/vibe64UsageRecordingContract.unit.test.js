import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  USAGE_RECORDING_ADMISSION_TOKEN,
  USAGE_TRACERS,
  Vibe64UsageRecordingProvider,
  admitUsageRecording,
  recordingUnavailableReason,
  usageRecordingEnvironment,
  usageRecordingPath,
  usageRecordingsPath,
  usageTracersForRuntimes
} from "@local/vibe64-usage-recording/server";
import {
  USAGE_INTERACTION_ID_PATTERN,
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_LIMITS,
  USAGE_REQUEST_ID_PATTERN,
  USAGE_TRACER_RUNTIMES,
  usageScopeKind,
  usageTraceLineProblem
} from "@local/vibe64-usage-recording/shared/contract";
import { readPreviewLocatorSource } from "../../packages/vibe64-terminals/src/server/previewLocator.js";

const HASH = `sha256:${"a".repeat(64)}`;

function recordingHttp() {
  const registered = [];
  return { registered, http: { router: { register: (...route) => registered.push(route) } } };
}

async function setupProvider(dependencies) {
  const actions = [];
  const actionCatalogue = { register: (contribution) => actions.push(...contribution.actions) };
  const provided = await Vibe64UsageRecordingProvider.setup({
    events: { publish: async () => {} },
    logger: { warn: () => {} },
    project: {},
    terminals: {},
    ...dependencies,
    actionCatalogue
  }, {});
  return { ...provided, actions };
}

test("the application installs the usage recording package", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies["@local/vibe64-usage-recording"], "0.1.0");
  const gitignore = await readFile(new URL("../../.gitignore", import.meta.url), "utf8");
  assert.ok(gitignore.split("\n").includes("/.genesis/call-web.json"));
});

test("the provider registers its routes and actions and admits by default or through a host decision", async () => {
  const { registered, http } = recordingHttp();
  const { actions, usageRecording } = await setupProvider({ http });
  assert.equal(registered.length, 10);
  assert.equal(actions.length, 10);
  assert.ok(actions.every((action) => action.id.startsWith("vibe64.usage-recording.") && action.extensions.assistant.exclude === true));
  assert.equal(usageRecording.admit, admitUsageRecording);
  assert.deepEqual(await usageRecording.admit({ sessionId: "s", projectSlug: "p", targetKind: "web", runtimes: ["nodejs"] }), { admitted: true });

  const refusal = { admitted: false, reason: "Try again when other work finishes." };
  const admission = async () => refusal;
  const composed = await setupProvider({ http, admission });
  assert.equal(composed.usageRecording.admit, admission);
  assert.equal(Vibe64UsageRecordingProvider.optional.admission, USAGE_RECORDING_ADMISSION_TOKEN);
  assert.equal(USAGE_RECORDING_ADMISSION_TOKEN, "vibe64.usage-recording.admission");
});

test("recording directories sit beside the session and accept only recording ids", () => {
  const session = { sessionRoot: "/sessions/one" };
  assert.equal(usageRecordingsPath(session), path.join("/sessions/one", "usage-recordings"));
  assert.equal(usageRecordingPath(session, "rec_abcdefghijklmnopqrst"), path.join("/sessions/one", "usage-recordings", "rec_abcdefghijklmnopqrst"));
  assert.equal(usageRecordingPath(session, "../rec_abcdefghijklmnopqrst"), "");
  assert.equal(usageRecordingPath(session, "rec_ABCDEFGHIJKLMNOPQRST"), "");
  assert.equal(usageRecordingsPath({}), "");
});

test("each runtime tracer follows the tracer interface", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-tracers-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(USAGE_TRACERS.map((tracer) => tracer.runtime), USAGE_TRACER_RUNTIMES);
  for (const tracer of USAGE_TRACERS) {
    assert.equal(typeof tracer.label, "string");
    for (const targetKind of ["web", "terminal"]) {
      const result = await tracer.prepare({ recordingDirectory: directory, sourceRoot: directory, recordingId: "rec_abcdefghijklmnopqrst", targetKind });
      if (result.available === false) {
        assert.deepEqual(Object.keys(result).sort(), ["available", "reason"], tracer.runtime);
        assert.ok(result.reason.length > 0);
        continue;
      }
      assert.equal(result.available, true, tracer.runtime);
      for (const name of ["environment", "prependEnvironment"]) {
        assert.ok(Object.values(result[name]).every((value) => typeof value === "string"), `${tracer.runtime} ${name}`);
      }
      assert.ok(result.nodePreload === undefined || path.isAbsolute(result.nodePreload), tracer.runtime);
      assert.equal(Object.hasOwn(result.environment, "NODE_OPTIONS"), false, "nodePreload never travels as NODE_OPTIONS");
    }
  }
});

test("a target records only through tracers for its declared runtimes", () => {
  assert.deepEqual(usageTracersForRuntimes(["go", "nodejs"]).map((tracer) => tracer.runtime), ["nodejs"]);
  assert.deepEqual(usageTracersForRuntimes(["go"]), []);
  assert.equal(recordingUnavailableReason(["go"]), "Recording not available for `go`");
  assert.equal(recordingUnavailableReason(["go", "rust"]), "Recording not available for `go`, `rust`");
  assert.deepEqual(usageRecordingEnvironment({ recordingDirectory: "/r", sourceRoot: "/s", targetKind: "web" }), {
    VIBE64_USAGE_RECORDING_DIR: "/r", VIBE64_USAGE_SOURCE_ROOT: "/s", VIBE64_USAGE_TARGET_KIND: "web"
  });
});

test("recording identifiers and limits follow the recording contract", () => {
  assert.ok(USAGE_RECORDING_ID_PATTERN.test("rec_abcdefghijklmnopqr27"));
  for (const id of ["rec_abc", "rec_abcdefghijklmnopqr18", "rec_ABCDEFGHIJKLMNOPQRST"]) assert.equal(USAGE_RECORDING_ID_PATTERN.test(id), false, id);
  assert.ok(USAGE_REQUEST_ID_PATTERN.test("r_000037"));
  assert.equal(USAGE_REQUEST_ID_PATTERN.test("r_37"), false);
  for (const id of ["i_0004", "i_123456"]) assert.ok(USAGE_INTERACTION_ID_PATTERN.test(id), id);
  for (const id of ["i_004", "i_1234567", "i_00a4"]) assert.equal(USAGE_INTERACTION_ID_PATTERN.test(id), false, id);
  assert.deepEqual(["r_000037", "l_4242_3", "run_4242", "bg_4242", "x_1"].map(usageScopeKind),
    ["request", "local-request", "run", "background", ""]);
  assert.equal(USAGE_RECORDING_LIMITS.durationMs, 10 * 60 * 1000);
  assert.equal(USAGE_RECORDING_LIMITS.capturedRequests, 2000);
  assert.equal(USAGE_RECORDING_LIMITS.hitsBytesPerProcess, 16 * 1024 * 1024);
  assert.equal(USAGE_RECORDING_LIMITS.hitsBytesPerRecording, 32 * 1024 * 1024);
  assert.equal(USAGE_RECORDING_LIMITS.traceLineBytes, 64 * 1024);
});

test("usage trace lines are accepted only in their documented shapes", () => {
  const start = { line: 12, column: 3 };
  const end = { line: 40, column: 2 };
  const valid = [
    { type: "header", schema: "vibe64.usage-trace.v1", runtime: "nodejs", runtimeVersion: "26.1.0", pid: 4242, startedAt: "2026-10-30T10:00:00.000Z" },
    { type: "tracer", state: "ready" },
    { type: "file", fileIndex: 3, path: "packages/x/src/server/service.js", hash: HASH },
    { type: "function", functionIndex: 17, fileIndex: 3, name: "readStatus", start, end },
    { type: "function", functionIndex: 18, fileIndex: 3, name: "", start, end },
    { type: "scope", scope: "r_000037", kind: "request", startedAt: "t", endedAt: "t" },
    { type: "scope", scope: "l_4242_1", kind: "local-request", label: "GET /api/x", startedAt: "t" },
    { type: "scope", scope: "run_4242", kind: "run", label: "Run tests", startedAt: "t" },
    { type: "hits", scope: "r_000037", counts: [[17, 3], [18, 1]] },
    { type: "hits", scope: "bg_4242", counts: [[17, null]] },
    { type: "diagnostic", code: "PARSE_FAILED", path: "src/broken.js" },
    { type: "truncated", reason: "size-limit" },
    { type: "tracer", state: "idle" }
  ];
  for (const line of valid) assert.equal(usageTraceLineProblem(line), "", JSON.stringify(line));

  const invalid = [
    null,
    [],
    { type: "unknown" },
    { ...valid[0], schema: "vibe64.usage-trace.v2" },
    { ...valid[0], runtime: "go" },
    { type: "tracer", state: "running" },
    { ...valid[2], path: "../outside.js" },
    { ...valid[2], path: "/abs/path.js" },
    { ...valid[2], path: "node_modules/pkg/index.js" },
    { ...valid[2], hash: "sha1:abc" },
    { ...valid[3], start: { line: 0, column: 1 } },
    { ...valid[3], name: undefined },
    { ...valid[5], kind: "background" },
    { ...valid[5], label: "GET /api/x" },
    { type: "scope", scope: "bg_4242", kind: "background", label: "startup", startedAt: "t" },
    { type: "hits", scope: "r_37", counts: [[1, 1]] },
    { type: "hits", scope: "r_000037", counts: [[1, 0]] },
    { type: "hits", scope: "r_000037", counts: [[1]] },
    { type: "diagnostic", code: "" },
    { type: "truncated" }
  ];
  for (const line of invalid) assert.notEqual(usageTraceLineProblem(line), "", JSON.stringify(line));
});

test("the Preview locator reader returns no locator until locators are read", async () => {
  assert.equal(await readPreviewLocatorSource({ sessionRoot: "/sessions/one" }), "");
});
