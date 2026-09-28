import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { publishAssistantRoutingUpgrade } from "./assistantRoutingUpgrade.js";

// This exact incident was verified against native history and confirmed by the
// owner. Other drafts must never be declared complete from prose or a model guess.
const incident = {
  sessionId: "2026-09-26_13-48-46",
  messageId: "message_tab_6fd37be8-c0a2-4f0f-ad47-756fc8213580_mulardk5_2",
  revision: "08fc6a0650e707409bce5ef18f02f47eee69c3d570962e535ae46244a15fad63"
};
const digest = text => createHash("sha256").update(text).digest("hex");

function completeDiscussionPlan(plan, request, expected) {
  if (request.messageId !== expected.messageId || digest(plan) !== expected.revision) return null;
  if (request.mode !== "auto" || request.reason !== "discussion" || request.status !== "done" ||
      request.workPlan?.status !== "drafting" || request.workPlan.revision !== expected.revision ||
      request.workPlan.text !== plan || !plan.startsWith("Status: drafting\n")) {
    throw new Error("The identified completed-plan incident has conflicting state; inspect it before repair.");
  }
  const text = plan.replace(/^Status: drafting\n/u, "Status: implemented\n");
  return { plan: text, request: { ...request, workPlan: {
    ...request.workPlan, text, status: "implemented", revision: digest(text)
  } } };
}

async function upgradeCompletedDiscussionPlan(context) {
  const { systemRoot, report } = context;
  await publishAssistantRoutingUpgrade({ ...context, prepareUpdates: async () => {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const paths = store.paths(incident.sessionId);
      const planPath = path.join(paths.sessionRoot, "work-plan/plan.md");
      let plan;
      try { plan = await readFile(planPath, "utf8"); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (digest(plan) !== incident.revision) continue;
      const requestPath = path.join(paths.metadataRoot, "assistant_routing_request");
      const original = await readFile(requestPath, "utf8");
      const result = completeDiscussionPlan(plan, JSON.parse(original), incident);
      if (!result) {
        report("warning", `${path.basename(projectRuntimeRoot)}: the affected plan has a newer request; leaving it unchanged for review.`);
        continue;
      }
      report("warning", `${path.basename(projectRuntimeRoot)}: restoring the verified completed plan and its matching display snapshot; no conversation messages change.`);
      updates.push({ filePath: planPath, original: plan, contents: result.plan },
        { filePath: requestPath, original, contents: JSON.stringify(result.request) });
    }
    return updates;
  } });
}

export { completeDiscussionPlan, upgradeCompletedDiscussionPlan };
