import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { manageWorkPlan, readWorkPlan, readWorkPlanPage } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";

// A read returns Plan and Progress in pages. An agent that rewrote Progress from the first page alone cut the tail
// of its Review section, and nothing refused it: the revisions it sent were current.
const PLAN = "# Contact moves\n\n- [~] Move the contact\n- [ ] Prove the move\n";
const REVIEW = "# Progress\n\n## Review\n" + "- A review finding a later pass must keep.\n".repeat(600) + "Review tail: the last finding.\n";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-plan-read-through-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sessionId = "read-through-session";
  const context = { session: { sessionId }, runtime: { store: {
    paths: () => ({ sessionRoot: path.join(root, sessionId), conversationsRoot: path.join(root, sessionId, "conversations") })
  } } };
  // The agent's plan command: its whole-document writes need the read's readThrough.
  const agent = (input) => manageWorkPlan(context, input, "junior", { agent: true });
  const readAll = async () => {
    let page = await readWorkPlanPage(context);
    const paired = { expectedRevision: page.revision, expectedProgressRevision: page.progressRevision };
    let [text, progressText] = [page.text, page.progressText];
    while (page.hasMore) {
      page = await readWorkPlanPage(context, { offset: page.nextOffset, ...paired });
      text += page.text; progressText += page.progressText;
    }
    return { pair: { ...paired, readThrough: page.readThrough }, text, progressText };
  };
  return { context, agent, readAll };
}

test("a whole Plan or Progress written from a read's first page alone is refused, naming the fix, and nothing is cut", async (t) => {
  const f = await fixture(t);
  await manageWorkPlan(f.context, { operation: "new", text: PLAN }, "senior");
  const empty = await f.readAll();
  await f.agent({ operation: "progress-write", progressText: REVIEW, ...empty.pair });
  const first = await readWorkPlanPage(f.context);
  assert.equal(first.hasMore, true);
  assert.equal(first.readThrough, undefined, "only the last page proves a read went to the end");
  const fromFirstPage = { expectedRevision: first.revision, expectedProgressRevision: first.progressRevision };
  const refused = { code: "vibe64_work_plan_read_through_required",
    message: /replaces the whole Progress, so it needs readThrough.*read every page of Plan and Progress \(follow nextOffset while hasMore\).*Nothing changed\./u };
  await assert.rejects(f.agent({ operation: "progress-write", progressText: `${first.progressText}\n## Security\nNo findings.\n`, ...fromFirstPage }),
    refused, "a Progress built from page 1 alone would cut the Review tail");
  await assert.rejects(f.agent({ operation: "write", text: first.text.replace("- [ ] Prove", "- [~] Prove"), ...fromFirstPage }),
    { code: "vibe64_work_plan_read_through_required", message: /replaces the whole Plan/u });
  assert.equal((await readWorkPlan(f.context)).progressText, REVIEW, "the refused writes kept every line");

  // Read through, the same write keeps the tail; its answer lets the writer write again without another read.
  assert.ok(empty.pair.readThrough, "a read that fits one page is read through");
  const whole = await f.readAll();
  assert.equal(whole.progressText, REVIEW);
  const security = `${whole.progressText}\n## Security\nNo findings.\n`;
  const written = await f.agent({ operation: "progress-write", progressText: security, ...whole.pair });
  assert.equal(written.hasMore, true);
  assert.ok(written.readThrough);
  const ticked = await f.agent({ operation: "write", text: whole.text.replace("- [ ] Prove", "- [~] Prove"),
    expectedRevision: written.revision, expectedProgressRevision: written.progressRevision, readThrough: written.readThrough });
  assert.equal((await readWorkPlan(f.context)).progressText, security);
  assert.match((await readWorkPlan(f.context)).text, /- \[~\] Prove the move/u);
  // A readThrough from before other writes is stale with its revisions: refused, as any stale write is (the Plan
  // write came last, so the Plan's revision is the first to differ).
  await assert.rejects(f.agent({ operation: "progress-write", progressText: `${security}Later.\n`, ...whole.pair }), { code: "vibe64_work_plan_changed" });
  await assert.rejects(f.agent({ operation: "progress-write", progressText: `${security}Later.\n`, ...whole.pair, expectedRevision: ticked.revision }),
    { code: "vibe64_work_plan_progress_changed" });
  assert.notEqual(ticked.readThrough, written.readThrough, "each pair has its own readThrough");
});
