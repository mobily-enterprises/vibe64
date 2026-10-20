import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createTrainingLearnerState, learnerIdentity } from "../../packages/vibe64-training/src/server/learnerState.js";
import { createTrainingLearnerNotesActions } from "../../packages/vibe64-training/src/server/learnerNotesActions.js";
import { createTrainingLearnerChangedPublisher } from "../../packages/vibe64-training/src/server/learnerEvents.js";
import { VIBE64_TRAINING_LEARNER_CHANGED_EVENT } from "../../packages/vibe64-training/src/shared/learnerEvents.js";

// Learning v2 learner notes (contract C7) over the real learner store. Notes
// never read lesson content, so the installed content reader refuses any use.
const ALICE = { uid: 42, username: "alice", role: "member" };
const BOB = { uid: 43, username: "bob", role: "member" };
const OWNER = { uid: 1, username: "owner", role: "owner" };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-learner-notes-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  await mkdir(systemRoot, { mode: 0o700 });
  const content = { readLesson() { throw new Error("Learner notes must not read lesson content."); } };
  const learners = createTrainingLearnerState({ systemRoot, content });
  const published = [];
  const publishLearnerChanged = createTrainingLearnerChangedPublisher({ async publish(event) { published.push(event); } });
  const auth = { user: ALICE };
  const actions = createActionCatalogue();
  const definitions = createTrainingLearnerNotesActions({ learners, publishLearnerChanged });
  actions.register({ contributorId: "training", domain: "training", actions: definitions.map(definition => ({
    channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => auth.user,
    authorizeProject() { throw new Error("Learner notes must not require a selected project."); } });
  const tools = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const toolContext = { channel: "automation", surface: "app" };
  const toolSet = tools.resolveToolSet(toolContext);
  const execute = (name, input = {}, channel = "api") => actions.execute({ actionId: `vibe64.training.${name}`, input,
    context: { channel, surface: "app" } });
  const tool = async (name, input = {}) => {
    const definition = toolSet.tools.find(item => item.actionId === `vibe64.training.${name}`);
    assert.ok(definition, name);
    assert.doesNotThrow(() => tools.toOpenAiToolSchema(definition));
    const result = await tools.executeToolCall({ toolName: definition.name, toolSet, context: toolContext, argumentsText: JSON.stringify(input) });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.result;
  };
  const userRoot = actor => path.join(systemRoot, "training/users", learnerIdentity(actor).key);
  return { systemRoot, learners, definitions, toolSet, execute, tool, published, auth, userRoot };
}

const EMPTY = { text: "", revision: 0, updatedAt: null, updatedBy: null };
const notices = f => f.published.map(event => [event.realtime.event, event.realtime.audience, event.realtime.payload]);

test("Colleague reads and rewrites the notes; clearing is the learner's browser action only", async t => {
  const f = await fixture(t);
  assert.deepEqual(f.toolSet.tools.map(value => value.actionId).sort(),
    ["vibe64.training.learner-notes.read", "vibe64.training.learner-notes.update"]);
  for (const name of ["learner-notes.read", "learner-notes.update"]) {
    const definition = f.definitions.find(value => value.id === `vibe64.training.${name}`);
    assert.equal(definition.channels, undefined, `${name} uses the provider's default channels`);
    assert.equal(definition.extensions.assistant.alwaysAvailable, true);
    assert.equal(typeof definition.extensions.assistant.output.schema.getFieldDefinitions, "function");
    assert.match(definition.extensions.assistant.description, /never (decide|affect)/u);
  }
  const clear = f.definitions.find(value => value.id === "vibe64.training.learner-notes.clear");
  assert.deepEqual(clear.channels, ["api"]);
  assert.equal(clear.extensions.assistant.exclude, true);
  await assert.rejects(f.execute("learner-notes.clear", { requestId: "c1" }, "automation"), { code: "ACTION_CHANNEL_FORBIDDEN" });

  assert.deepEqual(await f.tool("learner-notes.read"), { ok: true, notes: EMPTY });
  const written = await f.tool("learner-notes.update", { text: "Prefers short steps.\n\n- Confident with the Preview.", requestId: "n1", expectedRevision: 0 });
  assert.equal(written.ok, true);
  assert.equal(written.changed, true);
  assert.equal(written.notes.revision, 1);
  assert.equal(written.notes.updatedBy, "colleague", "a tool call is Colleague acting for the learner");
  assert.ok(Number.isFinite(Date.parse(written.notes.updatedAt)));
  assert.deepEqual(await f.execute("learner-notes.read"), { ok: true, notes: written.notes }, "API and tool read the same notes");

  const edited = await f.execute("learner-notes.update", { text: "I learn best with diagrams.", requestId: "e1", expectedRevision: 1 });
  assert.equal(edited.notes.updatedBy, "learner", "the learner's own browser edit");
  const cleared = await f.execute("learner-notes.clear", { requestId: "c1", expectedRevision: 2 });
  assert.deepEqual({ ...cleared.notes, updatedAt: null }, { text: "", revision: 3, updatedAt: null, updatedBy: "learner" });
  assert.deepEqual(notices(f), [1, 2, 3].map(() => [VIBE64_TRAINING_LEARNER_CHANGED_EVENT, "all_clients",
    { learnerId: "42", reason: "notes" }]), "every change notifies only the learner it names, with no attempt");
  assert.ok(f.published.every(event => event.entityId === "teacher-notes"));

  // The notes are their own record: no learner progress, step result or attempt is created.
  assert.deepEqual((await readdir(f.userRoot(ALICE))).sort(), ["teacher-notes.json", "teacher-notes.lock"]);
  const state = await f.learners.readState({ actor: ALICE });
  assert.deepEqual(state.progress.attempts, []);
  assert.equal(state.progress.revision, 0);
  assert.equal((await stat(path.join(f.userRoot(ALICE), "teacher-notes.json"))).mode & 0o777, 0o600);
});

test("another learner and the workspace owner can never read or change a learner's notes", async t => {
  const f = await fixture(t);
  await f.execute("learner-notes.update", { text: "Alice finds Git confusing.", requestId: "a1", expectedRevision: 0 });
  f.auth.user = BOB;
  assert.deepEqual(await f.execute("learner-notes.read"), { ok: true, notes: EMPTY });
  assert.deepEqual(await f.tool("learner-notes.read"), { ok: true, notes: EMPTY });
  // No input names a learner: an extra identity field is refused or ignored, never honoured.
  for (const input of [{ learnerId: "42" }, { actor: ALICE }, { uid: 42 }]) {
    const result = await f.execute("learner-notes.read", input).catch(error => error);
    assert.doesNotMatch(JSON.stringify(result?.notes ?? result?.message ?? ""), /Alice/u);
  }
  await f.execute("learner-notes.update", { text: "Bob likes examples.", requestId: "a1", expectedRevision: 0 });
  f.auth.user = OWNER;
  assert.deepEqual((await f.execute("learner-notes.read")).notes, EMPTY, "an owner reads only their own notes");
  await f.execute("learner-notes.clear", { requestId: "o1", expectedRevision: 0 });
  f.auth.user = ALICE;
  assert.equal((await f.execute("learner-notes.read")).notes.text, "Alice finds Git confusing.",
    "another person's same request ID and clear never touch this learner");
  assert.deepEqual(notices(f).map(([, , payload]) => payload.learnerId), ["42", "43", "1"]);

  // A record copied from another learner is refused, not adopted or repaired.
  const bobRecord = await readFile(path.join(f.userRoot(BOB), "teacher-notes.json"), "utf8");
  await writeFile(path.join(f.userRoot(ALICE), "teacher-notes.json"), bobRecord, { mode: 0o600 });
  await assert.rejects(f.execute("learner-notes.read"), { code: "VIBE64_TRAINING_NOTES_STATE_INVALID", message: /^Learner notes are invalid: .*Keep the file/su });
  await assert.rejects(f.learners.saveTeacherNotes({ actor: ALICE, text: "x", requestId: "a2", updatedBy: "learner" }),
    { code: "VIBE64_TRAINING_NOTES_STATE_INVALID", message: /^Learner notes are invalid: .*Keep the file/su });
  assert.equal(await readFile(path.join(f.userRoot(ALICE), "teacher-notes.json"), "utf8"), bobRecord, "nothing was overwritten");
});

test("a retry with the same request ID replays the save without a second change", async t => {
  const f = await fixture(t);
  const first = await f.tool("learner-notes.update", { text: "Strength: reads errors carefully.", requestId: "r1", expectedRevision: 0 });
  const replay = await f.tool("learner-notes.update", { text: "Strength: reads errors carefully.", requestId: "r1", expectedRevision: 0 });
  assert.deepEqual(replay, { ...first, replayed: true, changed: false });
  assert.equal(f.published.length, 1, "a replay does not notify again");
  await assert.rejects(f.execute("learner-notes.update", { text: "Different text.", requestId: "r1", expectedRevision: 1 }, "automation"),
    { code: "VIBE64_TRAINING_NOTES_REQUEST_REUSED" });
  // A delayed retry of an older request after a newer write replays; it never restores the older text.
  await f.execute("learner-notes.update", { text: "Newer summary.", requestId: "r2", expectedRevision: 1 });
  const late = await f.tool("learner-notes.update", { text: "Strength: reads errors carefully.", requestId: "r1", expectedRevision: 0 });
  assert.equal(late.replayed, true);
  assert.equal(late.notes.text, "Newer summary.");
  await assert.rejects(f.execute("learner-notes.update", { text: "Stale edit.", requestId: "r3", expectedRevision: 1 }),
    { code: "VIBE64_TRAINING_NOTES_CHANGED" });
  assert.equal((await f.execute("learner-notes.read")).notes.revision, 2, "a refused stale save changes nothing");
  // The replay window keeps the latest 32 request identities.
  for (let index = 0; index < 32; index += 1) {
    await f.learners.saveTeacherNotes({ actor: ALICE, text: `Summary ${index}.`, requestId: `w${index}`, updatedBy: "colleague" });
  }
  const saved = JSON.parse(await readFile(path.join(f.userRoot(ALICE), "teacher-notes.json"), "utf8"));
  assert.equal(saved.requests.length, 32);
  assert.deepEqual([saved.requests[0].requestId, saved.requests.at(-1).requestId], ["w0", "w31"]);
  assert.equal(saved.revision, 34);
  // Once a request has left that window, the required expectedRevision still
  // refuses a late retry instead of restoring its older text.
  await assert.rejects(f.execute("learner-notes.update", { text: "Strength: reads errors carefully.", requestId: "r1", expectedRevision: 0 },
    "automation"), { code: "VIBE64_TRAINING_NOTES_CHANGED" });
  assert.equal((await f.execute("learner-notes.read")).notes.text, "Summary 31.");
  for (const name of ["learner-notes.update", "learner-notes.clear"]) {
    await assert.rejects(f.execute(name, name.endsWith(".clear") ? { requestId: "x1" } : { text: "No revision.", requestId: "x1" }), { code: "ACTION_VALIDATION_FAILED" },
      `${name} requires the revision it replaces`);
  }
});

test("notes are bounded to 4000 characters of Markdown text without control characters", async t => {
  const f = await fixture(t);
  const longest = "é".repeat(3999) + "\n";
  assert.equal((await f.execute("learner-notes.update", { text: longest, requestId: "b1", expectedRevision: 0 })).notes.text, longest);
  await assert.rejects(f.execute("learner-notes.update", { text: "x".repeat(4001), requestId: "b2", expectedRevision: 1 }), { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.execute("learner-notes.update", { text: "x".repeat(4001), requestId: "b2", expectedRevision: 1 }, "automation"),
    { code: "ACTION_VALIDATION_FAILED" });
  await assert.rejects(f.execute("learner-notes.update", { text: "", requestId: "b3", expectedRevision: 1 }), { code: "ACTION_VALIDATION_FAILED" },
    "an empty update is a clear, which only the learner's browser does");
  await assert.rejects(f.execute("learner-notes.update", { text: "bell\u0007", requestId: "b4", expectedRevision: 1 }), { code: "VIBE64_TRAINING_NOTES_INVALID" });
  await assert.rejects(f.learners.saveTeacherNotes({ actor: ALICE, text: "x".repeat(4001), requestId: "b5", updatedBy: "colleague" }),
    { code: "VIBE64_TRAINING_NOTES_INVALID" });
  await assert.rejects(f.learners.saveTeacherNotes({ actor: ALICE, text: "x", requestId: "b6", updatedBy: "owner" }),
    { code: "VIBE64_TRAINING_NOTES_INVALID" });
  assert.equal((await f.execute("learner-notes.read")).notes.text, longest, "refused saves change nothing");
  // An oversized or noncanonical file is refused on read, never truncated or repaired.
  const file = path.join(f.userRoot(ALICE), "teacher-notes.json");
  await writeFile(file, JSON.stringify({ padding: "x".repeat(33 * 1024) }), { mode: 0o600 });
  await assert.rejects(f.execute("learner-notes.read"), { code: "VIBE64_TRAINING_NOTES_STATE_INVALID", message: /^Learner notes are invalid: .*Keep the file/su });
  const record = { schemaVersion: 1, learnerId: "42", revision: 1, text: "x".repeat(4001), updatedAt: new Date().toISOString(),
    updatedBy: "learner", requests: [] };
  await writeFile(file, JSON.stringify(record), { mode: 0o600 });
  await assert.rejects(f.execute("learner-notes.read"), { code: "VIBE64_TRAINING_NOTES_STATE_INVALID", message: /^Learner notes are invalid: .*Keep the file/su });
});
