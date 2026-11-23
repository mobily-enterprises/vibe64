import assert from "node:assert/strict";
import test from "node:test";
import { workPlanStatusLine, workPlanStep } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

const plan = (items, passes = [], status = "active") => ({
  status,
  text: `# Contact threads\nStatus: ${status}\n\n${items.join("\n")}\n\n## Technical details\nGroup by contact.\n` +
    (passes.length ? `\n## Passes\n\n${passes.join("\n")}\n` : "")
});
const work = ["- [x] One thread per contact", "- [ ] Replies join their thread", "- [ ] Old messages move over"];
const passes = ["- [x] Review: the plan's changes", "- [ ] Security pass: the plan's changes", "- [ ] Deslop: the plan's changes"];

test("a plan's step is read from the plan: its first item not built, Senior's review, its next pass, or completed", () => {
  assert.deepEqual(workPlanStep(plan(work, passes)), { step: "implementation", item: 2, items: 3, title: "Replies join their thread" });
  // A half-ticked item is built: implementation moves to the next one.
  assert.deepEqual(workPlanStep(plan(["- [x] One thread per contact", "- [~] Replies join their thread", "- [ ] Old messages move over"])),
    { step: "implementation", item: 3, items: 3, title: "Old messages move over" });
  // Every item built, not all proven: Senior's review; so too a plan whose items are all proven and has no passes.
  assert.deepEqual(workPlanStep(plan(["- [~] One thread per contact", "- [x] Replies join their thread"], passes)), { step: "review" });
  assert.deepEqual(workPlanStep(plan(["- [x] One thread per contact"])), { step: "review" });
  // A ticked pass item before its plan is proven does not move the plan on.
  assert.deepEqual(workPlanStep(plan(["- [x] One thread per contact"], passes)), { step: "pass", item: 2, items: 3, title: "Security pass" });
  assert.deepEqual(workPlanStep(plan(["- [x] One thread per contact"], passes, "completed")), { step: "completed" });
  // A fenced example is not an item, and a plan without items has no step.
  assert.deepEqual(workPlanStep(plan(["```md", "- [ ] literal example", "```", "- [x] One thread per contact"])), { step: "review" });
  assert.equal(workPlanStep(plan(["No checklist yet."])), null);
  assert.equal(workPlanStep(null), null);
});

test("the chat's status line says where the plan is, or that it needs the person, waits to start or is paused", () => {
  const implementing = workPlanStep(plan(work, passes));
  const working = { status: "working", stage: "implementation" };
  const waiting = (fields) => ({ status: "waiting", stage: "implementation", ...fields });
  assert.equal(workPlanStatusLine(implementing), "Plan: implementing item 2 of 3, Replies join their thread");
  assert.equal(workPlanStatusLine(implementing, { request: working }), "Plan: implementing item 2 of 3, Replies join their thread");
  assert.equal(workPlanStatusLine({ step: "review" }, { request: { status: "complete", stage: "review" } }), "Plan: Senior review");
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [x] One thread per contact"], passes))), "Plan: pass Security (2 of 3)");
  assert.equal(workPlanStatusLine({ step: "pass", item: 1, items: 1, title: "Visual identity" }), "Plan: pass Visual identity (1 of 1)");
  // Questions the chat shows, or a request waiting for the answer, need the person, whatever else waits.
  assert.equal(workPlanStatusLine(implementing, { questions: 2 }), "Plan: needs you (2 questions)");
  assert.equal(workPlanStatusLine(implementing, { questions: 1, request: waiting({ stopped: true }) }), "Plan: needs you (1 question)");
  assert.equal(workPlanStatusLine({ step: "pass", item: 2, items: 3, title: "Security pass" },
    { request: waiting({ stage: "pass", awaitingAnswer: true }) }), "Plan: needs you");
  // A plan Senior planned waits for Implement plan; anything else waiting is paused until Continue.
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [ ] One thread per contact"])), { request: waiting({ stage: "planning" }) }),
    "Plan: ready, Implement plan to start");
  assert.equal(workPlanStatusLine(implementing, { request: waiting({ stage: "planning", resumeImplementation: true }) }),
    "Plan: paused, Continue to resume");
  assert.equal(workPlanStatusLine(implementing, { request: waiting({ stopped: true }) }), "Plan: paused, Continue to resume");
  assert.equal(workPlanStatusLine({ step: "completed" }, { request: waiting({}) }), "Plan: completed");
  assert.equal(workPlanStatusLine(null, { questions: 2 }), "");
});
