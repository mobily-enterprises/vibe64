// The act handoff: a turn that may only answer (a turn Router took for conversation, or Vibe64's note on the passes the
// person asked for) or only plan (Auto's planning), asked to act, never refuses the action and never tells the person
// to do it themselves. It runs `vibe64-helper plan act`, doing nothing itself, and once the turn ends the same request
// continues as an implementation turn that may act, without the person asking again, as the plan handoff
// (assistantPlanHandoff.js) continues a plan request as Senior's planning turn.
import { vibe64Error } from "@local/vibe64-core/server/core";
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantActHandsOn } from "./assistantRoutingRequests.js";

// The acting turn's lead: what the person asked for, from their request and the conversation, and nothing more.
const ASSISTANT_ACT_HANDOFF_MESSAGE = [
  "Do what I asked:",
  "my latest message asks you to act: it accepts your own offer or recommendation to act, or it authorises or asks for the action.",
  "The turn before this one could not act, so Vibe64 continues my request in this turn, which may.",
  "Do exactly the action I accepted or asked for, from my request and the conversation, and nothing more; a step that needs my decision is a numbered question."
].join(" ");

/** Who acts on a handed-on request: Auto's implementation after planning is Junior's, otherwise the turn's own role. */
const assistantActingRole = (request) => request.stage === "planning" ? "junior" : request.resolvedMode;

/** The chat notice of a request handed on to a turn that may act. */
function assistantActHandoffNotice(request) {
  return {
    messageId: `assistant-act-handoff:${request.messageId}:${request.actHandoff.turnId}`,
    text: `${assistantModeLabel(request.resolvedMode)} is doing what you asked.`
  };
}

/**
 * `vibe64-helper plan act`: the running turn, which may only answer or only plan, hands its request on to a turn that
 * may act, doing nothing itself. Any other turn may act on the request itself, within its own instructions.
 * @param {object} handoff
 * @param {string} handoff.sessionId
 * @param {object | null} handoff.request the saved routing request
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} handoff.handActionOn
 */
async function handActionOver({ sessionId, request, handActionOn }) {
  if (assistantActHandsOn(request)) {
    await handActionOn(sessionId, { messageId: request.messageId, turnId: request.turnId }, { vibe64User: request.submittedBy || null });
    return {
      handedTo: "implementation",
      message: "Vibe64 continues this request in a turn that may act as soon as yours ends. Do nothing yourself: end your turn now with one short line saying the work starts now."
    };
  }
  if (request?.followup?.planCheck === true) {
    throw vibe64Error(
      "This turn only brings the plan up to date with the turn before it, and hands nothing on: do what its note asks.",
      "vibe64_work_act_handoff_unavailable",
      { status: 409 }
    );
  }
  throw vibe64Error(
    "Only a turn that may only answer or only plan hands its request on with plan act; this turn may act itself: do what the person asked here, within its instructions.",
    "vibe64_work_act_handoff_unavailable",
    { status: 409 }
  );
}

export {
  ASSISTANT_ACT_HANDOFF_MESSAGE,
  assistantActHandoffNotice,
  assistantActingRole,
  handActionOver
};
