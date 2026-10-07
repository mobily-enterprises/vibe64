import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { runTrainingCli } from "../../packages/vibe64-training/src/server/cli.js";
import { createInstalledTrainingContent } from "../../packages/vibe64-training/src/server/installedContent.js";
import { createTrainingLearnerState } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingDeclaredCheckOwner } from "../../packages/vibe64-training/src/server/declaredCheck.js";

// Preserved topic check, executed through the actual standalone finite gateway.
// Project/output transport seams below are explicit fixtures, not fleet proof.
const originalCheck = await readFile(new URL("../fixtures/training/orientation-response.mjs", import.meta.url));

async function fixture(t, { script = originalCheck, assets = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-declared-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "topic"), systemRoot = path.join(root, "system");
  async function write(filename, bytes, base = source) {
    const file = path.join(base, filename);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof bytes === "object" && !Buffer.isBuffer(bytes) ? JSON.stringify(bytes) : bytes);
  }
  await write("package.json", { name: "learn-check", version: "0.1.0",
    repository: { type: "git", url: "https://github.com/examples/learn-check.git" },
    vibe64Training: { schemaVersion: 1, topicId: "check", domainId: "vibe64", title: "Use Preview", status: "preview",
      outline: "outline.md", prerequisites: [], lessons: [{ code: "USE-ONE", descriptor: "lesson.json", status: "published", required: true }] } });
  await write("outline.md", "# One introduction\n");
  await write("lesson.json", { schemaVersion: 1, code: "USE-ONE", title: "Use Preview", document: "lesson.md",
    prerequisites: [], estimatedMinutes: 5, visuals: [], exercise: { kind: "bundled", source: "app", reuse: "attempt" },
    checks: [{ id: "orientation-response", file: "checks/orientation/response.mjs", ...(assets ? { assets: ["checks/orientation/message.txt"] } : {}) }],
    assessments: [{ id: "try-the-application", kind: "practical", required: true, rubric: "lesson.md#try-the-application",
      evidence: { producer: "exercise", operation: "try-the-application", check: "orientation-response", explanationRequired: true } }] });
  await write("lesson.md", '# Use Preview\n<a id="try-the-application"></a>\nPress the real button and explain what happened.\n');
  await write("app/server.mjs", 'throw new Error("EXERCISE_SOURCE_MUST_NOT_EXECUTE");');
  await write("checks/orientation/response.mjs", script);
  if (assets) await write("checks/orientation/message.txt", "Hello from the server!");
  const commit = "a".repeat(40), snapshotRoot = path.join(systemRoot, "training/content/check", commit);
  await mkdir(path.dirname(snapshotRoot), { recursive: true });
  await runTrainingCli(["bundle", source, snapshotRoot], { write() {} });
  const bundle = JSON.parse(await readFile(path.join(snapshotRoot, "bundle.json"), "utf8"));
  const topic = { schemaVersion: 1, topicId: "check", release: "0.1.0", repository: "examples/learn-check", commit, topicHash: bundle.topicHash };
  await write("pin.json", topic, snapshotRoot);
  const pin = { course: { courseId: "intro", release: "0.1.0" }, topic, lesson: { code: "USE-ONE", hash: bundle.lessons[0].hash } };
  const learners = createTrainingLearnerState({ systemRoot });
  const content = createInstalledTrainingContent({ systemRoot });
  const actor = { uid: 42, username: "alice" };
  const reserved = await learners.reserveAttempt({ actor, expectedRevision: 0, requestId: "start", pin });
  const attemptId = reserved.attempt.attemptId, sessionId = `training-${attemptId}`;
  await learners.beginPreparation({ actor, attemptId, expectedRevision: 1 });
  await learners.recordPreparationReady({ actor, attemptId, initialSessionId: sessionId, expectedRevision: 2 });
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime"),
    projectSessionSourceRoot: path.join(root, "managed") });
  const paths = store.paths(sessionId);
  const sourcePath = path.join(root, "managed/sessions/active", sessionId, "source");
  await mkdir(paths.sessionRoot, { recursive: true });
  await mkdir(sourcePath, { recursive: true });
  let session = { sessionId, sessionRoot: paths.sessionRoot,
    metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: sourcePath } };
  const input = { actor, attemptId, sessionId, terminalId: randomUUID(), observationId: randomUUID(),
    instanceId: randomUUID(), interactionId: randomUUID(), requestId: randomUUID() };
  let row = { instanceId: input.instanceId, interactionId: input.interactionId, requestId: input.requestId, message: "Hello from the server!" };
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url !== `/training/observation?requestId=${input.requestId}` || !row) {
      response.writeHead(404); response.end("Expired"); return;
    }
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(row));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  let status = { output: { state: "ready", targetId: "app", presentationKind: "web" },
    activeTerminal: { id: input.terminalId, status: "running", running: true, metadata: {
      sessionId, sessionRoot: paths.sessionRoot, sessionSourceRoot: sourcePath, runRoot: sourcePath,
      outputTargetId: "app", port, targetUrl: `http://127.0.0.1:${port}/app`,
      previewPublicOrigin: "https://preview.example.invalid", agentTargetHref: "https://proxy.example.invalid/app" } } };
  const calls = [];
  const project = { async runInProjectContext(slug, operation) { assert.equal(slug, reserved.attempt.projectSlug); return operation(); },
    async createRuntime(options) { assert.deepEqual(options, { inspectSource: false });
      return { store, async getSession(id, readOptions) { assert.equal(id, sessionId); assert.deepEqual(readOptions, { inspectSource: false }); return session; } }; } };
  const terminals = { async outputTargetStatus(id) { assert.equal(id, sessionId); return structuredClone(status); } };
  const owner = runCommand => createTrainingDeclaredCheckOwner({ learners, content, project, terminals,
    runCommand: async command => { calls.push(command); return (runCommand || runVibe64Command)(command); } });
  const learnerFiles = ["progress.json", "active-lesson.json"].map(file => path.join(systemRoot, "training/users/NDI", file));
  const saved = () => Promise.all(learnerFiles.map(async file => ({ bytes: await readFile(file), mtime: (await stat(file)).mtimeMs })));
  return { root, snapshotRoot, paths, input, owner, calls, requests, learners, saved,
    get status() { return status; }, set status(value) { status = value; },
    set session(value) { session = value; }, set row(value) { row = value; } };
}

test("preserved orientation check executes verified bytes outside exercise source through the actual bounded native gateway", async t => {
  const f = await fixture(t);
  const before = await f.saved();
  assert.deepEqual(await f.owner().runOrientationCheck(f.input), { checkResult: {
    check: "orientation-response", observationId: f.input.observationId, outcome: "passed" } });
  assert.deepEqual(await f.saved(), before, "checking does not write progress or reserve/resume an attempt");
  assert.deepEqual(f.requests, [`/training/observation?requestId=${f.input.requestId}`]);
  assert.equal(f.calls.length, 1);
  const command = f.calls[0];
  assert.equal(command.actor, "daemon");
  assert.equal(command.command, "node");
  assert.deepEqual(command.runtimes, ["node26"]);
  assert.equal(command.timeout, 5000); assert.equal(command.maxBuffer, 4096);
  assert.equal(command.mode, "capture"); assert.equal(command.execution.lifecycle, "finite");
  assert.equal(command.execution.ownerId, f.input.observationId);
  assert.equal(command.inheritProcessEnv, false); assert.deepEqual(command.baseEnv, {});
  assert.deepEqual(command.allowedRoots, [command.cwd]);
  assert.equal(command.cwd.startsWith(`${f.paths.artifactsRoot}/training-check-`), true);
  assert.equal(command.args[0], path.join(command.cwd, "checks/orientation/response.mjs"));
  assert.equal(JSON.parse(command.input).origin, new URL(f.status.activeTerminal.metadata.targetUrl).origin);
  assert.deepEqual(await readdir(f.paths.artifactsRoot), [], "scope-empty gateway completion removes only owned scratch");
});

test("explicit auxiliary assets retain original manifest-relative paths for native check imports", async t => {
  const f = await fixture(t, { assets: true, script: Buffer.concat([Buffer.from(
    'import { readFile } from "node:fs/promises";\nif (await readFile(new URL("./message.txt", import.meta.url), "utf8") !== "Hello from the server!") throw new Error("wrong asset");\n'), originalCheck]) });
  assert.equal((await f.owner().runOrientationCheck(f.input)).checkResult.outcome, "passed");
  assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
});

test("expired or mismatched original server observations return incomplete rather than learner pass", async t => {
  const f = await fixture(t);
  for (const row of [null, { instanceId: randomUUID(), interactionId: f.input.interactionId,
    requestId: f.input.requestId, message: "Hello from the server!" }]) {
    f.row = row;
    const result = await f.owner().runOrientationCheck(f.input);
    assert.equal(result.checkResult.outcome, "not-yet-passed");
    assert.equal(typeof result.reason, "string");
  }
  assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
});

test("wrong actor, arbitrary input, stale or non-loopback App run cannot execute a declared check", async t => {
  const f = await fixture(t);
  await assert.rejects(f.owner().runOrientationCheck({ ...f.input, actor: { uid: 43 } }), { code: "VIBE64_TRAINING_CHECK_ATTEMPT_STALE" });
  for (const extra of [{ origin: "http://127.0.0.1:1234" }, { checkId: "other" }, { argv: ["-e", "forged"] }, { outcome: "passed" }]) {
    await assert.rejects(f.owner().runOrientationCheck({ ...f.input, ...extra }));
  }
  const original = structuredClone(f.status);
  for (const change of [value => { value.activeTerminal.id = randomUUID(); },
    value => { value.activeTerminal.status = "closing"; }, value => { value.output.state = "preparing"; },
    value => { value.activeTerminal.metadata.targetUrl = "https://proxy.example.invalid/app"; },
    value => { value.activeTerminal.metadata.port += 1; }, value => { value.activeTerminal.metadata.sessionSourceRoot = "/wrong/source"; }]) {
    f.status = structuredClone(original); change(f.status);
    await assert.rejects(f.owner().runOrientationCheck(f.input));
  }
  assert.equal(f.calls.length, 0);
});

test("a real check response cannot verify a restarted App or an ended attempt", async t => {
  const f = await fixture(t);
  const original = structuredClone(f.status);
  await assert.rejects(f.owner(async command => {
    const result = await runVibe64Command(command);
    f.status.activeTerminal.id = randomUUID(); return result;
  }).runOrientationCheck(f.input), { code: "VIBE64_TRAINING_CHECK_RUN_STALE" });
  f.status = original;
  await assert.rejects(f.owner(async command => {
    const result = await runVibe64Command(command);
    await f.learners.endAttempt({ actor: f.input.actor, attemptId: f.input.attemptId,
      expectedRevision: 3, requestId: "end", reason: "discard" }); return result;
  }).runOrientationCheck(f.input), { code: "VIBE64_TRAINING_CHECK_ATTEMPT_STALE" });
  assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
});

test("corrupt pinned check and artifact aliases fail before process dispatch", async t => {
  const f = await fixture(t);
  const checkPath = path.join(f.snapshotRoot, "files/checks/orientation/response.mjs");
  const original = await readFile(checkPath);
  await writeFile(checkPath, "forged check");
  await assert.rejects(f.owner().runOrientationCheck(f.input));
  await writeFile(checkPath, original);
  const aliased = path.join(f.root, "alias-target"); await mkdir(aliased);
  await symlink(aliased, f.paths.artifactsRoot);
  await assert.rejects(f.owner().runOrientationCheck(f.input), { code: "VIBE64_TRAINING_CHECK_DIRECTORY_UNSAFE" });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(aliased), []);
});

test("original capture enforces timeout, output bounds and strict one-row check result", async t => {
  for (const script of ['setInterval(() => {}, 1000);', 'console.log("x".repeat(10000));',
    'console.log("{}"); console.log("{}");', 'console.log(JSON.stringify({check:"orientation-response",outcome:"verified",forged:true}));']) {
    const f = await fixture(t, { script });
    await assert.rejects(f.owner().runOrientationCheck(f.input));
    assert.deepEqual(await readdir(f.paths.artifactsRoot), []);
  }
});

test("explicit cleanup-uncertain gateway fixture retains scratch and never verifies its success-shaped output", async t => {
  const f = await fixture(t);
  const before = await f.saved();
  const fakeResult = { ok: false, exitCode: 1, code: "vibe64_execution_cleanup_required",
    execution: { id: randomUUID(), state: "active" }, stdout: JSON.stringify({ check: "orientation-response", outcome: "verified" }) };
  await assert.rejects(f.owner(async () => fakeResult).runOrientationCheck(f.input), error => {
    assert.equal(error.code, "VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED");
    assert.equal(error.execution.id, fakeResult.execution.id); return true;
  });
  assert.equal((await readdir(f.paths.artifactsRoot)).length, 1);
  await assert.rejects(f.owner(async () => ({ ...fakeResult, code: "", execution: { id: randomUUID(), lifecycle: "finite" } }))
    .runOrientationCheck(f.input), { code: "VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED" });
  assert.equal((await readdir(f.paths.artifactsRoot)).length, 2, "a finite request descriptor is not terminal execution proof");
  assert.deepEqual(await f.saved(), before);
});
