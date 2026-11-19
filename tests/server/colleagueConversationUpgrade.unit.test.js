import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { upgradeColleagueConversations, upgradeColleagueConversationHistory, retireColleagueLearningWatches, retireColleagueFreeModel,
  renameColleagueWatchSource } from "../../packages/vibe64-colleague/src/server/conversationUpgrade.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "colleague-upgrade-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const backupRoot = path.join(root, "backup");
  const reports = [];
  return { root, systemRoot, backupRoot, reports,
    async write(key, value) {
      const file = path.join(systemRoot, "colleague", key, "conversation.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
      return file;
    },
    run: apply => upgradeColleagueConversations({ systemRoot, backupRoot, apply, report: (level, message) => reports.push({ level, message }) })
  };
}

const original = {
  schemaVersion: 1, scopeId: "colleague_test", assistantSelection: { engineId: "codex", modelId: "test" },
  status: "working", error: "", conversationId: "native-thread", runId: "native-turn", currentTurnId: "turn-1",
  conversationLog: [{ turnId: "turn-1", metadata: { application: "retained" }, messages: [
    { messageId: "request-1", role: "user", text: "Keep this history." },
    { messageId: "reply-1", role: "assistant", text: "Retained reply." }
  ] }],
  operation: { id: "operation-1", status: "executing", toolName: "example", arguments: '{"input":"retained"}' },
  watches: [{ watchId: "watch-1", status: "pending" }], observations: [{ id: "observation-1" }],
  assignments: [{ assignmentId: "assignment-1", status: "waiting", turns: [] }], extra: { retained: true }
};

test("preflight is read-only for new and existing Colleague installations", async t => {
  const f = await fixture(t);
  await f.run(false);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" });
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  await f.run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  assert.ok(f.reports.some(report => report.level === "warning" && /Stop all services/.test(report.message)));
});

test("upgrade backs up exact history, retires native identity and preserves uncertain effects and product data", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const nativeHistory = path.join(path.dirname(file), "native-history.jsonl");
  await writeFile(nativeHistory, "native history must be untouched\n");
  await f.run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.schemaVersion, 2);
  assert.deepEqual(next.conversationLog, original.conversationLog);
  for (const name of ["watches", "observations", "assignments", "assistantSelection", "extra"]) assert.deepEqual(next[name], original[name]);
  assert.equal(next.status, "interrupted");
  assert.match(next.error, /nothing was repeated/);
  assert.equal(next.conversationId, undefined);
  assert.equal(next.operation, undefined);
  assert.deepEqual(next.retiredConversation, { conversationId: "native-thread", runId: "native-turn", currentTurnId: "turn-1",
    assistantSelection: original.assistantSelection, operation: { ...original.operation, status: "unknown" } });
  assert.equal(next.conversationMetadata, undefined, "The upgrade does not invent or open a JSKIT native binding");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  assert.equal(await readFile(backup, "utf8"), before);
  assert.equal((await stat(backup)).mode & 0o777, 0o600);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readFile(nativeHistory, "utf8"), "native history must be untouched\n");
  const written = await readFile(file, "utf8");
  await f.run(true);
  assert.equal(await readFile(file, "utf8"), written, "A retry after publication does not rewrite current state");
  assert.equal(await readFile(backup, "utf8"), before);
});

test("an interrupted backup can be reused but conflicting backup contents cannot be overwritten", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", { ...original, status: "ready", operation: null });
  const before = await readFile(file, "utf8");
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "conflicting original");
  await assert.rejects(f.run(true), /differs from its upgrade backup/);
  assert.equal(await readFile(file, "utf8"), before);
  await writeFile(backup, before);
  await f.run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.status, "ready");
  assert.equal(next.retiredConversation.operation, undefined);
});

test("all histories are validated before any backup or publication", async t => {
  const f = await fixture(t);
  const file = await f.write("first", original);
  const before = await readFile(file, "utf8");
  const invalid = await f.write("second", "invalid JSON");
  await assert.rejects(f.run(true), /invalid JSON/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await writeFile(invalid, JSON.stringify({ ...original, conversationMetadata: { runtime: {} } }));
  await assert.rejects(f.run(true), /conflicting runtime state/);
  await writeFile(invalid, JSON.stringify({ ...original, schemaVersion: 99 }));
  await assert.rejects(f.run(true), /unsupported shape/);
  assert.equal(await readFile(file, "utf8"), before);
});

test("symlinked histories are refused without modifying their target", async t => {
  const f = await fixture(t);
  const target = path.join(f.root, "outside.json");
  await writeFile(target, JSON.stringify(original));
  const file = await f.write("owner", original);
  await rm(file);
  await symlink(target, file);
  await assert.rejects(f.run(true), /regular file/);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), original);
});


test("fresh-conversation upgrade preserves exact current identity with read-only preflight, backup and retry", async t => {
  const f = await fixture(t);
  const current = { ...original, schemaVersion: 2, status: "ready", retiredConversation: { operation: { status: "unknown", id: "retained-operation" } } };
  const file = await f.write("owner", current);
  const before = await readFile(file, "utf8");
  const run = apply => upgradeColleagueConversationHistory({ ...f, apply, report: (level, message) => f.reports.push({ level, message }) });
  await run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await run(true);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(next, { ...current, schemaVersion: 3, runtimeId: "owner", previousConversations: [] });
  assert.equal(await readFile(path.join(f.backupRoot, "owner", "conversation.json"), "utf8"), before);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const bytes = await readFile(file, "utf8");
  await run(true);
  assert.equal(await readFile(file, "utf8"), bytes);
  await f.run(true);
  assert.equal(await readFile(file, "utf8"), bytes, "Earlier published delegate recognizes validated format 3 without rewriting it");
});

test("fresh-conversation preflight accepts pending earlier conversion and refuses conflicting identities before backup", async t => {
  const f = await fixture(t);
  const file = await f.write("owner", original);
  const before = await readFile(file, "utf8");
  const run = apply => upgradeColleagueConversationHistory({ ...f, apply, report: () => {} });
  await run(false);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(run(true), /earlier Colleague conversation upgrade/);
  await writeFile(file, JSON.stringify({ ...original, schemaVersion: 2, runtimeId: "unexpected" }));
  await assert.rejects(run(true), /conflicting fresh-chat/);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  const valid = { ...original, schemaVersion: 2 };
  await writeFile(file, JSON.stringify(valid));
  const invalid = await f.write("other", { ...valid, schemaVersion: 3, runtimeId: "owner", previousConversations: [] });
  await assert.rejects(run(true), /unsupported shape/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
  await assert.rejects(stat(f.backupRoot), { code: "ENOENT" });
  await rm(invalid);
  const backup = path.join(f.backupRoot, "owner", "conversation.json");
  await mkdir(path.dirname(backup), { recursive: true });
  await writeFile(backup, "different original");
  await assert.rejects(run(true), /differs from its fresh-conversation upgrade backup/);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), valid);
  await writeFile(backup, JSON.stringify(valid));
  await run(true);
  assert.equal(JSON.parse(await readFile(file, "utf8")).runtimeId, "owner");
});

test("learning-task watch retirement keeps history and other watches with read-only check, backup and retry", async t => {
  const f = await fixture(t);
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261022-learning-space-reset/colleague");
  const run = apply => retireColleagueLearningWatches({ systemRoot: f.systemRoot, backupRoot, apply,
    report: (level, message) => f.reports.push({ level, message }) });
  await run(true);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" }, "a new installation has nothing to retire");
  const record = { schemaVersion: 3, scopeId: "colleague_42", runtimeId: "42", previousConversations: [],
    conversationLog: [{ turnId: "turn-1", messages: [{ role: "user", text: "Keep this history." }] }],
    watches: [{ watchId: "learning-1", source: "learning-task", status: "active", learningTask: { attemptId: "attempt-1" } },
      { watchId: "workspace-1", source: "workspace-repair", status: "paused" }],
    observations: [{ id: "observation-1", watchId: "learning-1" }, { id: "observation-2", watchId: "workspace-1" }] };
  const file = await f.write("42", record);
  const untouched = await f.write("43", { ...record, scopeId: "colleague_43", runtimeId: "43", watches: [record.watches[1]],
    observations: [record.observations[1]] });
  const before = await readFile(file, "utf8");
  const other = await readFile(untouched, "utf8");
  await run(false);
  assert.equal(await readFile(file, "utf8"), before, "check writes nothing");
  await assert.rejects(stat(backupRoot), { code: "ENOENT" });
  await run(true);
  const upgraded = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(upgraded.watches, [record.watches[1]]);
  assert.deepEqual(upgraded.observations, [record.observations[1]]);
  assert.deepEqual(upgraded.conversationLog, record.conversationLog);
  assert.equal(await readFile(untouched, "utf8"), other);
  assert.equal(await readFile(path.join(backupRoot, "before/colleague/42/conversation.json"), "utf8"), before);
  const manifest = await readFile(path.join(backupRoot, "manifest.json"), "utf8");
  await run(true);
  assert.equal(await readFile(path.join(backupRoot, "manifest.json"), "utf8"), manifest, "retry resumes the same backup");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), upgraded);
  await f.write("44", "{not json");
  await assert.rejects(retireColleagueLearningWatches({ systemRoot: f.systemRoot, apply: false, report() {},
    backupRoot: path.join(f.systemRoot, "upgrades/backups/other") }), /Colleague conversation state is invalid/u);
});

test("a chat on the retired free model is kept as a previous conversation and the new chat has no model", async t => {
  const f = await fixture(t);
  const backupRoot = path.join(f.systemRoot, "upgrades/backups/20261022-free-model-retirement/colleague");
  const run = apply => retireColleagueFreeModel({ systemRoot: f.systemRoot, backupRoot, apply,
    report: (level, message) => f.reports.push({ level, message }) });
  await run(true);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" }, "a new installation has nothing to retire");
  const pickle = { schema: "vibe64.assistant-selection.v1", engineId: "opencode", agentId: "build", modelProviderId: "opencode",
    modelId: "big-pickle", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
  const record = { schemaVersion: 3, scopeId: "colleague_42", runtimeId: "42", previousConversations: [], assistantSelection: pickle,
    status: "working", error: "", conversationMetadata: { runtime: { engine: "opencode" } },
    conversationLog: [{ turnId: "turn-1", messages: [{ role: "user", text: "Keep this history." }] }],
    watches: [{ watchId: "workspace-1", source: "workspace-repair", status: "paused" }] };
  const file = await f.write("42", record);
  const codex = await f.write("43", { ...record, scopeId: "colleague_43", runtimeId: "43",
    assistantSelection: { ...pickle, engineId: "codex", modelProviderId: "openai", modelId: "gpt-6-sol" } });
  const before = await readFile(file, "utf8");
  const other = await readFile(codex, "utf8");
  await run(false);
  assert.equal(await readFile(file, "utf8"), before, "check writes nothing");
  await run(true);
  const upgraded = JSON.parse(await readFile(file, "utf8"));
  assert.equal(upgraded.assistantSelection, null);
  assert.deepEqual([upgraded.status, upgraded.conversationLog, upgraded.conversationMetadata], ["ready", [], {}]);
  assert.equal(upgraded.runtimeId, `42:${upgraded.scopeId}`);
  assert.deepEqual(upgraded.watches, record.watches);
  const [old] = upgraded.previousConversations;
  assert.deepEqual([old.scopeId, old.runtimeId, old.status, old.conversationLog, old.assistantSelection],
    ["colleague_42", "42", "interrupted", record.conversationLog, pickle]);
  assert.equal(old.freshOperation.conversationId, upgraded.scopeId);
  assert.equal(await readFile(codex, "utf8"), other, "another model's chat is unchanged");
  assert.equal(await readFile(path.join(backupRoot, "before/colleague/42/conversation.json"), "utf8"), before);
  await run(true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), upgraded, "retry changes nothing more");
});

// A watch source renamed by its owner: the Develop record and Learn threads of each person, read with their owner keys.
const ATTEMPT = "0b6c2a8e-4f1d-4c3a-9e7b-1a2b3c4d5e6f";
function sourceRename(f, { from = "deployment", to = "staging", conditions = { live: "running" }, backup = "20261119-rename" } = {}) {
  const backupRoot = path.join(f.systemRoot, `upgrades/backups/${backup}/colleague`);
  return { backupRoot, run: apply => renameColleagueWatchSource({ systemRoot: f.systemRoot, backupRoot, apply, from, to, conditions,
    report: (level, message) => f.reports.push({ level, message }) }) };
}
function chat(runtimeId, scopeId, watches = [], observations = []) {
  return { schemaVersion: 3, scopeId, runtimeId, previousConversations: [],
    conversationLog: [{ turnId: "turn-1", messages: [{ role: "user", text: "Keep this history." }] }], watches, observations };
}
async function writeLearn(f, person, name, value) {
  const file = path.join(f.systemRoot, "colleague", person, "learn", `${name}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}
const shopWatch = { watchId: "shop-live", source: "deployment", input: { projectSlug: "shop" }, projectSlug: "shop",
  condition: "live", question: "Tell me when it is live.", once: true, status: "pending", error: "",
  cursor: { fingerprint: "release-1", conditionsMet: ["live"] } };

test("a renamed watch source moves every matching watch, its renamed conditions and its observations, in Develop records and Learn threads", async t => {
  const f = await fixture(t);
  const { backupRoot, run } = sourceRename(f);
  // Another source's watch keeps its "live", and a condition the map leaves out is kept.
  const publication = { ...shopWatch, watchId: "shop-published", source: "publication" };
  const changed = { ...shopWatch, watchId: "shop-changed", condition: "changed", cursor: { fingerprint: "release-1", conditionsMet: [] } };
  const record = chat("42", "colleague_42", [shopWatch, changed, publication],
    [{ id: "observation-1", watchId: "shop-live", source: "deployment", reason: "live" },
      { id: "observation-2", watchId: "shop-published", source: "publication", reason: "live" }]);
  const develop = await f.write("42", record);
  const lobby = await writeLearn(f, "42", "lobby", chat("42:learn", "colleague_lobby",
    [{ ...shopWatch, watchId: "practice-live", input: { projectSlug: "practice" }, projectSlug: "practice" }]));
  const attempt = await writeLearn(f, "42", ATTEMPT, chat(`42:learn:${ATTEMPT}`, "colleague_attempt", [publication]));
  await mkdir(path.join(f.systemRoot, "colleague/42/learn", ATTEMPT), { recursive: true });
  const before = await readFile(develop, "utf8");
  const untouched = await readFile(attempt, "utf8");
  assert.deepEqual(await run(false), { watches: 3 }, "a check counts what an apply renames");
  assert.equal(await readFile(develop, "utf8"), before, "check writes nothing");
  await assert.rejects(stat(backupRoot), { code: "ENOENT" });
  assert.deepEqual(f.reports.map(({ message }) => message), [
    "Project practice: 1 watch(es) on deployment now watch staging, 1 with a renamed condition.",
    "Project shop: 2 watch(es) on deployment now watch staging, 1 with a renamed condition.", "2 state file(s) to change."]);
  assert.deepEqual(await run(true), { watches: 3 });
  const upgraded = JSON.parse(await readFile(develop, "utf8"));
  assert.deepEqual(upgraded.watches, [
    { ...shopWatch, source: "staging", condition: "running", cursor: { fingerprint: "release-1", conditionsMet: ["running"] } },
    { ...changed, source: "staging" }, publication]);
  assert.deepEqual(upgraded.observations, [{ ...record.observations[0], source: "staging", reason: "running" }, record.observations[1]]);
  assert.deepEqual({ ...upgraded, watches: record.watches, observations: record.observations }, record, "the rest is kept");
  assert.deepEqual(JSON.parse(await readFile(lobby, "utf8")).watches.map(watch => [watch.source, watch.condition]), [["staging", "running"]]);
  assert.equal(await readFile(attempt, "utf8"), untouched, "a thread with no such watch is unchanged");
  assert.equal(await readFile(path.join(backupRoot, "before/colleague/42/conversation.json"), "utf8"), before);
});

test("renaming a watch source no record uses changes nothing and leaves no backup", async t => {
  const f = await fixture(t);
  const { backupRoot, run } = sourceRename(f);
  await run(true);
  await assert.rejects(stat(f.systemRoot), { code: "ENOENT" }, "a new installation has nothing to rename");
  f.reports.length = 0;
  const file = await f.write("42", chat("42", "colleague_42", [{ ...shopWatch, source: "publication" }]));
  const before = await readFile(file, "utf8");
  assert.deepEqual(await run(true), { watches: 0 });
  assert.equal(await readFile(file, "utf8"), before);
  assert.deepEqual(f.reports.map(({ message }) => message), ["0 state file(s) to change."]);
  await assert.rejects(stat(backupRoot), { code: "ENOENT" });
});

test("a Colleague record of the wrong shape refuses the rename, naming its file, before any record changes", async t => {
  for (const [name, value, refusal] of [
    ["invalid JSON", "{not json", /colleague\/43\/conversation\.json: Colleague conversation state is invalid/u],
    ["an unknown schema", { ...chat("43", "colleague_43"), schemaVersion: 9 }, /colleague\/43\/conversation\.json: Colleague history has an unsupported shape/u],
    ["another owner's record", chat("44", "colleague_43"), /colleague\/43\/conversation\.json: Colleague history has an unsupported shape/u],
    ["watches that are no list", { ...chat("43", "colleague_43"), watches: { shopWatch } }, /colleague\/43\/conversation\.json: Colleague history has an unsupported shape/u]
  ]) {
    await t.test(name, async st => {
      const f = await fixture(st);
      const { backupRoot, run } = sourceRename(f);
      const good = await f.write("42", chat("42", "colleague_42", [shopWatch]));
      const before = await readFile(good, "utf8");
      await f.write("43", value);
      await assert.rejects(run(true), refusal);
      assert.equal(await readFile(good, "utf8"), before);
      await assert.rejects(stat(backupRoot), { code: "ENOENT" });
    });
  }
  const f = await fixture(t);
  await writeLearn(f, "42", "lobby", chat("42", "colleague_lobby"));
  await assert.rejects(sourceRename(f).run(false), /colleague\/42\/learn\/lobby\.json: Colleague history has an unsupported shape/u,
    "a Learn thread is checked against its own owner key");
  // Each source name follows the watch source rule, and the two differ.
  for (const [from, to] of [["", "staging"], ["deployment", ""], ["Deployment", "staging"], ["deployment", "staging area"],
    ["deployment", "deployment"], [null, "staging"]]) {
    await assert.rejects(sourceRename(f, { from, to }).run(false), /takes two different source names/u, `${from} -> ${to}`);
  }
  // The condition renames are a plain map of condition names, each new name once.
  for (const conditions of [null, "live", ["live", "running"], new Map([["live", "running"]]), { live: "" }, { "": "running" },
    { live: "Running now" }, { live: 1 }, { live: "running", up: "running" }]) {
    await assert.rejects(sourceRename(f, { conditions }).run(false), /takes its condition renames as old name -> new name, each new name once/u,
      JSON.stringify(conditions) ?? String(conditions));
  }
});

test("a second rename of the same watch source changes nothing", async t => {
  const f = await fixture(t);
  const first = sourceRename(f);
  const file = await f.write("42", chat("42", "colleague_42", [shopWatch]));
  await first.run(true);
  const upgraded = await readFile(file, "utf8");
  const manifest = await readFile(path.join(first.backupRoot, "manifest.json"), "utf8");
  assert.deepEqual(await first.run(true), { watches: 0 }, "a retry finds none left to rename");
  assert.equal(await readFile(path.join(first.backupRoot, "manifest.json"), "utf8"), manifest, "a retry resumes the same backup");
  f.reports.length = 0;
  const second = sourceRename(f, { backup: "later" });
  assert.deepEqual(await second.run(true), { watches: 0 });
  assert.equal(await readFile(file, "utf8"), upgraded);
  assert.deepEqual(f.reports.map(({ message }) => message), ["0 state file(s) to change."]);
  await assert.rejects(stat(second.backupRoot), { code: "ENOENT" });
});
