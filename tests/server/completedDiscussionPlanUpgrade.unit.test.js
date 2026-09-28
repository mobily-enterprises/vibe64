import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { completeDiscussionPlan } from "../../packages/vibe64-accounts/src/server/completedDiscussionPlanUpgrade.js";

const digest = text => createHash("sha256").update(text).digest("hex");
const plan = "Status: drafting\n# Approved work\n\nImplementation evidence stays verbatim.\n";
const expected = { messageId: "discussion-1", revision: digest(plan) };
const request = () => ({ mode: "auto", reason: "discussion", status: "done", messageId: expected.messageId,
  submittedBy: { username: "owner" }, workPlan: { text: plan, status: "drafting", revision: expected.revision } });

test("restores only completion and matching revision, preserving the plan, actor and discussion", () => {
  const original = request();
  const repaired = completeDiscussionPlan(plan, original, expected);
  assert.equal(repaired.plan, plan.replace("Status: drafting", "Status: implemented"));
  assert.deepEqual(repaired.request, { ...original, workPlan: {
    ...original.workPlan, status: "implemented", text: repaired.plan, revision: digest(repaired.plan)
  } });
  assert.deepEqual(original, request());
  assert.equal(completeDiscussionPlan(repaired.plan, repaired.request, expected), null);
});

test("does not touch newer plans or later requests, including genuine planning", () => {
  assert.equal(completeDiscussionPlan(`${plan}A new decision.\n`, request(), expected), null);
  assert.equal(completeDiscussionPlan(plan, { ...request(), messageId: "later-request" }, expected), null);
});

test("refuses conflicting snapshots and unfinished requests for an identified incident", () => {
  for (const changed of [
    { ...request(), status: "sent" }, { ...request(), reason: "planning" },
    { ...request(), workPlan: { ...request().workPlan, text: "different" } },
    { ...request(), workPlan: { ...request().workPlan, revision: "wrong" } },
    { ...request(), workPlan: { ...request().workPlan, status: "ready" } }
  ]) assert.throws(() => completeDiscussionPlan(plan, changed, expected), /conflicting state/);
});
