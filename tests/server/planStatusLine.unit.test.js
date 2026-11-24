import assert from "node:assert/strict";
import test from "node:test";
import { workPlanFreshness, workPlanStatusLine, workPlanStep } from "../../packages/vibe64-terminals/src/shared/assistantWorkPlan.js";

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

test("a plan behind its work never looks current: it says when it was last updated and how many files changed since", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
  const current = (fields) => ({ status: "active", updatedAt: ago(47), updatedHow: "updated", ...fields });
  // Facts only: when, and how many files changed since.
  assert.deepEqual(workPlanFreshness(current({ changedSince: { files: 12, more: false } }), now),
    { text: "Updated 47 min ago · 12 files changed since", updated: "Updated 47 min ago", changed: "12 files changed since", behind: true });
  assert.equal(workPlanFreshness(current({ changedSince: { files: 1, more: false } }), now).text, "Updated 47 min ago · 1 file changed since");
  assert.equal(workPlanFreshness(current({ changedSince: { files: 1000, more: true } }), now).text, "Updated 47 min ago · 1000+ files changed since");
  // Checked and found nothing to change counts as up to date, from when it was checked.
  assert.deepEqual(workPlanFreshness(current({ updatedAt: ago(0.5), updatedHow: "checked", changedSince: { files: 0, more: false } }), now),
    { text: "Checked just now · no files changed since", updated: "Checked just now", changed: "no files changed since", behind: false });
  // A plan the AI never brought up to date (no mark): only when it was saved, no count.
  assert.equal(workPlanFreshness(current({ updatedAt: ago(180), updatedHow: "saved", changedSince: null }), now).text, "Updated 3 h ago");
  assert.equal(workPlanFreshness(current({ updatedAt: ago(60 * 49) }), now).text, "Updated 2 days ago");
  assert.equal(workPlanFreshness(current({ status: "completed" }), now), null);
  assert.equal(workPlanFreshness(null, now), null);
  // The status line, which the person reads first, adds the facts while files changed since; a current plan's line is unchanged.
  const implementing = { step: "implementation", item: 1, items: 10, title: "Store threads" };
  assert.equal(workPlanStatusLine(implementing, { freshness: workPlanFreshness(current({ changedSince: { files: 12, more: false } }), now) }),
    "Plan: implementing item 1 of 10, Store threads · 12 files changed since the plan's last update");
  assert.equal(workPlanStatusLine(implementing, { freshness: workPlanFreshness(current({ changedSince: { files: 0, more: false } }), now) }),
    "Plan: implementing item 1 of 10, Store threads");
  assert.equal(workPlanStatusLine({ step: "completed" }, { freshness: workPlanFreshness(current({ changedSince: { files: 3 } }), now) }),
    "Plan: completed");
});
