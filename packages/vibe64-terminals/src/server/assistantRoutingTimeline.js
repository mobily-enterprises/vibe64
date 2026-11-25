import { recordSessionTimelineEvent, timelineActor } from "@local/vibe64-core/server/sessionTimeline";

// What a session's timeline (vibe64-core's sessionTimeline.js) says about its routed requests: each delivery that
// failed or was refused, with its code, the stage and role it was for, and whether it was an automatic next step
// (a follow-up such as Senior's review after Junior's turn). It only observes: the delivery's own decisions, its
// error and what it saves stay exactly as they are, and a recording never fails a delivery. Ids, states and codes
// only; never a message's words.

/**
 * The timeline line of one delivery that failed.
 * @param {{ sessionId?: string, routingConversationId?: string, runtime?: { stateRoot?: string } | null, vibe64User?: object | null }} context
 * @param {Record<string, any> | null | undefined} state the routed request's saved state
 * @param {boolean} followup whether it was the request's automatic next step
 * @param {any} error what the delivery threw
 * @param {string} sessionId
 */
function recordRoutingDeliveryFailure(sessionId, context, state, followup, error) {
  try {
    recordSessionTimelineEvent(sessionId, {
      kind: "routing",
      event: followup ? "followup-refused" : "delivery-failed",
      chat: context?.routingConversationId ? "temporary" : "main",
      conversation: context?.routingConversationId,
      message: state?.messageId,
      code: error?.code,
      mode: state?.mode,
      role: state?.resolvedMode,
      stage: state?.stage,
      delivery: state?.delivery,
      status: state?.status,
      by: timelineActor(context?.vibe64User)
    }, { projectRuntimeRoot: context?.runtime?.stateRoot || undefined });
  } catch {
    // A timeline is a record of what happened; failing to write one changes nothing that happened.
  }
}

/**
 * The routing's delivery, observed: each failed `deliver` is recorded on the session's timeline and thrown on exactly
 * as it was; everything else passes through unchanged.
 * @template {{ deliver: (sessionId: string, context: any, state: any, followup?: boolean, inspectionOnly?: boolean) => Promise<any> }} T
 * @param {T} delivery
 * @returns {T}
 */
function withRoutingTimeline(delivery) {
  return Object.freeze({
    ...delivery,
    deliver(sessionId, context, state, followup = false, inspectionOnly = false) {
      return delivery.deliver(sessionId, context, state, followup, inspectionOnly).catch((error) => {
        if (!inspectionOnly) recordRoutingDeliveryFailure(sessionId, context, state, followup, error);
        throw error;
      });
    }
  });
}

export { recordRoutingDeliveryFailure, withRoutingTimeline };
