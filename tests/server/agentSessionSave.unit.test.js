import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { sessionCommandProject, sessionHelper } from "./agentSessionUpdateTestHelpers.js";

const PERSON = { id: "person-1" };
const OWN_COMMIT = "a".repeat(40);
const LIBRARY_COMMIT = "b".repeat(40);
const AFTER_PLAN = ["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"];
const routing = autoSave => JSON.stringify({ mode: "auto", afterPlan: AFTER_PLAN, afterPlanDeep: [], autoSave });
const LEAVE_TO_PERSON = "Don't run it again here. When the work is ready, tell the person it is ready to save: they choose Save.";
const MAIN_CHAT_ONLY = "Only the main chat saves with it, while its Automatically save changes is on: " +
  "temporary chats, AI tasks, Fix it with AI and lessons never save by themselves.";
const temporaryChat = (fields = {}) => ({ conversationId: "temporary-1", number: 2, status: "inProgress", ...fields });
const aiTask = (kind, title, fields = {}) => ({ conversationId: `task-${kind}`, status: "ready", task: { active: true, kind, title, ...fields } });

/**
 * The helper over a scripted Save, in a session whose main chat turn runs (`agentRuns`) with Automatically save
 * changes on unless `metadata` or `session` say otherwise. Each Save takes the next result and records its input.
 * @param {import("node:test").TestContext} t
 */
async function scriptedSave(t, { conversations = [], metadata: extra = {}, results = [], session: fields = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-session-save-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const metadata = {
    assistant_routing: routing(true),
    assistant_routing_request: JSON.stringify({ submittedBy: PERSON }),
    source_kind: "session_clone",
    source_path_authority: "managed_session_source",
    ...extra
  };
  const session = {
    agentRuns: [{ active: true }],
    metadata,
    sessionId: "session-1",
    sourcePath: path.join(root, "sessions", "active", "session-1", "source"),
    ...fields
  };
  metadata.source_path = session.sourcePath;
  await mkdir(session.sourcePath, { recursive: true });
  const calls = [];
  const commandService = createAgentSessionCommandService({
    logger: silentLogger,
    project: sessionCommandProject(session, {
      listSessionConversations: async () => conversations,
      readMetadataValue: async (_sessionId, name) => metadata[name] || "",
      readSession: async () => session
    }),
    publishSessionChanged: async () => {},
    async saveSessionWork(sessionId, input) {
      calls.push({ input, sessionId });
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  });
  return { calls, helper: await sessionHelper(t, commandService, session) };
}

test("session save runs the session's own Save for the person the AI works for, and says what it saved and what follows", async (t) => {
  const f = await scriptedSave(t, {
    results: [{
      ok: true,
      status: "saved",
      reconciled: true,
      saveCommit: OWN_COMMIT,
      changedPaths: ["src/app.js", "README.md"],
      refreshedPaths: [".genesis/machine-city.json"],
      unsavedPathCount: 1,
      connected: [{ name: "library", saveCommit: LIBRARY_COMMIT, changedPaths: ["../connected/library/index.js"] }]
    }]
  });

  const saved = await f.helper(["save"]);

  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual(f.calls, [{ input: { requestedByAgent: true, vibe64User: PERSON }, sessionId: "session-1" }]);
  assert.deepEqual(saved.stdout.trim().split("\n"), [
    `Saved: this session saved at ${OWN_COMMIT.slice(0, 12)}; library saved at ${LIBRARY_COMMIT.slice(0, 12)}. ` +
      "3 files saved: src/app.js, README.md, ../connected/library/index.js. 1 file changed while Save ran and stays unsaved.",
    "Next: Save regenerated .genesis/machine-city.json in this session: re-read it before editing. " +
      "Tell the other sessions you are working with (vibe64-helper session message-project) that this work is saved, " +
      "so they run vibe64-helper session update before building on the old code."
  ]);
});

test("session save --json names each saved commit, the files and whether the session is on the saved version", async (t) => {
  const changedPaths = Array.from({ length: 25 }, (_value, index) => `src/file-${index}.js`);
  const f = await scriptedSave(t, {
    results: [{ ok: true, status: "published_needs_reconcile", reconciled: false, saveCommit: OWN_COMMIT, changedPaths, connected: [] }]
  });

  const saved = await f.helper(["save", "--json"]);

  assert.equal(saved.code, 0, saved.stderr);
  assert.deepEqual(JSON.parse(saved.stdout), {
    sessionId: "session-1",
    ok: true,
    status: "saved",
    message: `Saved: this session saved at ${OWN_COMMIT.slice(0, 12)}. 25 files saved: ${changedPaths.slice(0, 20).join(", ")} and 5 more. ` +
      "A Git commit was made in this session while Save ran, so the session stays on that commit, with every change kept.",
    next: "Run vibe64-helper session update to bring this session onto the saved version. " +
      "Tell the other sessions you are working with (vibe64-helper session message-project) that this work is saved, " +
      "so they run vibe64-helper session update before building on the old code.",
    repositories: [{ name: "this session", commit: OWN_COMMIT.slice(0, 12) }],
    savedFileCount: 25,
    savedFiles: changedPaths.slice(0, 20),
    regeneratedFiles: [],
    unsavedFileCount: 0,
    onSavedVersion: false
  });
});

test("session save refuses outside the main chat's own turn with automatic save on, naming why, and never runs Save", async (t) => {
  const cases = [
    {
      name: "automatic save off",
      setup: { metadata: { assistant_routing: routing(false) } },
      code: "vibe64_agent_session_save_off",
      message: "Not saved: Automatically save changes is off in this chat's settings, so the person saves its work with the Save button.",
      next: "Don't run it again in this chat. When the work is ready, tell the person it is ready to save."
    },
    {
      name: "unreadable chat settings",
      setup: { metadata: { assistant_routing: "{" } },
      code: "vibe64_agent_session_save_off"
    },
    {
      name: "a temporary chat at work",
      setup: { conversations: [temporaryChat()], session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_temporary_chat",
      message: `Not saved: this command ran in the temporary chat "Temporary 2", and temporary chats never save by themselves. ${MAIN_CHAT_ONLY}`,
      next: LEAVE_TO_PERSON
    },
    {
      name: "a renamed temporary chat starting a turn",
      setup: { conversations: [temporaryChat({ status: "starting", title: "Try the menu" })], session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_temporary_chat",
      message: `Not saved: this command ran in the temporary chat "Try the menu", and temporary chats never save by themselves. ${MAIN_CHAT_ONLY}`
    },
    {
      name: "a Colleague AI task",
      setup: { conversations: [aiTask("colleague-review", "Review the checkout")], session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_ai_task",
      message: `Not saved: this command ran in the AI task "Review the checkout", and AI tasks never save by themselves. ${MAIN_CHAT_ONLY}`,
      next: LEAVE_TO_PERSON
    },
    {
      name: "Fix it with AI",
      setup: { conversations: [aiTask("update", "Fix the Update conflict")], session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_fix_it",
      message: `Not saved: this command ran in Fix it with AI "Fix the Update conflict", and Fix it with AI never saves by itself. ${MAIN_CHAT_ONLY}`,
      next: LEAVE_TO_PERSON
    },
    {
      name: "several other chats at work",
      setup: { conversations: [aiTask("colleague-review", "Review"), aiTask("page-refresh", "Refresh the sales page")], session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_other_chat",
      message: 'Not saved: this command ran in one of the AI task "Review" and the AI task "Refresh the sales page", ' +
        `and none of them saves by itself. ${MAIN_CHAT_ONLY}`,
      next: LEAVE_TO_PERSON
    },
    {
      name: "a lesson",
      setup: { metadata: { learning_session: "{}" } },
      code: "vibe64_agent_session_save_lesson",
      message: "Not saved: this session is a lesson, and a lesson never saves by itself: saving is part of what it teaches.",
      next: LEAVE_TO_PERSON
    },
    {
      name: "no main chat turn",
      setup: { session: { agentRuns: [] } },
      code: "vibe64_agent_session_save_no_turn",
      message: `Not saved: no main chat turn is running, and the main chat's AI saves with this command only during its own turn. ${MAIN_CHAT_ONLY}`,
      next: LEAVE_TO_PERSON
    },
    {
      name: "another chat at work beside the main chat",
      setup: { conversations: [temporaryChat(), aiTask("database-overview", "Group the tables")] },
      code: "vibe64_agent_session_save_chat_unknown",
      message: 'Not saved: the temporary chat "Temporary 2" and the AI task "Group the tables" are working in this session ' +
        `as well as the main chat, so Vibe64 can't tell which chat ran this command. ${MAIN_CHAT_ONLY}`,
      next: "If this is the main chat, run vibe64-helper session save again once they have finished. Otherwise leave Save to the person."
    }
  ];
  for (const entry of cases) {
    const f = await scriptedSave(t, { ...entry.setup, results: [{ ok: true, saveCommit: OWN_COMMIT }] });
    const refused = await f.helper(["save", "--json"]);
    assert.equal(refused.code, 1, entry.name);
    const answer = JSON.parse(refused.stdout);
    assert.deepEqual([answer.ok, answer.status, answer.code], [false, "not_allowed", entry.code], entry.name);
    if (entry.message) assert.equal(answer.message, entry.message, entry.name);
    if (entry.next) assert.equal(answer.next, entry.next, entry.name);
    assert.deepEqual(f.calls, [], `${entry.name}: Save never ran`);
  }
});

test("chats that have finished, are closing or wait for the person leave the main chat free to save", async (t) => {
  const f = await scriptedSave(t, {
    conversations: [
      temporaryChat({ status: "ready" }),
      temporaryChat({ conversationId: "temporary-2", state: "closing" }),
      aiTask("update", "Fix the Update conflict", { active: false, phase: "needs_you" }),
      { ...aiTask("colleague-review", "Review"), state: "closing" }
    ],
    results: [{ ok: true, status: "saved", reconciled: true, saveCommit: OWN_COMMIT, changedPaths: ["a.txt"] }]
  });

  const saved = await f.helper(["save"]);

  assert.equal(saved.code, 0, saved.stderr || saved.stdout);
  assert.equal(f.calls.length, 1);
});

test("Save's own refusals come back with their next step: nothing to save, Update first, and every other one as Save says it", async (t) => {
  const f = await scriptedSave(t, {
    results: [
      { ok: false, code: "vibe64_session_save_no_changes", error: "This session has no work to save." },
      { ok: false, code: "vibe64_session_save_update_required", error: "Update this session before saving." },
      { ok: false, code: "vibe64_pull_request_required", error: "This project requires a pull request. Create or open a pull request before saving this session." },
      { ok: false, code: "vibe64_agent_write_mode_busy", error: "This session is being updated. Try again when Update finishes.", retryable: true },
      { ok: false, code: "vibe64_session_save_history_diverged", error: "This session's history was rewritten." },
      { ok: false, code: "vibe64_session_save_unavailable", error: "Save is unavailable while Vibe64 starts or stops." },
      // A finished Save that does not say what it saved is not a Save.
      { ok: true, status: "saved", connected: [] },
      new Error("The active Vibe64 session source is unavailable.")
    ]
  });

  const answers = [];
  for (let index = 0; index < 7; index += 1) {
    const answer = await f.helper(["save", "--json"]);
    assert.equal(answer.code, 1, `answer ${index}`);
    answers.push(JSON.parse(answer.stdout));
  }

  const next = "Read what it says. If something else is running, run vibe64-helper session save again in a moment. " +
    "If the cause is in this session's files, fix it and run it again. Otherwise tell the person what it says.";
  assert.deepEqual(answers.map(({ code, message, next: step, status }) => ({ code, message, next: step, status })), [
    {
      code: "vibe64_session_save_no_changes",
      message: "Nothing to save: this session and its connected repositories have no unsaved work.",
      next: "Nothing to do: their saved versions already hold this work.",
      status: "nothing_to_save"
    },
    {
      code: "vibe64_session_save_update_required",
      message: "Not saved: Update this session before saving.",
      next: "Run vibe64-helper session update, which keeps this session's unsaved work, deal with anything it reports, " +
        "then run vibe64-helper session save again. Never merge, pull or rebase yourself, and never offer the person a merge: " +
        "Update is how newer saved versions come in. Tell the person what the message says, naming only the session it names.",
      status: "update_first"
    },
    {
      code: "vibe64_pull_request_required",
      message: "Not saved: This project requires a pull request. Create or open a pull request before saving this session.",
      next,
      status: "failed"
    },
    { code: "vibe64_agent_write_mode_busy", message: "Not saved: This session is being updated. Try again when Update finishes.", next, status: "failed" },
    { code: "vibe64_session_save_history_diverged", message: "Not saved: This session's history was rewritten.", next, status: "failed" },
    { code: "vibe64_session_save_unavailable", message: "Not saved: Save is unavailable while Vibe64 starts or stops.", next, status: "failed" },
    { code: "", message: "Not saved: Save finished without saying what it saved.", next, status: "failed" }
  ]);
  assert.equal(f.calls.length, 7);
  // A command that never reached Save reports its own failure.
  const unreached = await f.helper(["save"]);
  assert.deepEqual([unreached.code, unreached.stdout, unreached.stderr.trim()], [1, "", "The active Vibe64 session source is unavailable."]);
});

test("session save refuses arguments it does not take before running Save", async (t) => {
  const f = await scriptedSave(t);
  for (const args of [["save", "now"], ["save", "--json", "--json"], ["save", "--force"], ["save", "--json", "all"]]) {
    const refused = await f.helper(args);
    assert.equal(refused.code, 2, args.join(" "));
    assert.match(refused.stderr, /\| save \[--json\]/u);
  }
  assert.deepEqual(f.calls, []);
});
