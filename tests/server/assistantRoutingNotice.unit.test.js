import assert from "node:assert/strict";
import test from "node:test";
import { assistantRoutingNotice } from "../../packages/vibe64-runtime/src/shared/assistantRouting.js";
import { workPlanStatusLine } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

const request = (stage, delivery, fields = {}) => ({ messageId: "workflow", status: "waiting", stage, workflow: true, delivery,
  resolvedMode: "senior", followup: { messageId: "followup" }, assignments: {}, ...fields });
const plannedPlan = { status: "active", revision: "saved-plan" };
const implementing = { step: "implementation", item: 2, items: 3, title: "Replies join their thread" };

test("the notice's one workflow action is named by stage, and only Check delivery works while other work holds the chat", () => {
  for (const [stage, label] of Object.entries({ planning: "Continue planning", implementation: "Continue implementation",
    review: "Continue review", pass: "Continue the passes" })) {
    assert.deepEqual(assistantRoutingNotice(request(stage, "pending")).action,
      { kind: "continue", label, enabled: true, waits: "", progress: "" });
  }
  const held = (busy) => assistantRoutingNotice(request("implementation", "pending"), { busy }).action;
  assert.deepEqual(held("turn"), { kind: "continue", label: "Continue implementation", enabled: false,
    waits: "available when this answer ends", progress: "" });
  assert.equal(held("message").waits, "available once your message is sent");
  assert.equal(held("voice").waits, "available once your spoken message is sent");
  assert.deepEqual(assistantRoutingNotice(request("implementation", "uncertain"), { busy: "turn" }).action,
    { kind: "check", label: "Check delivery", enabled: true, waits: "", progress: "" });
  const planning = request("planning", "pending", { workPlan: plannedPlan });
  assert.deepEqual(assistantRoutingNotice(planning, { mode: "auto", busy: "turn" }).action,
    { kind: "implement", label: "Implement plan", enabled: false, waits: "available when this answer ends", progress: "" });
  assert.equal(assistantRoutingNotice(planning, { mode: "senior" }).action.label, "Continue planning");
  // A pressed action shows its own progress, not a wait.
  assert.deepEqual(assistantRoutingNotice(request("implementation", "pending"), { busy: "turn", pendingAction: "continue" }).action,
    { kind: "continue", label: "Continue implementation", enabled: false, waits: "", progress: "Continuing…" });
  assert.equal(assistantRoutingNotice(planning, { mode: "auto", pendingAction: "implement" }).action.progress, "Starting…");
  assert.equal(assistantRoutingNotice(request("review", "uncertain"), { pendingAction: "continue" }).action.progress, "Checking…");
  // Stop shows for a follow-up not yet sent; nothing shows for an unsent first message, whose bubble has its controls.
  assert.equal(assistantRoutingNotice(request("implementation", "pending")).stop, true);
  assert.equal(assistantRoutingNotice(request("implementation", "uncertain")).stop, false);
  assert.equal(assistantRoutingNotice(request(null, "failed", { followup: null, workflow: false, error: "Reconnect the AI" })).shown, false);
  assert.equal(assistantRoutingNotice(null).shown, false);
});

test("every waiting state's plan line agrees with the notice: the same label, an instruction only when it can be pressed", () => {
  const states = [
    request("implementation", "pending"),
    request("implementation", "pending", { stopped: true }),
    request("implementation", "accepted", { stopped: true, followup: null, error: "Paused at your request." }),
    request("review", "pending"),
    request("pass", "accepted", { followup: null, pass: { title: "Security pass", item: "- [ ] Security pass" },
      error: "Security pass can't run: Genesis is too old." }),
    request("implementation", "uncertain"),
    request("planning", "pending", { workPlan: plannedPlan }),
    request("planning", "pending", { workPlan: plannedPlan, resumeImplementation: true }),
    request("planning", "pending"),
    request(null, "accepted", { workflow: false, followup: null, error: "The implementation turn interrupted. Resume when ready." }),
    request("implementation", "pending", { stopped: true, followup: null }),
    request(null, "failed", { workflow: false, followup: null, error: "Reconnect the AI" })
  ];
  for (const state of states) {
    for (const busy of ["", "turn", "message", "voice"]) {
      for (const pendingAction of ["", "continue"]) {
        for (const mode of ["auto", "senior"]) {
          const notice = assistantRoutingNotice(state, { mode, busy, pendingAction });
          const line = workPlanStatusLine(implementing, { request: state, action: notice.action });
          const where = JSON.stringify({ state, busy, pendingAction, mode, line });
          assert.match(line, /^Plan: (paused|ready)/u, where);
          assert.doesNotMatch(line, /Continue to resume/u, where);
          if (!notice.action) {
            assert.equal(line, "Plan: paused, send a message to go on", where);
            continue;
          }
          // The line's instruction is the button's exact label, and only while the button can be pressed.
          assert.ok(line.includes(notice.action.label) || line.includes(notice.action.progress), where);
          assert.equal(/ to (resume|start)$/u.test(line), notice.action.enabled, where);
          if (!notice.action.enabled) assert.ok(notice.action.waits || notice.action.progress, where);
        }
      }
    }
  }
});
