import assert from "node:assert/strict";
import test from "node:test";
import { advanceAiTask, createAiTask } from "../../packages/vibe64-ai-tasks/src/server/aiTaskMachine.js";
import { prepareCopiedSessionConversation } from "../../packages/vibe64-terminals/src/server/sessionConversations.js";

const AT = "2026-11-04T10:00:00.000Z";
const ANA = { id: 7, name: "Ana" };

function kindCheckedBy(by) {
  return {
    id: "update",
    title: "Fix Update",
    noun: "fix",
    routing: "fix",
    opening: "Fix this Update problem without losing work.",
    updateRepair: true,
    brief: problem => `Repair: ${problem.summary}`,
    context: problem => `Context: ${problem.summary}`,
    steps: ["The AI repairs the conflicts", "Vibe64 runs Update"],
    check: by === "vibe64"
      ? { by, label: "Running Update…", output: "Update output", unstoppable: "Update can't be interrupted.", retry: { limit: 3 } }
      : { by },
    done: "Session updated."
  };
}

function taskIn(phase, overrides = {}, by = "vibe64") {
  const task = createAiTask({
    kind: kindCheckedBy(by),
    problem: { key: "k", summary: "Update found conflicts in 2 files.", details: "", facts: { reviewId: "r1" } },
    taskInput: {},
    startedBy: ANA,
    at: AT,
    sendId: "send-1"
  });
  const pending = {
    starting: task.pending,
    working: null,
    checking: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true }
  }[phase] ?? null;
  return { ...task, phase, active: ["starting", "working", "checking", "cancelling"].includes(phase), pending, ...overrides };
}

const send = (id, extra = {}) => ({ effect: "send", id, ...extra });
const event = (type, extra = {}) => ({ type, at: AT, ...extra });
const checkFailure = (extra = {}) => event("check_failed", {
  id: "check-1",
  message: "Update still has conflicts in 1 file.",
  retryKey: "key-1",
  retryMessage: "Repair the rest.",
  retryDisplay: "Continue repairing the remaining conflicts.",
  sendId: "send-2",
  hasDraft: false,
  ...extra
});

// Every row of the design's table: from, event, to, and what must hold after.
const ROWS = [
  ["starting: first turn admitted", taskIn("starting"), event("turn_admitted"),
    { phase: "working", pending: null, active: true }],
  ["starting: no account or model", taskIn("starting"), event("turn_unavailable", { message: "Sign in again." }),
    { phase: "needs_you", reason: "ai_unavailable", message: "Sign in again.", pending: null, active: false }],
  ["starting: send failed", taskIn("starting"), event("turn_failed", { message: "Boom" }),
    { phase: "needs_you", reason: "turn_failed", pending: null }],
  ["working: complete, check by Vibe64", taskIn("working"), event("turn_result", { kind: "complete", message: "m", report: "Merged.", id: "check-1" }),
    { phase: "checking", report: "Merged.", pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true }, active: true }],
  ["working: complete, check by agent", taskIn("working", {}, "agent"), event("turn_result", { kind: "complete", message: "m", report: "Did it." }),
    { phase: "done", message: "Session updated.", report: "Did it.", active: false, pending: null, endedAt: AT }],
  ["working: turn ended, check by person", taskIn("working", {}, "person"), event("turn_ended"),
    { phase: "needs_you", reason: "your_turn", active: false }],
  ["working: question", taskIn("working"), event("turn_result", { kind: "question", message: "Which one?" }),
    { phase: "needs_you", reason: "question", message: "Which one?" }],
  ["working: cannot", taskIn("working"), event("turn_result", { kind: "cannot", message: "It needs a key." }),
    { phase: "needs_you", reason: "ai_stuck", message: "It needs a key." }],
  ["working: no valid result", taskIn("working"), event("turn_ended"),
    { phase: "needs_you", reason: "no_result" }],
  ["working: Stop", taskIn("working"), event("turn_stopped"),
    { phase: "needs_you", reason: "stopped" }],
  ["working: credentials or model failed", taskIn("working"), event("turn_unavailable", { message: "Sign in." }),
    { phase: "needs_you", reason: "ai_unavailable", message: "Sign in." }],
  ["working: anything else failed", taskIn("working"), event("turn_failed", { message: "Boom" }),
    { phase: "needs_you", reason: "turn_failed", message: "Boom" }],
  ["working: restart lost the turn", taskIn("working"), event("turn_lost"),
    { phase: "needs_you", reason: "interrupted", active: false }],
  ["checking: passed", taskIn("checking"), event("check_passed", { id: "check-1", message: "Session updated. Nothing was pushed." }),
    { phase: "done", message: "Session updated. Nothing was pushed.", pending: null, active: false }],
  ["checking: passed uses the kind's message when the check has none", taskIn("checking"), event("check_passed", { id: "check-1" }),
    { phase: "done", message: "Session updated." }],
  ["checking: waiting", taskIn("checking"), event("check_waiting", { id: "check-1", message: "Update waits." }),
    { phase: "checking", waiting: true, message: "Update waits.", active: true, mainChatSince: "",
      pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true } }],
  ["checking: waiting for the main chat's AI records when its turn started", taskIn("checking"),
    event("check_waiting", { id: "check-1", message: "Save waits.", mainChatSince: "2026-11-04T09:30:00.000Z" }),
    { phase: "checking", waiting: true, mainChatSince: "2026-11-04T09:30:00.000Z",
      pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true } }],
  ["checking, waiting for the AI: Save now runs the check at once",
    taskIn("checking", { waiting: true, check: { ...taskIn("checking").check, whileAiWorks: { action: "Save now", note: "n" } } }),
    event("check_now", { id: "check-2", whileAiWorks: true }),
    { phase: "checking", waiting: false,
      pending: { effect: "check", id: "check-2", reviewedConflictId: "", retryAi: true, whileAiWorks: true } }],
  ["checking, waiting: a kind without Save now ignores it", taskIn("checking", { waiting: true }),
    event("check_now", { id: "check-2", whileAiWorks: true }),
    { phase: "checking", waiting: true, pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true } }],
  ["checking, running: Save now leaves the running check alone",
    taskIn("checking", { check: { ...taskIn("checking").check, whileAiWorks: { action: "Save now", note: "n" } } }),
    event("check_now", { id: "check-2", whileAiWorks: true }),
    { phase: "checking", waiting: false, pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true } }],
  ["checking: failed, new key, tries left", taskIn("checking"), checkFailure(),
    { phase: "working", attempt: 2, retryKeys: ["key-1"], turnMessageId: "send-2", active: true,
      pending: send("send-2", { message: "Repair the rest.", display: "Continue repairing the remaining conflicts." }) }],
  ["checking: failed with a draft waiting", taskIn("checking"), checkFailure({ hasDraft: true }),
    { phase: "needs_you", reason: "draft_waiting", attempt: 1, pending: null }],
  ["checking: failed, tries used", taskIn("checking", { attempt: 3, retryKeys: ["a", "b"] }), checkFailure(),
    { phase: "needs_you", reason: "check_stuck", message: "Update still has conflicts in 1 file." }],
  ["checking: same failure again", taskIn("checking", { attempt: 2, retryKeys: ["key-1"] }), checkFailure(),
    { phase: "needs_you", reason: "check_stuck" }],
  ["checking: not the AI's to repair", taskIn("checking"), checkFailure({ retryKey: "" }),
    { phase: "needs_you", reason: "check_stuck" }],
  ["checking: a reviewed check goes to the person, not the AI",
    taskIn("checking", { pending: { effect: "check", id: "check-1", reviewedConflictId: "r1", retryAi: false } }), checkFailure(),
    { phase: "needs_you", reason: "check_stuck" }],
  ["checking: result unknown after restart", taskIn("checking"), event("check_unknown", { id: "check-1", message: "No answer." }),
    { phase: "needs_you", reason: "unconfirmed", message: "No answer." }],
  ["needs_you: person's message resets retries",
    taskIn("needs_you", { reason: "check_stuck", attempt: 3, retryKeys: ["a", "b"] }), event("person_message", { messageId: "m-9" }),
    { phase: "working", reason: "", attempt: 1, retryKeys: [], turnMessageId: "m-9", pending: null, active: true }],
  ["needs_you: Continue", taskIn("needs_you", { reason: "stopped", attempt: 2, retryKeys: ["a"] }), event("continue", { id: "send-3" }),
    { phase: "working", reason: "", attempt: 2, retryKeys: ["a"], turnMessageId: "send-3",
      pending: send("send-3", { message: "Continue working on this task from where you stopped.", display: "Continue." }) }],
  ["needs_you: Check now", taskIn("needs_you", { reason: "no_result" }), event("check_now", { id: "check-2" }),
    { phase: "checking", reason: "", pending: { effect: "check", id: "check-2", reviewedConflictId: "", retryAi: true } }],
  ["needs_you: a reviewed Check now does not go back to the AI", taskIn("needs_you", { reason: "check_stuck" }),
    event("check_now", { id: "check-2", reviewedConflictId: "r1" }),
    { phase: "checking", pending: { effect: "check", id: "check-2", reviewedConflictId: "r1", retryAi: false } }],
  ["needs_you (your_turn): Finish", taskIn("needs_you", { reason: "your_turn" }, "person"), event("finish", { by: ANA }),
    { phase: "done", message: "You finished this task.", endedBy: ANA }],
  ["needs_you: Cancel with nothing running", taskIn("needs_you", { reason: "stopped" }), event("cancel", { by: ANA, id: "stop-1" }),
    { phase: "not_done", reason: "cancelled", message: "", endedBy: ANA, active: false, pending: null }],
  ["checking, waiting: Cancel with nothing running", taskIn("checking", { waiting: true }), event("cancel", { by: ANA, id: "stop-1" }),
    { phase: "not_done", reason: "cancelled", pending: null }],
  ["needs_you (ai_stuck): the outcome keeps the AI's reason", taskIn("needs_you", { reason: "ai_stuck", message: "It needs a key." }), event("cancel", { by: ANA }),
    { phase: "not_done", reason: "cancelled", message: "The AI could not fix this: It needs a key." }],
  ["needs_you (check_stuck): the outcome keeps the check's message", taskIn("needs_you", { reason: "check_stuck", message: "Conflicts remain." }), event("cancel", { by: ANA }),
    { phase: "not_done", reason: "cancelled", message: "Conflicts remain. You ended the fix." }],
  ["starting: Cancel with a turn running", taskIn("starting"), event("cancel", { by: ANA, id: "stop-1" }),
    { phase: "cancelling", cancelledBy: ANA, active: true, pending: { effect: "interrupt", id: "stop-1" } }],
  ["working: Cancel with a turn running", taskIn("working"), event("cancel", { by: ANA, id: "stop-1" }),
    { phase: "cancelling", cancelledBy: ANA, pending: { effect: "interrupt", id: "stop-1" } }],
  ["checking: Cancel keeps the running check", taskIn("checking"), event("cancel", { by: ANA, id: "stop-1" }),
    { phase: "cancelling", pending: { effect: "check", id: "check-1", reviewedConflictId: "", retryAi: true } }],
  ["cancelling: turn stopped", taskIn("cancelling", { cancelledBy: ANA, pending: { effect: "interrupt", id: "stop-1" } }), event("turn_stopped"),
    { phase: "not_done", reason: "cancelled", endedBy: ANA, active: false, pending: null }],
  ["cancelling: check failed", taskIn("cancelling", { pending: { effect: "check", id: "check-1", retryAi: true } }), checkFailure(),
    { phase: "not_done", reason: "cancelled", pending: null }],
  ["cancelling: check result unknown", taskIn("cancelling", { pending: { effect: "check", id: "check-1", retryAi: true } }), event("check_unknown", { id: "check-1", message: "?" }),
    { phase: "not_done", reason: "cancelled" }],
  ["cancelling: check passed anyway", taskIn("cancelling", { pending: { effect: "check", id: "check-1", retryAi: true } }), event("check_passed", { id: "check-1", message: "Updated." }),
    { phase: "done", message: "This finished before the cancel took effect.", active: false }],
  ["cancelling: nothing left after a restart", taskIn("cancelling"), event("cancel_settled"),
    { phase: "not_done", reason: "cancelled" }],
  ...["starting", "working", "checking", "needs_you", "cancelling"].map(phase => [
    `${phase}: session archived`, taskIn(phase), event("archived"),
    { phase: "not_done", reason: "archived", message: "The session was archived before this finished.", active: false, pending: null }
  ])
];

for (const [name, from, happened, expected] of ROWS) {
  test(`AI task machine: ${name}`, () => {
    const before = structuredClone(from);
    const { task, pending } = advanceAiTask(from, happened);
    for (const [field, value] of Object.entries(expected)) {
      assert.deepEqual(task[field], value, `${name}: ${field}`);
    }
    assert.deepEqual(pending, task.pending);
    assert.deepEqual(from, before, "the machine never changes the saved task");
  });
}

test("AI task machine: a new task owes its opening message and carries what terminals needs", () => {
  const task = taskIn("starting");
  assert.equal(task.phase, "starting");
  assert.equal(task.active, true);
  assert.equal(task.attempt, 1);
  assert.deepEqual(task.pending, send("send-1", {
    message: "Repair: Update found conflicts in 2 files.",
    display: "Fix this Update problem without losing work."
  }));
  assert.equal(task.turnMessageId, "send-1");
  assert.deepEqual(task.turn, {
    context: "Context: Update found conflicts in 2 files.",
    routing: "fix",
    structured: true,
    updateRepair: true
  });
  assert.deepEqual(task.check, {
    by: "vibe64",
    label: "Running Update…",
    retryLimit: 3,
    output: "Update output",
    unstoppable: "Update can't be interrupted.",
    whileAiWorks: null
  });
  assert.equal(task.revision, 0);
  assert.equal(taskIn("starting", {}, "person").turn.structured, false);
});

test("AI task machine: a failed check keeps what it learned for the next try", () => {
  const { task } = advanceAiTask(taskIn("checking"), checkFailure({ facts: { reviewId: "r2" } }));
  assert.equal(task.problem.facts.reviewId, "r2");
  assert.equal(task.problem.summary, "Update found conflicts in 2 files.");
});

test("AI task machine: a person's message while the AI works resets its tries and stays in working", () => {
  const { task } = advanceAiTask(taskIn("working", { attempt: 2, retryKeys: ["a"] }), event("person_message", { messageId: "m-2" }));
  assert.equal(task.phase, "working");
  assert.equal(task.attempt, 1);
  assert.deepEqual(task.retryKeys, []);
  assert.equal(task.turnMessageId, "m-2");
});

const PROGRESS = Object.freeze({
  step: "Publishing: Run database migrations",
  since: "2026-11-04T09:58:00.000Z",
  output: "Migrating\nMigrated 12 of 30 tables"
});
const progressed = (extra = {}) => event("check_progress", { id: "check-1", ...PROGRESS, ...extra });

test("AI task machine: a running check reports its step, since when and what it printed, and nothing else moves", () => {
  const from = taskIn("checking");
  const { task, pending } = advanceAiTask(from, progressed());
  assert.deepEqual(task.progress, PROGRESS);
  assert.equal(task.phase, "checking");
  assert.deepEqual(pending, from.pending, "the check it reports on keeps running");
  assert.equal(task.revision, from.revision + 1, "its viewers hear of it");
  assert.deepEqual(task.log, from.log, "a step is not an Activity entry");

  // A step reported without a start starts now, and keeps that start while it prints.
  const started = advanceAiTask(task, event("check_progress", { id: "check-1", step: "Publishing: Start", at: "2026-11-04T10:01:00.000Z" })).task;
  assert.deepEqual(started.progress, { step: "Publishing: Start", since: "2026-11-04T10:01:00.000Z", output: "" });
  const printed = advanceAiTask(started, event("check_progress", {
    id: "check-1", step: "Publishing: Start", output: "Listening on 3000", at: "2026-11-04T10:01:30.000Z"
  })).task;
  assert.deepEqual(printed.progress, { step: "Publishing: Start", since: "2026-11-04T10:01:00.000Z", output: "Listening on 3000" });
  const repeated = event("check_progress", { id: "check-1", step: "Publishing: Start", output: "Listening on 3000", at: "2026-11-04T10:01:40.000Z" });
  assert.equal(advanceAiTask(printed, repeated).task, printed, "the same report again changes nothing");
});

test("AI task machine: progress belongs to the check running now; a wait, its answer, Cancel or a new run clears it", () => {
  const reporting = advanceAiTask(taskIn("checking"), progressed()).task;
  for (const [name, happened] of [
    ["waiting", event("check_waiting", { id: "check-1", message: "Save waits." })],
    ["passed", event("check_passed", { id: "check-1" })],
    ["failed", checkFailure()],
    ["unknown", event("check_unknown", { id: "check-1", message: "No answer." })],
    ["cancel", event("cancel", { by: ANA, id: "stop-1" })],
    ["archived", event("archived")]
  ]) {
    assert.equal(advanceAiTask(reporting, happened).task.progress, null, name);
  }

  // A waiting check that reports a step is running again: the wait and its choices go.
  const waiting = advanceAiTask(reporting, event("check_waiting", {
    id: "check-1", message: "Save waits.", mainChatSince: "2026-11-04T09:30:00.000Z"
  })).task;
  const resumed = advanceAiTask(waiting, progressed()).task;
  assert.deepEqual({ waiting: resumed.waiting, message: resumed.message, mainChatSince: resumed.mainChatSince },
    { waiting: false, message: "", mainChatSince: "" });
  assert.deepEqual(resumed.progress, PROGRESS);

  // Save now starts a new run of the check, which has reported nothing yet.
  const now = advanceAiTask({ ...reporting, waiting: true, check: { ...reporting.check, whileAiWorks: { action: "Save now", note: "n" } } },
    event("check_now", { id: "check-2", whileAiWorks: true })).task;
  assert.equal(now.pending.id, "check-2");
  assert.equal(now.progress, null);
});

test("AI task machine: Done and Not done are final", () => {
  for (const phase of ["done", "not_done"]) {
    const ended = taskIn(phase, { active: false });
    for (const type of ["turn_admitted", "turn_result", "person_message", "continue", "check_now", "finish", "cancel", "archived", "cancel_settled"]) {
      assert.equal(advanceAiTask(ended, event(type, { id: "x", kind: "complete" })).task, ended, `${phase} ignores ${type}`);
    }
  }
});

test("AI task machine: an event that does not apply leaves the task as it is", () => {
  const cases = [
    [taskIn("working"), event("check_passed", { id: "check-1" })],
    [taskIn("starting"), event("turn_result", { kind: "complete" })],
    [taskIn("checking"), event("check_passed", { id: "another-check" })],
    [taskIn("checking"), event("person_message", { messageId: "m" })],
    [taskIn("needs_you", { reason: "stopped" }), event("finish")],
    [taskIn("needs_you", { reason: "stopped" }, "person"), event("check_now", { id: "c" })],
    [taskIn("cancelling"), event("check_passed", { id: "another-check" })],
    [taskIn("cancelling", { pending: { effect: "interrupt", id: "stop-1" } }), event("cancel", { id: "stop-2" })],
    // Progress only ever describes the check running now.
    [taskIn("checking"), progressed({ id: "another-check" })],
    [taskIn("working"), progressed()],
    [taskIn("cancelling", { pending: { effect: "check", id: "check-1", retryAi: true } }), progressed()]
  ];
  for (const [task, happened] of cases) assert.equal(advanceAiTask(task, happened).task, task, happened.type);
});

test("AI task machine: the log keeps the last 50 entries", () => {
  let task = taskIn("needs_you", { reason: "stopped" });
  for (let i = 0; i < 60; i += 1) {
    task = advanceAiTask(task, event("continue", { id: `send-${i}` })).task;
    task = advanceAiTask(task, event("turn_stopped")).task;
  }
  assert.equal(task.log.length, 50);
  assert.equal(task.log.at(-1).text, "The turn was stopped.");
});

test("A copied session's running task waits for a person, and an idle one stays as it is", () => {
  const running = { conversationId: "c", status: "inProgress", task: taskIn("checking") };
  const { task } = prepareCopiedSessionConversation(running);
  assert.equal(task.phase, "needs_you");
  assert.equal(task.reason, "interrupted");
  assert.equal(task.active, false);
  assert.equal(task.pending, null);
  const waiting = taskIn("needs_you", { reason: "question", active: false });
  assert.deepEqual(prepareCopiedSessionConversation({ conversationId: "c", task: waiting }).task, waiting);
});
