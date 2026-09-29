import { createHash } from "node:crypto";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { publishAssistantRoutingUpgrade } from "./assistantRoutingUpgrade.js";

function convertPlan(text) {
  const status = /^Status: (drafting|ready|blocked|paused|implemented|active|completed)\r?$/mu.exec(text)?.[1];
  if (!status) throw new Error("A saved plan has no recognized status. Inspect it before upgrading plans.");
  return text.replace(/^Status: .*\r?$/mu, `Status: ${["implemented", "completed"].includes(status) ? "completed" : "active"}`);
}

function upgradePlanSession({ metadata, conversations, plans = [] }) {
  const converted = plans.map(({ conversationId, originalOld, original }) => {
    const text = convertPlan(originalOld ?? original);
    if (originalOld !== null && original !== null && original !== text) throw new Error("Both legacy and current plans exist with different contents. Resolve that conflict before upgrading.");
    return { conversationId, text };
  });
  function requestMetadata(saved, conversationId) {
    if (!saved?.assistant_routing_request) return {};
    const request = JSON.parse(saved.assistant_routing_request);
    if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Invalid saved plan routing request.");
    const plan = converted.find((item) => item.conversationId === conversationId);
    const next = { ...request, workPlan: plan ? {
      text: plan.text, status: /^Status: (active|completed)$/mu.exec(plan.text)[1],
      revision: createHash("sha256").update(plan.text).digest("hex")
    } : null };
    // Old receipts and authored messages remain intact. Revision approval no
    // longer controls routing or the plan lifecycle.
    return JSON.stringify(next) === JSON.stringify(request) ? {} : { assistant_routing_request: JSON.stringify(next) };
  }
  return { plans: converted, metadata: requestMetadata(metadata, ""), conversations: conversations.map((conversation) => ({ ...conversation,
    ...(conversation.routingMetadata ? { routingMetadata: { ...conversation.routingMetadata, ...requestMetadata(conversation.routingMetadata, conversation.conversationId) } } : {})
  })) };
}

async function upgradeAssistantPlans(context) {
  const { systemRoot, report } = context;
  return publishAssistantRoutingUpgrade({ ...context, prepareUpdates: async temporaryRoot => {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot, includePlans: true, transform: upgradePlanSession });
      if (staged.length) report("info", `${path.basename(projectRuntimeRoot)}: preserving plans in plans/current.md and converting their explicit status; ${staged.length} file(s).`);
      updates.push(...staged);
    }
    report("info", "Explicit implemented plans become completed; other plans remain active. No completion is inferred from turn outcomes. Plan text and conversation history are preserved.");
    return updates;
  } });
}

export { upgradeAssistantPlans, upgradePlanSession };
