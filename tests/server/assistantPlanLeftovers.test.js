import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { manageWorkPlan, readWorkPlan, readWorkPlanPage } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { workPlanInstructions } from "../../packages/vibe64-terminals/src/server/assistantWorkPlanInstructions.js";
import { ASSISTANT_PLAN_COMPLETION_MESSAGE, assistantPassInstructions } from "@local/vibe64-runtime/shared/assistantFinishing";
import { assistantModePrompt } from "@local/vibe64-runtime/shared/assistantRouting";

// Live, 12 Nov: a plan ended with Leftovers the session could have fixed (its own development data, a dark-mode
// focus ring, two flaky tests, a compose that fails while Preview runs), then asked "Make a plan for these?".
const PLAN = "# Contact moves\n\n- [x] Move the contact\n- [x] Prove the move\n";
const LIVE_LEFTOVERS = "# Progress\n\nThe move is proven.\n\n## Leftovers\n\n" +
  "- Tidy the two development contacts this plan created.\n" +
  "- The dark-mode focus ring is barely visible.\n" +
  "- tests/e2e/contacts.spec.ts fails now and then on a busy machine\n" +
  "  (passes 2 runs in 3).\n" +
  "- The compose step fails while Preview runs.\n";
const PERSON_ONLY = "# Progress\n\nThe browser tests failed once, then the timing fix made them pass every run.\n\n" +
  "## Leftovers\n\n- Try the move on a real phone: needs your device.\n- Turn on the live payment key: only you hold it.\n" +
  "  ```text\n  the flaky test that fails 1 run in 3, quoted from the old log\n  ```\n\n## Checks\n\n- The suite failed twice before the fix.\n";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plan-leftovers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "leftovers-session";
  const context = { session: { sessionId }, runtime: { store: {
    paths: () => ({ sessionRoot: path.join(root, sessionId), conversationsRoot: path.join(root, sessionId, "conversations") })
  } } };
  await manageWorkPlan(context, { operation: "new", text: PLAN }, "senior");
  // The agent's plan command, from a read of the whole pair.
  const agent = async (operation, role, extra = {}) => {
    const page = await readWorkPlanPage(context);
    assert.equal(page.hasMore, false);
    return manageWorkPlan(context, { operation, expectedRevision: page.revision, expectedProgressRevision: page.progressRevision,
      ...(["write", "progress-write"].includes(operation) ? { readThrough: page.readThrough } : {}), ...extra }, role, { agent: true });
  };
  return { context, agent };
}

test("a failing or flaky test on the Leftovers list is refused, naming the fix, and a plan does not complete with one", async (t) => {
  const f = await fixture(t);
  const refused = { code: "vibe64_work_plan_leftover_fixable",
    message: /^Progress's Leftovers hold a failing or flaky test: “tests\/e2e\/contacts\.spec\.ts fails now and then on a busy machine \(passes 2 runs in 3\)\.”\. A failing or flaky test is a defect to fix in this session until it passes every run, never a Leftover; .*Fix it, then write Progress without it\. Nothing changed\.$/u };
  for (const role of ["junior", "pass", "review"]) {
    await assert.rejects(f.agent("progress-write", role, { progressText: LIVE_LEFTOVERS }), refused, `${role} records the live Leftovers`);
  }
  // The other spellings of the list: a Leftovers: line, bold, a numbered item.
  for (const leftovers of ["**Leftovers:**\n1. The checkout spec is flaky.\n", "Leftovers: the login test failed twice.\n",
    "### Leftovers (need you)\nThe admin suite fails intermittently.\n"]) {
    await assert.rejects(f.agent("progress-write", "junior", { progressText: `# Progress\n\n${leftovers}` }), { code: "vibe64_work_plan_leftover_fixable" }, leftovers);
  }
  assert.equal((await readWorkPlan(f.context)).progressText, "# Progress\n\n", "nothing was written");

  // What needs the person stays; a test outside the list, or quoted in code, is not a Leftover.
  await f.agent("progress-write", "junior", { progressText: PERSON_ONLY });
  assert.equal((await readWorkPlan(f.context)).progressText, PERSON_ONLY);

  // Progress written another way (before this check) still holds a plan from completing until the test is fixed.
  const current = await readWorkPlan(f.context);
  await manageWorkPlan(f.context, { operation: "progress-write", progressText: LIVE_LEFTOVERS, expectedRevision: current.revision,
    expectedProgressRevision: current.progressRevision }, "senior");
  await assert.rejects(f.agent("complete", "senior"), { code: "vibe64_work_plan_leftover_fixable" });
  assert.equal((await readWorkPlan(f.context)).status, "active");
  await f.agent("progress-write", "senior", { progressText: LIVE_LEFTOVERS.replace(/- tests\/e2e[\s\S]*?3\)\.\n/u, "") });
  assert.equal((await f.agent("complete", "senior")).status, "completed");
});

test("every role and step is told to fix what the session can and to leave only what needs the person, never offering a plan", () => {
  const rule = [/A failing or flaky test is a defect to fix until it passes every run, never a Leftover\./u,
    /The plan's one Leftovers list in Progress holds only what needs the person \(a choice, a real device, an account, a click\) or what this session can't reach/u,
    /a choice becomes a numbered question with a recommended answer\. Never offer to make a plan for what is left\./u];
  const pass = { title: "Security pass", item: "Security pass: the plan's changes" };
  const last = assistantPassInstructions(pass, { last: true });
  for (const [name, text] of Object.entries({ junior: workPlanInstructions("junior"), senior: workPlanInstructions("senior"),
    review: ASSISTANT_PLAN_COMPLETION_MESSAGE, pass: assistantPassInstructions(pass), last })) {
    for (const expected of rule) assert.match(text, expected, name);
    assert.doesNotMatch(text, /Make a plan for these/u, name);
  }
  // The plan's last step is its finishing step, whether the last pass or a review without passes.
  for (const text of [last, ASSISTANT_PLAN_COMPLETION_MESSAGE]) {
    assert.match(text, /Before it ends Done, fix whatever Progress still holds that this session can fix: the plan's last step is its finishing step/u);
    assert.match(text, /the Leftovers from Progress, each with its reason\. It asks no question about them/u);
  }
  // The pass requests a plan runs send what is outside their scope to be fixed, not to the Leftovers list.
  for (const mode of ["deslop", "ui_pass", "pass"]) {
    assert.match(assistantModePrompt(mode, "Run it."),
      /when a plan runs this pass, also fix what is outside the scope when this session can, and put only what needs the person or what this session can't reach on the plan's Leftovers list/u, mode);
  }
});
