import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { configurePlannedRestart, createPlannedRestart, plannedRestart } from "@local/vibe64-core/server/plannedRestart";
import {
  CRUCIAL_OPERATIONS,
  PLANNED_RESTART_CANCELLED_NOTE,
  PLANNED_RESTART_REFUSAL_CODE,
  plannedRestartNoticeFrom
} from "@local/vibe64-core/server/plannedRestartNotice";
import { Vibe64PlannedRestartProvider } from "@local/vibe64-core/server/Vibe64PlannedRestartProvider";
import { createCodexGitCommandService } from "@local/vibe64-terminals/server/codexGitCommand";
import { createPlannedRestartSteering } from "../../packages/vibe64-terminals/src/server/plannedRestartSteering.js";

const BOOT = "0b4c5e2a-1d7f-4c39-9a51-6f2b8d0e7c11";
const RESTART_AT = Date.parse("2026-11-26T07:40:00.000Z");
const NOTICE = Object.freeze({
  schema: "vibe64.planned-restart.v1",
  id: "final2-rollout-1",
  restartAt: "2026-11-26T07:40:00.000Z",
  expiresAt: "2026-11-26T07:43:00.000Z",
  reason: "Platform update",
  bootId: BOOT
});

function recordingLogger() {
  const warnings = [];
  const record = level => (fields, message) => {
    if (level === "warn") warnings.push({ fields, message });
  };
  return { warnings, logger: { ...silentLogger, info() {}, warn: record("warn"), error: record("error"), child: () => silentLogger } };
}

async function withNoticeFolder(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-planned-restart-"));
  try {
    return await run({ noticeFile: path.join(root, "notice.json"), recordsRoot: path.join(root, "records") });
  } finally {
    // The process's reader a test configured finishes its record writes before its folder goes.
    await plannedRestart().stop();
    configurePlannedRestart({});
    await rm(root, { force: true, recursive: true });
  }
}

const clock = (startMs) => {
  const state = { ms: startMs };
  return { now: () => state.ms, set: ms => { state.ms = ms; } };
};

/** Waits for what a reader's listeners started, bounded so a hang fails the test. */
async function until(check, label) {
  for (let tries = 0; tries < 400; tries += 1) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

test("a notice is obeyed only while valid: expired, written in another boot, or malformed, it is ignored", () => {
  const nowMs = RESTART_AT - 5 * 60_000;
  const read = (value, options = {}) => plannedRestartNoticeFrom(JSON.stringify(value), { bootId: BOOT, nowMs, ...options });
  assert.equal(read(NOTICE).notice?.id, "final2-rollout-1");
  assert.equal(read(NOTICE).notice?.reason, "Platform update");
  assert.equal(read(NOTICE, { nowMs: Date.parse(NOTICE.expiresAt) }).ignored, "it has expired");
  assert.equal(read(NOTICE, { bootId: "6c1f0d3e-0000-4000-8000-000000000000" }).ignored, "it was written during another boot of this machine");
  assert.equal(read(NOTICE, { bootId: "" }).ignored, "it was written during another boot of this machine");
  assert.match(read({ ...NOTICE, schema: "vibe64.planned-restart.v2" }).ignored, /schema/u);
  assert.match(read({ ...NOTICE, extra: true }).ignored, /exactly these fields/u);
  assert.match(read({ ...NOTICE, expiresAt: "2026-11-26T07:50:00.000Z" }).ignored, /at most 3 minutes/u);
  assert.match(read({ ...NOTICE, restartAt: "soon" }).ignored, /ISO times/u);
  assert.match(read({ ...NOTICE, id: "../x" }).ignored, /short plain name/u);
  assert.equal(plannedRestartNoticeFrom("{", { bootId: BOOT, nowMs }).ignored, "it is not JSON");
});

test("an expired notice, or one from another boot, refuses nothing and is warned about once", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    for (const [label, notice, nowMs] of [
      ["expired", NOTICE, Date.parse(NOTICE.expiresAt) + 1],
      ["another boot", { ...NOTICE, bootId: "6c1f0d3e-0000-4000-8000-000000000000" }, RESTART_AT - 60_000]
    ]) {
      await writeFile(noticeFile, JSON.stringify(notice));
      const { logger, warnings } = recordingLogger();
      const reader = createPlannedRestart({ noticeFile, recordsRoot, logger, now: () => nowMs, bootId: () => BOOT, pollMs: 0 });
      await reader.start();
      await reader.poll();
      await reader.poll();
      assert.equal(reader.current(), null, label);
      assert.equal(reader.refusal({ operation: "save" }), null, label);
      assert.equal(warnings.filter(({ fields }) => fields.event === "vibe64.planned_restart.notice_ignored").length, 1, label);
      await reader.stop();
    }
  });
});

test("while a notice is in force every crucial operation is refused naming the restart time, and allowed again after expiry", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const time = clock(RESTART_AT - 5 * 60_000);
    const reader = createPlannedRestart({ noticeFile, recordsRoot, now: time.now, bootId: () => BOOT, pollMs: 0 });
    const events = [];
    reader.onChange(event => events.push(`${event.type}:${event.cause || ""}`));
    await reader.start();
    for (const [operation, label] of Object.entries(CRUCIAL_OPERATIONS)) {
      const refused = reader.refusal({ operation });
      assert.equal(refused?.code, PLANNED_RESTART_REFUSAL_CODE, operation);
      assert.equal(refused.restartAt, NOTICE.restartAt);
      assert.equal(refused.message, `${label} is paused: this workspace restarts at 07:40 UTC. Try again after the restart.`);
      assert.throws(() => reader.beginCrucial(operation), { code: PLANNED_RESTART_REFUSAL_CODE });
    }
    assert.equal(reader.refusal({ operation: "backup", label: "A backup" }).message.startsWith("A backup is paused"), true);
    assert.match(reader.warning(), /^Vibe64: this workspace restarts at 07:40 UTC \(in 5 minutes\)\..*Before 07:39 UTC, write where you are/u);

    time.set(Date.parse(NOTICE.expiresAt));
    for (const operation of Object.keys(CRUCIAL_OPERATIONS)) assert.equal(reader.refusal({ operation }), null, operation);
    reader.beginCrucial("save").end();
    assert.equal(reader.warning(), "");
    await reader.poll();
    await reader.settled();
    assert.deepEqual(events, ["started:", "ended:expired"]);
    const record = JSON.parse(await readFile(path.join(recordsRoot, `${NOTICE.id}.json`), "utf8"));
    assert.equal(record.state, "expired");
    await reader.stop();
  });
});

test("a host's own operation is refused through the provider's gate in the same words", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const reader = configurePlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 60_000, bootId: () => BOOT, pollMs: 0 });
    await reader.start();
    const { plannedRestart } = Vibe64PlannedRestartProvider.setup({});
    assert.deepEqual(plannedRestart.refusal({ operation: "staging-publish", typicalMs: 120_000 }), {
      code: PLANNED_RESTART_REFUSAL_CODE,
      message: "Publish to staging is paused: this workspace restarts at 07:40 UTC. Try again after the restart.",
      restartAt: NOTICE.restartAt
    });
    assert.equal(plannedRestart.status().active.id, NOTICE.id);
  });
});

test("the AI's git commit, push and rebase are refused in the window; its other Git commands are not", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const time = clock(RESTART_AT - 60_000);
    const reader = configurePlannedRestart({ noticeFile, recordsRoot, now: time.now, bootId: () => BOOT, pollMs: 0 });
    await reader.start();
    const project = { async createSessionStore() { throw Object.assign(new Error("no session store here"), { code: "test_no_store" }); } };
    const git = createCodexGitCommandService({ env: {}, logger: silentLogger, project, runGatewayCommand: () => assert.fail("nothing runs") });
    const run = args => git.run({ command: "git", args, sessionId: "2026-11-26_07-00-00" }).catch(error => ({ ok: false, code: error.code }));
    for (const args of [["commit", "-m", "x"], ["push", "origin", "HEAD"], ["-C", ".", "rebase", "main"]]) {
      const result = await run(args);
      assert.equal(result.code, PLANNED_RESTART_REFUSAL_CODE, args.join(" "));
      assert.match(result.error, /^git (commit|push|rebase) is paused: this workspace restarts at 07:40 UTC\./u);
    }
    assert.notEqual((await run(["status"])).code, PLANNED_RESTART_REFUSAL_CODE);
    time.set(Date.parse(NOTICE.expiresAt));
    assert.notEqual((await run(["commit", "-m", "x"])).code, PLANNED_RESTART_REFUSAL_CODE);
  });
});

/** Chats as the terminals service visits them, recording each steer and note. */
function fakeChats(chats) {
  const steered = [];
  const told = [];
  const reopened = [];
  async function forEachChat(visit) {
    for (const chat of chats) {
      await visit({
        ...chat,
        steer: async message => { steered.push({ key: `${chat.sessionId}/${chat.conversationId}`, message }); return "delivered"; },
        tell: async message => { told.push({ key: `${chat.sessionId}/${chat.conversationId}`, message }); },
        reopen: async () => { reopened.push(`${chat.sessionId}/${chat.conversationId}`); }
      });
    }
  }
  return { forEachChat, reopened, steered, told };
}

const CHATS = [
  { sessionId: "s-working", conversationId: "", sessionName: "Working", running: true },
  { sessionId: "s-idle", conversationId: "", sessionName: "Idle", running: false },
  { sessionId: "s-working", conversationId: "side-1", sessionName: "Working", running: true }
];

test("a running turn is steered with Vibe64's note and an idle chat is not; when the restart doesn't happen the steered chats hear so", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const reader = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 4 * 60_000, bootId: () => BOOT, pollMs: 0 });
    const chats = fakeChats(CHATS);
    createPlannedRestartSteering({ reader, forEachChat: chats.forEachChat, logger: silentLogger });
    await reader.start();
    await until(() => chats.steered.length === 2, "the steers");
    assert.deepEqual(chats.steered.map(({ key }) => key), ["s-working/", "s-working/side-1"]);
    assert.match(chats.steered[0].message, /^Vibe64: this workspace restarts at 07:40 UTC \(in 4 minutes\)/u);

    // The host removes the file before the restart time: the restart was cancelled.
    await rm(noticeFile);
    await reader.poll();
    assert.equal(reader.refusal({ operation: "update" }), null);
    await until(() => chats.reopened.length === 3, "the reopened chats");
    await reader.settled();
    assert.deepEqual(chats.told, [
      { key: "s-working/", message: PLANNED_RESTART_CANCELLED_NOTE },
      { key: "s-working/side-1", message: PLANNED_RESTART_CANCELLED_NOTE }
    ]);
    const record = JSON.parse(await readFile(path.join(recordsRoot, `${NOTICE.id}.json`), "utf8"));
    assert.equal(record.state, "cancelled");
    await reader.stop();
  });
});

test("after the restart, the session that was working resumes with what the restart stopped", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const before = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 30_000, bootId: () => BOOT, pollMs: 0 });
    await before.start();
    before.noteTold({ sessionId: "s-working", sessionName: "Working", steered: true });
    before.trackCommand("s-working", "npm   test -- tests/server/a.test.js");
    before.trackCommand("s-other", "npm run build");
    // The host stops the editor at the restart time, and removes the notice as the machine comes back.
    before.recordStop();
    await before.stop();
    await rm(noticeFile);

    const after = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT + 40_000, bootId: () => BOOT,
      startedAtMs: RESTART_AT + 20_000, pollMs: 0 });
    await after.start();
    assert.equal(after.restartedRecord()?.state, "restarted");
    assert.equal(await after.resumeNote({ sessionId: "s-working" }),
      "Vibe64: Restarted at 07:39 UTC. This was stopped: your turn; the command `npm test -- tests/server/a.test.js`. Continue from your notes.");
    assert.equal(await after.resumeNote({ sessionId: "s-quiet" }),
      "Vibe64: Restarted at 07:39 UTC. This was stopped: your turn. Continue from your notes.");
    assert.equal(after.refusal({ operation: "save" }), null);
    const shown = after.status().restarted;
    assert.equal(shown.id, NOTICE.id);
    assert.equal(shown.sessions, 1);
    assert.deepEqual(shown.stopped, [
      { label: "the command npm test -- tests/server/a.test.js", sessionName: "Working" },
      { label: "the command npm run build", sessionName: "" }
    ]);
    await after.stop();
  });
});

test("an editor that starts again well before the restart time, the notice gone, did not restart for it: the restart didn't happen", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const before = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 4 * 60_000, bootId: () => BOOT, pollMs: 0 });
    await before.start();
    before.noteTold({ sessionId: "s-working", steered: true });
    before.recordStop();
    await before.stop();
    await rm(noticeFile);

    const after = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 3 * 60_000, bootId: () => BOOT,
      startedAtMs: RESTART_AT - 3 * 60_000, pollMs: 0 });
    const ended = [];
    after.onChange(event => ended.push(event));
    await after.start();
    assert.equal(after.restartedRecord(), null);
    assert.equal(await after.resumeNote({ sessionId: "s-working" }), "");
    assert.deepEqual(ended.map(event => [event.type, event.cause, event.record.chats.length]), [["ended", "cancelled", 1]]);
    await after.stop();
  });
});

test("an editor that starts again in the same window, the notice still there, keeps the window and what it was told", async () => {
  await withNoticeFolder(async ({ noticeFile, recordsRoot }) => {
    await writeFile(noticeFile, JSON.stringify(NOTICE));
    const before = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 4 * 60_000, bootId: () => BOOT, pollMs: 0 });
    await before.start();
    before.noteTold({ sessionId: "s-working", steered: true });
    before.recordStop();
    await before.stop();

    const again = createPlannedRestart({ noticeFile, recordsRoot, now: () => RESTART_AT - 3 * 60_000, bootId: () => BOOT,
      startedAtMs: RESTART_AT - 3 * 60_000, pollMs: 0 });
    await again.start();
    assert.equal(again.refusal({ operation: "save" })?.code, PLANNED_RESTART_REFUSAL_CODE);
    assert.equal(again.restartedRecord(), null);
    await rm(noticeFile);
    await again.poll();
    await again.settled();
    const record = JSON.parse(await readFile(path.join(recordsRoot, `${NOTICE.id}.json`), "utf8"));
    assert.deepEqual([record.state, record.chats.map(chat => chat.sessionId)], ["cancelled", ["s-working"]]);
    await again.stop();
  });
});

test("every crucial operation the editor runs keeps its gate where it starts", async () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const read = file => readFile(path.join(root, file), "utf8");
  // A host's own operations: the host gates them through the provider (Vibe64PlannedRestartProvider.js).
  const hostOperations = new Set(["staging-publish", "production-deploy", "project-restore"]);
  const sites = {
    save: ["packages/vibe64-sessions/src/server/sessionWork.js", "packages/vibe64-terminals/src/server/serviceSessionWork.js"],
    update: ["packages/vibe64-sessions/src/server/sessionWork.js", "packages/vibe64-terminals/src/server/serviceSessionWork.js"],
    "workspace-preparation": ["packages/vibe64-terminals/src/server/workspaceSetupStart.js"],
    "output-prepare": ["packages/vibe64-terminals/src/server/outputTargetLaunchStart.js"],
    "project-import": ["packages/vibe64-project/src/server/service.js"],
    "project-archive": ["packages/vibe64-project/src/server/projectArchive.js"],
    "session-create": ["packages/vibe64-sessions/src/server/sessionCreation.js"],
    "session-delete": ["packages/vibe64-sessions/src/server/sessionArchive.js"],
    "env-save": ["packages/vibe64-project/src/server/service.js"],
    "plan-handoff": ["packages/vibe64-terminals/src/server/assistantRoutingDelivery.js"],
    "automatic-review": ["packages/vibe64-terminals/src/server/assistantRoutingDelivery.js"],
    "git-write": ["packages/vibe64-terminals/src/server/codexGitCommand.js"]
  };
  assert.deepEqual(Object.keys(CRUCIAL_OPERATIONS).filter(operation => !hostOperations.has(operation)).sort(), Object.keys(sites).sort());
  for (const [operation, files] of Object.entries(sites)) {
    for (const file of files) assert.match(await read(file), new RegExp(`"${operation}"`, "u"), `${operation} in ${file}`);
  }
});
