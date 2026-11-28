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
  assert.deepEqual(workPlanStep(plan(["- [x] One thread per contact"], passes)),
    { step: "pass", item: 2, items: 3, title: "Security pass", scope: "the plan's changes" });
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
  assert.equal(workPlanStatusLine({ step: "review" }, { request: { status: "working", stage: "review" } }), "Plan: Senior review");
  // Every item built and nothing running its review (a Junior chat's plan, say): it waits for the person to ask Senior.
  for (const request of [{ status: "complete", stage: "review" }, { status: "complete", stage: "implementation", mode: "junior" }, null]) {
    assert.equal(workPlanStatusLine({ step: "review" }, { request }), "Plan: ready for Senior review, ask Senior to start it", JSON.stringify(request));
  }
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [x] One thread per contact"], passes))), "Plan: pass Security (2 of 3)");
  assert.equal(workPlanStatusLine({ step: "pass", item: 1, items: 1, title: "Visual identity" }), "Plan: pass Visual identity (1 of 1)");
  // Questions the chat shows, or a request waiting for the answer, need the person, whatever else waits.
  assert.equal(workPlanStatusLine(implementing, { questions: 2 }), "Plan: needs you (2 questions)");
  assert.equal(workPlanStatusLine(implementing, { questions: 1, request: waiting({ stopped: true }) }), "Plan: needs you (1 question)");
  assert.equal(workPlanStatusLine({ step: "pass", item: 2, items: 3, title: "Security pass" },
    { request: waiting({ stage: "pass", awaitingAnswer: true }) }), "Plan: needs you");
  // A plan Senior planned waits for Implement plan; anything else waiting is paused, named by the action the chat offers.
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [ ] One thread per contact"])),
    { request: waiting({ stage: "planning" }), action: action("Implement plan") }), "Plan: ready, Implement plan to start");
  assert.equal(workPlanStatusLine(implementing, { request: waiting({ stage: "planning", resumeImplementation: true }),
    action: action("Continue planning") }), "Paused: changing the plan. Continue planning to resume");
  assert.equal(workPlanStatusLine(implementing, { request: waiting({ stopped: true }), action: action("Continue implementation") }),
    "Paused: item 2 of 3, Replies join their thread. Continue implementation to resume");
  assert.equal(workPlanStatusLine({ step: "completed" }, { request: waiting({}) }), "Plan: completed");
  assert.equal(workPlanStatusLine(null, { questions: 2 }), "");
});

test("a plan whose next step another turn came before says it starts by itself when that answer ends, not that it is paused", () => {
  const owed = (stage, fields = {}) => ({ status: "waiting", stage, delivery: "pending", followup: { messageId: "followup", owed: true }, ...fields });
  const continueAction = (label) => action(label, { enabled: false, waits: "available when this answer ends" });
  assert.equal(workPlanStatusLine({ step: "review" }, { request: owed("review"), action: continueAction("Continue review") }),
    "Plan: Senior review starts when this answer ends");
  assert.equal(workPlanStatusLine(workPlanStep(plan(work, passes)), { request: owed("implementation"), action: continueAction("Continue implementation") }),
    "Plan: item 2 of 3, Replies join their thread, starts when this answer ends");
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [x] One thread per contact"], passes)), { request: owed("pass") }),
    "Plan: pass Security (2 of 3) starts when this answer ends");
  // Stopped, it is the person's: paused, named by its button.
  assert.equal(workPlanStatusLine({ step: "review" }, { request: owed("review", { stopped: true }), action: action("Continue review") }),
    "Paused: Senior review. Continue review to resume");
});

// The routing notice's action as assistantRoutingNotice gives it.
function action(label, fields = {}) {
  const kind = { "Implement plan": "implement", "Check delivery": "check" }[label] || "continue";
  return { kind, label, enabled: true, waits: "", progress: "", ...fields };
}

test("a paused plan's line never tells the person to press an action they can't press, and names it as its button does", () => {
  const implementing = workPlanStep(plan(work, passes));
  const paused = { status: "waiting", stage: "implementation", delivery: "pending", followup: { messageId: "followup" } };
  // Seen on 25 Nov 2026: the plan's implementation paused while the assistant answered a question; the line said
  // "Plan: paused, Continue to resume" above a greyed-out Continue implementation.
  assert.equal(workPlanStatusLine(implementing, { request: paused, busy: "turn",
    action: action("Continue implementation", { enabled: false, waits: "available when this answer ends" }) }),
  "Paused: item 2 of 3, Replies join their thread. Your request is running now. Continue implementation is available when this answer ends");
  assert.equal(workPlanStatusLine(implementing, { request: paused, busy: "message",
    action: action("Continue implementation", { enabled: false, waits: "available once your message is sent" }) }),
  "Paused: item 2 of 3, Replies join their thread. Continue implementation is available once your message is sent");
  // Pressable, the line names the button exactly; pressed, it says the button's own progress.
  assert.equal(workPlanStatusLine(implementing, { request: paused, action: action("Continue implementation") }),
    "Paused: item 2 of 3, Replies join their thread. Continue implementation to resume");
  assert.equal(workPlanStatusLine(implementing, { request: paused, action: action("Continue implementation", { enabled: false, progress: "Continuing…" }) }),
    "Paused: item 2 of 3, Replies join their thread. Continuing…");
  assert.equal(workPlanStatusLine({ step: "pass", item: 2, items: 3, title: "Security pass", scope: "the plan's changes" },
    { request: { ...paused, stage: "pass" }, action: action("Continue the passes") }),
  "Paused: Security pass (the plan's changes). Continue the passes to resume");
  assert.equal(workPlanStatusLine(implementing, { request: { ...paused, delivery: "uncertain" }, action: action("Check delivery") }),
    "Paused: item 2 of 3, Replies join their thread. Check delivery to resume");
  // A plan waiting for Implement plan says so the same way while a turn holds it.
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [ ] One thread per contact"])), { request: { ...paused, stage: "planning" },
    action: action("Implement plan", { enabled: false, waits: "available when this answer ends" }) }),
  "Plan: ready · Implement plan is available when this answer ends");
  // With no action on offer (a stopped request with nothing to resume, say), a message moves the plan on.
  assert.equal(workPlanStatusLine(implementing, { request: { ...paused, stopped: true, followup: null } }),
    "Paused: item 2 of 3, Replies join their thread. Send a message to go on");
  assert.equal(workPlanStatusLine(workPlanStep(plan(["- [ ] One thread per contact"])), { request: { ...paused, stage: "planning" } }),
    "Paused: changing the plan. Send a message to go on");
  // Behind its work, the count follows.
  assert.equal(workPlanStatusLine(implementing, { request: paused, busy: "turn", freshness: { behind: true, changed: "2 files changed since" },
    action: action("Continue implementation", { enabled: false, waits: "available when this answer ends" }) }),
  "Paused: item 2 of 3, Replies join their thread. Your request is running now. Continue implementation is available when this answer ends · " +
    "2 files changed since the plan's last update");
});

test("only the person's Stop pauses a plan: one that waits for Continue otherwise says Waiting, and never says whose turn runs", () => {
  // Seen on 28 Nov 2026 in a Senior chat: "Paused: item 6 of 14, … on the test machine.. Your request is running now.
  // Continue implementation is available when this answer ends" while the assistant's turn was still open, waiting on
  // its background commands, and nobody had stopped the plan. The request waited for Continue (not stopped, its reason
  // in the notice's Details); a message the person sends replaces a waiting request or joins the running turn, so the
  // turn running beside it was never a request of theirs.
  const title = "Referee green; statement sizes and memory measured before and after; browser part timed once on the test machine.";
  const step = { step: "implementation", item: 6, items: 14, title };
  const named = "item 6 of 14, Referee green; statement sizes and memory measured before and after; browser part timed once on the test machine";
  const waiting = { status: "waiting", stage: "implementation", delivery: "pending", followup: { messageId: "followup" },
    error: "The turn ended without a confirmed workflow outcome. Resume the retained stage to finish it." };
  const held = action("Continue implementation", { enabled: false, waits: "available when this answer ends" });
  assert.equal(workPlanStatusLine(step, { request: waiting, busy: "turn", action: held }),
    `Waiting: ${named}. Continue implementation is available when this answer ends`);
  assert.equal(workPlanStatusLine(step, { request: waiting, action: action("Continue implementation") }),
    `Waiting: ${named}. Continue implementation to resume`);
  // The person's Stop pauses it, whatever is still ending.
  assert.equal(workPlanStatusLine(step, { request: { ...waiting, stopped: true }, busy: "turn", action: held }),
    `Paused: ${named}. Continue implementation is available when this answer ends`);
  assert.equal(workPlanStatusLine(step, { request: { ...waiting, stopped: true, followup: null } }), `Paused: ${named}. Send a message to go on`);
});

test("a title its author ended with a full stop keeps one stop in every line that goes on after it", () => {
  const item = { step: "implementation", item: 2, items: 3, title: "Replies join their thread. " };
  const owed = { status: "waiting", stage: "implementation", delivery: "pending", followup: { messageId: "followup", owed: true } };
  assert.equal(workPlanStatusLine(item), "Plan: implementing item 2 of 3, Replies join their thread");
  assert.equal(workPlanStatusLine(item, { freshness: { behind: true, changed: "2 files changed since" } }),
    "Plan: implementing item 2 of 3, Replies join their thread · 2 files changed since the plan's last update");
  assert.equal(workPlanStatusLine(item, { request: owed }), "Plan: item 2 of 3, Replies join their thread, starts when this answer ends");
  const stopped = { status: "waiting", stage: "pass", delivery: "pending", followup: { messageId: "followup" }, stopped: true };
  const pass = { step: "pass", item: 2, items: 3, title: "Security pass.", scope: "the billing screens." };
  assert.equal(workPlanStatusLine(pass), "Plan: pass Security (2 of 3)");
  assert.equal(workPlanStatusLine(pass, { request: { ...owed, stage: "pass" } }), "Plan: pass Security (2 of 3) starts when this answer ends");
  assert.equal(workPlanStatusLine(pass, { request: stopped, action: action("Continue the passes") }),
    "Paused: Security pass (the billing screens). Continue the passes to resume");
  assert.equal(workPlanStatusLine({ ...pass, title: "Deslop.", scope: "" }, { request: stopped, action: action("Continue the passes") }),
    "Paused: Deslop. Continue the passes to resume");
  // A title that ends with its own question or exclamation mark is a sentence already.
  assert.equal(workPlanStatusLine({ ...item, title: "Why does sign-in fail?" }, { request: { ...owed, followup: { messageId: "followup" } },
    action: action("Continue implementation") }), "Waiting: item 2 of 3, Why does sign-in fail? Continue implementation to resume");
});

test("a paused plan names what is paused: the pass and its scope, while the person's own request runs", () => {
  // Seen on 26 Nov 2026: "Plan: paused" while the person's request ran, with nothing saying it was the UI pass over
  // the whole app that waited.
  const ui = workPlanStep(plan(["- [x] One thread per contact"], ["- [ ] UI pass: whole app", "- [ ] Deslop: whole app"]));
  assert.deepEqual(ui, { step: "pass", item: 1, items: 2, title: "UI pass", scope: "whole app" });
  const paused = { status: "waiting", stage: "pass", delivery: "pending", followup: { messageId: "followup" } };
  const held = action("Continue the passes", { enabled: false, waits: "available when this answer ends" });
  assert.equal(workPlanStatusLine(ui, { request: paused, busy: "turn", action: held }),
    "Paused: UI pass (whole app). Your request is running now. Continue the passes is available when this answer ends");
  assert.equal(workPlanStatusLine(ui, { request: paused, action: action("Continue the passes") }),
    "Paused: UI pass (whole app). Continue the passes to resume");
  // A section pass names its section; a pass item with no scope, its title alone.
  const section = workPlanStep(plan(["- [x] One thread per contact"], ["- [ ] Security pass: this section of the app: Billing"]));
  assert.equal(workPlanStatusLine(section, { request: paused, busy: "turn", action: held }),
    "Paused: Security pass (this section of the app: Billing). Your request is running now. " +
    "Continue the passes is available when this answer ends");
  assert.equal(workPlanStatusLine({ step: "pass", item: 1, items: 1, title: "Visual identity", scope: "" },
    { request: paused, action: action("Continue the passes") }), "Paused: Visual identity. Continue the passes to resume");
  // The person's message being sent is not a running request; the button's own reason says when it can be pressed.
  assert.equal(workPlanStatusLine(ui, { request: paused, busy: "message",
    action: action("Continue the passes", { enabled: false, waits: "available once your message is sent" }) }),
  "Paused: UI pass (whole app). Continue the passes is available once your message is sent");
  // A plan that is not paused keeps its own line.
  assert.equal(workPlanStatusLine(ui, { request: { status: "working", stage: "pass" }, busy: "turn" }), "Plan: pass UI (1 of 2)");
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
