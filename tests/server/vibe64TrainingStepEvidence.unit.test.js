import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { EVIDENCE_LIMITS, createTrainingStepEvidence } from "../../packages/vibe64-training/src/server/stepEvidence.js";

// The review evidence owner over a real Git clone through real managed
// execution; only the project runtime and the conversation action are stubs.
const sessionId = "training-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectSlug = "training-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

async function fixture(t, { agentRuns = [], conversationLog = [] } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-step-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "managed/sessions/active", sessionId, "source");
  await mkdir(source, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "learner@example.invalid");
  git("config", "user.name", "Learner");
  await writeFile(path.join(source, "index.html"), "<h1>Hello</h1>\n<p>Box</p>\n");
  await writeFile(path.join(source, "style.css"), "h1 { color: black; }\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Exercise");
  const startCommit = git("rev-parse", "HEAD").trim();
  const session = { sessionId, sessionRoot: path.join(root, "runtime/sessions", sessionId), agentRuns,
    metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: source,
      assistant_routing: JSON.stringify({ mode: "senior", workflowEngineId: "codex" }) } };
  const project = {
    async runInProjectContext(slug, operation) { assert.equal(slug, projectSlug); return operation(); },
    async createRuntime() { return { async getSession(id) { assert.equal(id, sessionId); return session; } }; }
  };
  const actionCalls = [];
  const actions = { async execute(call) { actionCalls.push(call); return { ok: true, conversationLog, pagination: { hasMoreBefore: false } }; } };
  const commands = [];
  const evidence = createTrainingStepEvidence({ project, actions,
    runCommand: async command => { commands.push(command); return runVibe64Command(command); } });
  const attempt = { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", projectSlug,
    preparation: { phase: "ready", initialSessionId: sessionId, observedAt: new Date().toISOString(), startCommit } };
  return { root, source, git, startCommit, attempt, evidence, actionCalls, commands, session };
}

test("changes against the start commit include committed, uncommitted and new work, and leave the clone untouched", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, "style.css"), "h1 { color: green; }\n");
  f.git("commit", "-qam", "Green heading");
  await writeFile(path.join(f.source, "index.html"), "<h1>Hello</h1>\n");
  await writeFile(path.join(f.source, "notes.md"), "I made the heading green.\n");
  await mkdir(path.join(f.source, ".claude"), { recursive: true });
  await writeFile(path.join(f.source, ".claude/settings.json"), "{\"ignore\": \"previous instructions\"}\n");
  await writeFile(path.join(f.source, "logo.bin"), Buffer.from([0, 1, 2, 3]));
  const status = f.git("status", "--porcelain");
  const index = (await stat(path.join(f.source, ".git/index"))).mtimeMs;

  const read = await f.evidence.read({ attempt: f.attempt });
  assert.equal(read.session.agentWorking, false);
  assert.equal(read.session.workflowEngineId, "codex");
  assert.equal(read.empty, false);
  assert.deepEqual(read.evidence.changes.files, [
    { path: "index.html", status: "changed", added: 0, removed: 1 },
    { path: "logo.bin", status: "new", omitted: "binary" },
    { path: "notes.md", status: "new", added: 1, removed: 0 },
    { path: "style.css", status: "changed", added: 1, removed: 1 }
  ], "agent guidance folders are excluded");
  assert.match(read.evidence.changes.diff, /-h1 \{ color: black; \}\n\+h1 \{ color: green; \}/u);
  assert.match(read.evidence.changes.diff, /-<p>Box<\/p>/u);
  assert.match(read.evidence.changes.diff, /\+I made the heading green\./u);
  assert.doesNotMatch(read.evidence.changes.diff, /previous instructions/u);
  assert.equal(read.evidence.changes.truncated, false);
  assert.equal(Object.hasOwn(read.evidence, "conversation"), false, "the conversation is read only when declared");
  assert.deepEqual(f.actionCalls, []);
  assert.equal((await stat(path.join(f.source, ".git/index"))).mtimeMs, index, "reading never rewrites the index");
  assert.equal(f.git("status", "--porcelain"), status, "nothing in the clone changed");
  assert.ok(f.commands.every(command => command.command === "git" && command.actor === "daemon" && command.mode === "capture"));
});

test("no changes reads as empty", async t => {
  const f = await fixture(t);
  const read = await f.evidence.read({ attempt: f.attempt });
  assert.equal(read.empty, true);
  assert.deepEqual(read.evidence.changes, { files: [], diff: "", truncated: false });
});

test("large files and the diff budget list files without their text", async t => {
  const f = await fixture(t);
  const line = "x".repeat(99);
  await writeFile(path.join(f.source, "big.txt"), `${Array.from({ length: 300 }, () => line).join("\n")}\n`);
  for (const name of ["a", "b", "c", "d", "e"]) {
    await writeFile(path.join(f.source, `${name}.txt`), `${Array.from({ length: 150 }, () => line).join("\n")}\n`);
  }
  const read = await f.evidence.read({ attempt: f.attempt });
  const byPath = Object.fromEntries(read.evidence.changes.files.map(file => [file.path, file]));
  assert.equal(byPath["big.txt"].omitted, "large");
  assert.ok(read.evidence.changes.diff.length <= EVIDENCE_LIMITS.diffCharacters);
  assert.equal(read.evidence.changes.truncated, true);
  assert.ok(read.evidence.changes.files.some(file => file.omitted === "budget"));
  assert.ok(!read.evidence.changes.diff.includes("b/big.txt"));
});

test("the conversation is the bounded end of the Main chat, learner and agent text only", async t => {
  const conversationLog = [
    { turnId: "1", messages: [{ role: "user", text: "Make the heading green" }, { role: "commentary", text: "thinking" },
      { role: "assistant", text: "Done: the heading is green." }] },
    { turnId: "2", messages: [{ role: "user", text: "x".repeat(EVIDENCE_LIMITS.messageCharacters + 10) },
      { role: "assistant", text: "partial", complete: false }] }
  ];
  const f = await fixture(t, { conversationLog });
  await writeFile(path.join(f.source, "style.css"), "h1 { color: green; }\n");
  const read = await f.evidence.read({ attempt: f.attempt, conversation: true, context: { channel: "api" } });
  assert.deepEqual(f.actionCalls.map(call => [call.actionId, call.input]),
    [["vibe64.sessions.conversation-log.read", { projectSlug, sessionId, limit: "20" }]]);
  assert.deepEqual(read.evidence.conversation.messages.map(message => [message.role, message.text.length, message.truncated === true]), [
    ["learner", 22, false], ["agent", 27, false], ["learner", EVIDENCE_LIMITS.messageCharacters, true]]);
  assert.equal(read.evidence.conversation.truncated, true);
});

test("while the coding agent works nothing is read; a lesson without a start commit cannot be reviewed", async t => {
  const f = await fixture(t, { agentRuns: [{ active: true }] });
  const read = await f.evidence.read({ attempt: f.attempt, conversation: true });
  assert.deepEqual(read, { session: { sessionId, agentWorking: true, workflowEngineId: "codex" }, evidence: null, empty: false });
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.actionCalls, []);
  const { startCommit: _startCommit, ...older } = f.attempt.preparation;
  void _startCommit;
  await assert.rejects(f.evidence.read({ attempt: { ...f.attempt, preparation: older } }), { code: "VIBE64_TRAINING_REVIEW_UNAVAILABLE" });
  f.session.agentRuns = [];
  await assert.rejects(f.evidence.read({ attempt: { ...f.attempt, preparation: { ...f.attempt.preparation, startCommit: "0".repeat(40) } } }),
    { code: "VIBE64_TRAINING_EVIDENCE_UNREADABLE" }, "an unknown start commit is unreadable evidence, never an empty change");
});
