import { assistantWorkflowStateIsSupported } from "./assistantRouting.js";

/**
 * The offline upgrade of a saved routing request from schema 3 or 4 to the
 * workflow request of schema 5, which the routing state upgrade runs with the
 * services stopped. Live routing never reads the older shapes.
 */
/**
 * Offline conversion only. Existing requests never gain authority to replay or continue.
 */
function assistantWorkflowUpgradeChanges({ metadata = {}, conversations = [] }) {
  function convert(raw) {
    if (!raw) return raw;
    let previous;
    try {
      previous = JSON.parse(raw);
    } catch {
      throw new Error("Saved routing request is unreadable. Inspect it before upgrading.");
    }
    if (!previous || typeof previous !== "object" || Array.isArray(previous)) throw new Error("Saved routing request must be an object.");
    if (previous.schemaVersion === 5) {
      if (!assistantWorkflowStateIsSupported(previous)) throw new Error("Saved workflow has an unsupported state.");
      return raw;
    }
    const statuses = [
      "routing",
      "sending",
      "uncertain",
      "sent",
      "failed",
      "cancelled",
      "done",
      "review_pending",
      "review_sending",
      "review_uncertain",
      "reviewing",
      "planning_pending",
      "planning_sending",
      "planning_uncertain",
      "planning",
      "implementation_pending",
      "implementation_sending",
      "implementation_uncertain"
    ];
    if (![3, 4].includes(previous.schemaVersion) || !statuses.includes(previous.status) ||
        !previous.messageId || !previous.input || !previous.assignments) {
      throw new Error(
        "Saved routing request is unsupported. Finish earlier routing upgrades first."
      );
    }
    const { continuation, implementationMessage, reviewMessageId, autoExecution, reviewStatus, outcome, ...request } = previous;
    let stage = null;
    if (previous.status.startsWith("planning") || previous.reason === "planning" && !reviewMessageId) stage = "planning";
    else if (previous.status.startsWith("review") ||
      reviewMessageId && continuation !== "implementation" ||
      previous.reason === "review") stage = "review";
    else if (["plan_implementation", "explicit_implementation"].includes(previous.reason)) stage = "implementation";
    const suffix = previous.status.split("_").at(-1);
    let delivery = ["routing", "sending", "uncertain", "failed"].includes(suffix) ? suffix : suffix === "pending" ? "pending" : "accepted";
    if (previous.status === "cancelled") delivery = previous.attemptedMessageId ? "uncertain" : "failed";
    const workflow = previous.mode === "auto" && previous.task !== "deslop" && ["implementation", "review"].includes(stage);
    const completedRequest = previous.status === "done" && !workflow;
    const followup = continuation === "implementation" ? implementationMessage
      : reviewMessageId && ["review", "planning"].includes(stage)
        ? { messageId: reviewMessageId, message: previous.reviewMessage, planRevision: previous.workPlan?.revision || null } : null;
    return JSON.stringify({
      ...request,
      schemaVersion: 5,
      status: completedRequest ? "complete" : "waiting",
      delivery,
      stage,
      workflow,
      planInvolved: Boolean(previous.workPlan),
      reason: previous.reason === "discussion"
        ? "conversation"
        : ["plan_implementation", "explicit_implementation"].includes(previous.reason)
            ? "implementation"
            : previous.reason === "deslop" ? "review" : previous.reason,
      steps: autoExecution?.continuations || 0,
      stalledTurns: autoExecution?.stalledTurns || 0,
      steering: autoExecution?.steering || [],
      ...(followup ? { followup } : {}),
      stopped: previous.stopped === true || previous.status === "cancelled",
      ...(!completedRequest
        ? { error: previous.error || "Workflow retained after upgrade. Inspect the saved delivery and request a continuation when ready." }
        : {})
    });
  }
  const change = values => values.assistant_routing_request ? { assistant_routing_request: convert(values.assistant_routing_request) } : {};
  return {
    metadata: change(metadata),
    conversations: conversations.map(record => ({
      ...record,
      routingMetadata: { ...(record.routingMetadata || {}), ...change(record.routingMetadata || {}) }
    }))
  };
}

export { assistantWorkflowUpgradeChanges };
