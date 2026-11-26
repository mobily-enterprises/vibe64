// An apply prepares each upgrade that names its inputs once: its check's preparation is what its apply publishes while
// nothing it read has changed. Measured against 20261124-chat-transcript-log, the upgrade that reads every chat, live
// and archived, at two sizes: the apply's reads follow the chats it converts, and a start after it, with nothing
// pending, reads the same at either size.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runStateUpgrades } from "@local/vibe64-core/server/stateUpgrades";
import { createStateUpgradePlan, publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { upgradeChatTranscriptLogs } from "@local/vibe64-runtime/server/chatTranscriptLogUpgrade";
import { upgradeAgentRunHistory } from "@local/vibe64-runtime/server/agentRunHistoryUpgrade";

const chatUpgradeId = "20261124-chat-transcript-log";
const movedNote = '{"version":2,"movedTo":"transcript.jsonl"}\n';
const at = (turn, second = 0) => new Date(Date.UTC(2026, 9, 1) + turn * 60_000 + second * 1000).toISOString();

function legacyDocument(turns) {
  const document = { version: 1, metadata: { runtime: { version: 3, engine: "codex", segmentId: "segment-1", lastEngine: "codex",
    configuration: { model: "gpt" }, predecessors: [], seen: {}, binding: { threadId: "thread-1" } } }, rewound: [], turns: [] };
  for (let index = 1; index <= turns; index += 1) {
    document.turns.push([String(index).padStart(6, "0"), {
      messages: [
        { role: "user", text: `Question ${index} ${"plan ".repeat(60)}`, at: at(index), messageId: `user-${index}` },
        { role: "assistant", text: `Answer ${index} ${"commit ".repeat(80)}`, at: at(index, 3), messageId: `reply-${index}` }
      ],
      metadata: { actorDisplayName: "Ada", actorId: "ada", engineId: "codex", runtime: { status: "completed", nativeTurnId: `native-${index}` } }
    }]);
  }
  return document;
}

// The upgrades before the two that read every session are done, as on a workspace that took the release before them: the runner's
// own order, its upgrades list.
async function upgradeIdsBefore(id) {
  const source = await readFile(new URL("../../packages/vibe64-core/src/server/stateUpgrades.js", import.meta.url), "utf8");
  const named = new Map([...source.matchAll(/^import (\w+) from "\.\/stateUpgrades\/(\d{8}-[a-z0-9-]+)\.js";$/gmu)]
    .map((match) => [match[1], match[2]]));
  const ids = /^const upgrades = \[([^\]]*)\];$/mu.exec(source)[1].split(",").map((name) => named.get(name.trim()));
  assert.ok(ids.length === named.size && ids.every(Boolean) && ids.includes(id), id);
  return ids.slice(0, ids.indexOf(id));
}

/**
 * A workspace's state with `active` live sessions and `archived` archived ones in each of two projects, every chat
 * still the previous release's transcript.json, an archive also holding an upload.
 */
async function workspace(t, { active, archived, turns = 40 }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-plan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const stores = [];
  for (const project of ["alpha", "beta"]) {
    const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects", project) });
    stores.push(store);
    for (let index = 0; index < active + archived; index += 1) {
      const sessionId = `2026-10-01_10-00-00_${String(index).padStart(4, "0")}`;
      await store.createSession({ sessionId, runtimeKind: "genesis" });
      const logRoot = store.paths(sessionId).conversationLogRoot;
      await mkdir(logRoot, { recursive: true });
      await writeFile(path.join(logRoot, "transcript.json"), `${JSON.stringify(legacyDocument(turns))}\n`);
      if (index < active) continue;
      const upload = path.join(store.paths(sessionId).artifactsRoot, "attachments", `upload-${index}`);
      await mkdir(upload, { recursive: true });
      await writeFile(path.join(upload, "screenshot.png"), randomBytes(20_000));
      await store.writeStatus(sessionId, "archived");
      await store.publishSessionArchive(sessionId);
    }
  }
  await mkdir(path.join(systemRoot, "upgrades"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(systemRoot, "upgrades/applied.json"), JSON.stringify({ version: 1,
    applied: (await upgradeIdsBefore(chatUpgradeId)).map((id) => ({ id, completedAt: "2026-11-24T00:00:00.000Z" })) }));
  const messages = [];
  return {
    root, systemRoot, stores, messages,
    run: (apply) => runStateUpgrades({ systemRoot, projectsRoot: path.join(root, "sources"), apply, upgradeChatTranscriptLogs,
      upgradeAgentRunHistory, report: (_level, message) => messages.push(message) }),
    // How many times this upgrade read every chat of a project since the last call.
    preparations() {
      const count = messages.filter((message) => message.startsWith(`${chatUpgradeId}: `) && / chat\(s\) to convert /u.test(message)).length;
      messages.length = 0;
      return count;
    }
  };
}

// The bytes this process has read from files (Linux's rchar), whatever page cache served them.
async function bytesRead() {
  const io = await readFile("/proc/self/io", "utf8");
  return Number(/^rchar: (\d+)$/mu.exec(io)[1]);
}

// os.tmpdir() for the length of a test: where the upgrade stages what it prepares, which must be empty after it.
async function ownTemporaryFolder(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-plan-tmp-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = folder;
  t.after(async () => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    await rm(folder, { recursive: true, force: true });
  });
  return folder;
}

// What the upgrade staged in a temporary folder and left there.
async function staged(folder) {
  return (await readdir(folder)).filter((name) => name.startsWith("vibe64-state-upgrade-"));
}

test("an apply reads every chat once, at either size, and a start after it reads the same at both", async t => {
  const measured = [];
  const temporary = await ownTemporaryFolder(t);
  for (const size of [{ active: 2, archived: 2 }, { active: 8, archived: 8 }]) {
    const f = await workspace(t, size);
    let started = await bytesRead();
    // A host's check before its apply (a standalone check) reads every chat once, and repacks no archive.
    assert.deepEqual((await f.run(false)).pending, [chatUpgradeId, "20261125-agent-run-history"]);
    assert.equal(f.preparations(), 2, "one read of each project's chats");
    const check = await bytesRead() - started;
    started = await bytesRead();
    // The apply reads them once more, in its check, and publishes what that check prepared: before, its apply read them
    // all a third time.
    assert.deepEqual((await f.run(true)).applied, [chatUpgradeId, "20261125-agent-run-history"]);
    assert.equal(f.preparations(), 2, "the apply reads each project's chats once");
    const apply = await bytesRead() - started;
    for (const store of f.stores) {
      for (const sessionId of ["2026-10-01_10-00-00_0000", `2026-10-01_10-00-00_${String(size.active).padStart(4, "0")}`]) {
        assert.equal((await store.readConversationLog(sessionId)).length, 40, sessionId);
      }
      assert.equal(await readFile(path.join(store.paths("2026-10-01_10-00-00_0000").conversationLogRoot, "transcript.json"), "utf8"), movedNote);
    }
    assert.deepEqual(await staged(temporary), [], "nothing the check kept for the apply outlives it");
    // A start after it: the ledger says both are done, and nothing is read again.
    started = await bytesRead();
    assert.deepEqual((await f.run(false)).pending, []);
    assert.deepEqual(await f.run(true), { pending: [], applied: [] });
    assert.equal(f.preparations(), 0);
    measured.push({ ...size, check, apply, later: await bytesRead() - started });
  }
  t.diagnostic(JSON.stringify(measured));
  const [small, large] = measured;
  // Four times the chats to convert: the check's reads grow with them. The start after the apply follows what changed
  // since (nothing), not what is stored: it reads the ledger, the same few bytes at either size.
  assert.ok(large.check > 3 * small.check, JSON.stringify(measured));
  assert.ok(Math.abs(large.later - small.later) < 64 * 1024, JSON.stringify(measured));
  assert.ok(large.later < large.check / 20, JSON.stringify(measured));
});

test("an apply prepares again what changed since its check, and never publishes a check that accepted what an apply refuses", async t => {
  const temporary = await ownTemporaryFolder(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-plan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const input = path.join(systemRoot, "records");
  await mkdir(input, { recursive: true });
  await writeFile(path.join(input, "one.txt"), "old one\n");
  const messages = [];
  let preparations = 0;
  let reusable = true;
  const stages = [];
  const backupRoot = path.join(systemRoot, "upgrades/backups/example");
  const publish = (apply, plan) => publishStateUpgradeFiles({ systemRoot, apply, backupRoot, plan, inputs: async () => [input],
    report: (_level, message) => messages.push(message),
    async prepareUpdates(_temporaryRoot, { stage }) {
      preparations += 1;
      stages.push(stage);
      const updates = [];
      for (const name of (await readdir(input)).sort()) {
        const filePath = path.join(input, name);
        const original = await readFile(filePath, "utf8");
        if (original.startsWith("old ")) updates.push({ filePath, original, contents: original.replace("old ", "new ") });
      }
      return { updates, reusable };
    } });

  // Unchanged since the check: the apply publishes the check's preparation.
  let plan = createStateUpgradePlan();
  await publish(false, plan);
  await publish(true, plan);
  assert.equal(preparations, 1);
  assert.deepEqual(stages, [true], "a check whose preparation the apply publishes stages it");
  assert.equal(await readFile(path.join(input, "one.txt"), "utf8"), "new one\n");
  assert.ok(messages.some((message) => /^Publishing the 1 state file\(s\) the check prepared/u.test(message)), messages.join("\n"));

  // A record that appeared after the check (an earlier upgrade of the same apply wrote it) is prepared again, and
  // published with the rest.
  await rm(backupRoot, { recursive: true });
  await writeFile(path.join(input, "one.txt"), "old one\n");
  preparations = 0;
  plan = createStateUpgradePlan();
  await publish(false, plan);
  await writeFile(path.join(input, "two.txt"), "old two\n");
  await publish(true, plan);
  assert.equal(preparations, 2);
  assert.deepEqual([await readFile(path.join(input, "one.txt"), "utf8"), await readFile(path.join(input, "two.txt"), "utf8")],
    ["new one\n", "new two\n"]);
  assert.ok(messages.some((message) => /^What the check read has changed since/u.test(message)), messages.join("\n"));

  // A check whose preparation is not the apply's: the apply prepares as an apply.
  await rm(backupRoot, { recursive: true });
  await writeFile(path.join(input, "one.txt"), "old one\n");
  preparations = 0;
  reusable = false;
  plan = createStateUpgradePlan();
  await publish(false, plan);
  await publish(true, plan);
  assert.equal(preparations, 2);
  await plan.discard();

  // Without a plan, or without inputs, every run prepares, as a standalone check does, and nothing it prepares is
  // published, so it need not stage it.
  await rm(backupRoot, { recursive: true });
  reusable = true;
  preparations = 0;
  stages.length = 0;
  await publish(false, null);
  await publishStateUpgradeFiles({ systemRoot, apply: false, backupRoot, plan: createStateUpgradePlan(), report() {},
    async prepareUpdates(_temporaryRoot, { stage }) { preparations += 1; stages.push(stage); return []; } });
  assert.equal(preparations, 2);
  assert.deepEqual(stages, [false, false]);
  assert.deepEqual(await staged(temporary), []);
  // An update left unstaged is counted by a check and refused by anything that publishes.
  const unstaged = async () => [{ filePath: path.join(input, "one.txt"), unstaged: true }];
  const before = await readFile(path.join(input, "one.txt"), "utf8");
  messages.length = 0;
  await publishStateUpgradeFiles({ systemRoot, apply: false, backupRoot, report: (_level, message) => messages.push(message),
    prepareUpdates: unstaged });
  assert.deepEqual(messages, ["1 state file(s) to change."]);
  for (const plan of [null, createStateUpgradePlan()]) {
    await assert.rejects(publishStateUpgradeFiles({ systemRoot, apply: !plan, backupRoot, plan, inputs: async () => [input], report() {},
      prepareUpdates: unstaged }), /left a file unstaged for a preparation that is published/u);
  }
  assert.equal(await readFile(path.join(input, "one.txt"), "utf8"), before, "nothing published");
  await assert.rejects(publishStateUpgradeFiles({ systemRoot, apply: false, backupRoot, plan: createStateUpgradePlan(), report() {},
    inputs: async () => [path.join(systemRoot, "upgrades")], async prepareUpdates() { return []; } }), /inputs must be folders of its own state/u);
});

test("a chat still in the per-turn layout is refused by the apply even after a check that counted it", async t => {
  await ownTemporaryFolder(t);
  const f = await workspace(t, { active: 1, archived: 0 });
  const [store] = f.stores;
  await store.createSession({ sessionId: "2026-10-01_11-00-00_0000", runtimeKind: "genesis" });
  const perTurn = path.join(store.paths("2026-10-01_11-00-00_0000").conversationLogRoot, "000001");
  await mkdir(perTurn, { recursive: true });
  await writeFile(path.join(perTurn, "metadata.json"), "{}\n");
  const original = await readFile(path.join(store.paths("2026-10-01_10-00-00_0000").conversationLogRoot, "transcript.json"), "utf8");
  await assert.rejects(f.run(true), /A chat is still in the per-turn layout/u);
  assert.ok(f.messages.some((message) => /1 more in the per-turn layout/u.test(message)), f.messages.join("\n"));
  assert.equal(await readFile(path.join(store.paths("2026-10-01_10-00-00_0000").conversationLogRoot, "transcript.json"), "utf8"), original,
    "nothing changed");
});

test("a standalone check reads and refuses every archived chat as an apply does, without repacking an archive", async t => {
  await ownTemporaryFolder(t);
  const f = await workspace(t, { active: 1, archived: 1, turns: 3 });
  const [store] = f.stores;
  const archive = path.join(store.paths().archivedSessionsRoot, "2026-10-01_10-00-00_0001.tar.gz");
  const prepare = async (stage) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-upgrade-plan-stage-"));
    t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
    const prepared = await store.prepareChatTranscriptLogUpgrade({ temporaryRoot, apply: false, stage, publishedEarlier: async () => false });
    return { ...prepared, built: (await readdir(temporaryRoot)).filter((name) => name.endsWith(".tar.gz")) };
  };
  const unstaged = await prepare(false);
  assert.equal(unstaged.chats, 2, "the archived chat is read and converted");
  assert.deepEqual(unstaged.updates.filter((update) => update.filePath === archive), [{ filePath: archive, unstaged: true }]);
  assert.deepEqual(unstaged.built, [], "no archive is repacked");
  const staged = await prepare(true);
  assert.equal(staged.chats, 2);
  assert.equal(staged.built.length, 1, "an apply's preparation repacks the archive it publishes");
  assert.ok(staged.updates.some((update) => update.filePath === archive && update.replacementPath), JSON.stringify(staged.updates));

  // An archived chat the upgrade cannot convert stops the start's check, as it stops the apply, with nothing changed.
  const sessionId = "2026-10-01_12-00-00_0000";
  await store.createSession({ sessionId, runtimeKind: "genesis" });
  await mkdir(store.paths(sessionId).conversationLogRoot, { recursive: true });
  await writeFile(path.join(store.paths(sessionId).conversationLogRoot, "transcript.json"),
    `${JSON.stringify({ ...legacyDocument(2), unexpected: true })}\n`);
  await store.writeStatus(sessionId, "archived");
  await store.publishSessionArchive(sessionId);
  const archiveBefore = await readFile(archive);
  for (const apply of [false, true]) {
    await assert.rejects(f.run(apply), /cannot be converted: fields this upgrade does not know \(unexpected\)/u);
  }
  assert.deepEqual(await readFile(archive), archiveBefore, "nothing changed");
});
