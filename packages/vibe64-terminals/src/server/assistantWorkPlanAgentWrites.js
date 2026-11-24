// What the agent's plan command proves before it changes a plan (manageWorkPlan's `agent` option): that it read Plan
// and Progress through to the end before replacing one of them whole, and that Progress's Leftovers hold no fixable work.
import { sha256Hex } from "@local/vibe64-core/server/sha256Hex";
import { planError } from "./assistantWorkPlanFiles.js";
import { fixableLeftoversRefusal } from "./planLeftovers.js";

// What only a read's last page, or a write's answer, gives: proof that Plan and Progress were read through to the end.
const readThroughOf = (plan) => sha256Hex("vibe64-plan-read-through-v1\0" + plan.artifactRevision);

/**
 * Refuses an agent's write or progress-write without the current pair's readThrough, and a progress-write (or a
 * complete, for the current Progress) whose Leftovers hold a failing or flaky test. Vibe64's own writes skip it.
 * @param {string} operation
 * @param {{ text?: string, readThrough?: string }} input
 * @param {object | null} current the current plan, or null
 */
function refuseUnprovenAgentWrite(operation, input, current) {
  if (current && ["write", "progress-write"].includes(operation) && input.readThrough !== readThroughOf(current)) {
    const fix = "read every page of Plan and Progress (follow nextOffset while hasMore), then write from all of them. Nothing changed.";
    const replaced = operation === "write" ? "Plan" : "Progress";
    throw planError(
      `plan ${operation} replaces the whole ${replaced}, so it needs readThrough from the read's last page or your last write's answer: ${fix}`,
      "vibe64_work_plan_read_through_required"
    );
  }
  const leftovers = ["progress-write", "complete"].includes(operation) &&
    fixableLeftoversRefusal(operation === "complete" ? current?.progressText : input.text);
  if (leftovers) throw planError(leftovers, "vibe64_work_plan_leftover_fixable");
}

export { readThroughOf, refuseUnprovenAgentWrite };
