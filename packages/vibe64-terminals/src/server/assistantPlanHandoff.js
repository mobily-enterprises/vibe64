// Auto's plan handoff: a request to make or change a plan that the running turn's role may not make goes to Senior's
// planning turn once the turn ends, so a request that needs a plan always gets one without the person asking. The
// turn hands it over with `vibe64-helper plan handoff`, writing nothing; a plan change it tries anyway is refused and
// handed over the same way. Nothing it wrote goes with it: Senior writes the plan from the request and the
// conversation.
import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantPlanHandsOff } from "./assistantRoutingRequests.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// The plan operations Auto hands to Senior: handoff itself, and a change the turn that tried it may not make.
const PLAN_HANDOFF_OPERATIONS = Object.freeze(["handoff", "new", "write", "reopen", "archive"]);
const ASSISTANT_PLAN_HANDOFF_MESSAGE = [
  "Make the plan:",
  "my request asks to make or change a plan, and only Senior creates a plan, changes its scope, reopens or archives it.",
  "Write it now through vibe64-helper plan from my request, the conversation and accepted steering: read the current Plan and Progress first, and if a current plan exists and I have not said whether to update it or archive and replace it, ask me.",
  "This is a planning-only turn: change no application files and do not implement the plan."
].join(" ");
// Senior's turn for a plan change handed over while the plan was being implemented.
const ASSISTANT_PLAN_CHANGE_MESSAGE = [
  "Change the plan:",
  "the plan is being implemented, and the implementing turn handed this plan change to Senior, who alone changes a plan's scope.",
  "Read the current Plan and Progress, then make the change in the current plan through vibe64-helper plan, from my request, the conversation and accepted steering.",
  "This turn changes the plan only: change no application files and do not implement it; once the change is saved, Vibe64 continues the implementation in a new turn."
].join(" ");

/**
 * The chat notice of a request Auto handed to Senior's planning turn: a change to a plan being
 * implemented lets the implementation go on once it is saved.
 */
function assistantPlanHandoffNotice(request) {
  return {
    messageId: `assistant-plan-handoff:${request.messageId}:${request.planHandoff.turnId}`,
    text: request.planHandoff.implementing ? "Senior is changing the plan. Implementation continues once the change is saved."
      : "Senior is making the plan."
  };
}

/**
 * `vibe64-helper plan handoff`: the running Auto turn hands its request to Senior's planning turn without writing a
 * plan. A Junior or Custom chat has no Senior to hand it to, and a turn that may write the plan writes it itself.
 * @param {object} handoff
 * @param {string} handoff.sessionId
 * @param {object | null} handoff.request the saved routing request
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} handoff.handPlanToSenior
 */
async function handPlanOver({ sessionId, request, handPlanToSenior }) {
  if (assistantPlanHandsOff(request)) {
    const handoff = { messageId: request.messageId, turnId: request.turnId, operation: "handoff" };
    await handPlanToSenior(sessionId, handoff, { vibe64User: request.submittedBy || null });
    return {
      handedTo: "senior",
      message: "Senior makes the plan in its own turn as soon as yours ends. End your turn now with one short line saying Senior is making the plan."
    };
  }
  if (["junior", "custom"].includes(request?.mode)) {
    throw vibe64Error(
      `This is a ${assistantModeLabel(request.mode)} chat, with no Senior to hand the plan to: write nothing, and tell ` +
        "the person that plans need Senior or Auto, which they choose in Chat mode.",
      "vibe64_work_plan_handoff_unavailable",
      { status: 409 }
    );
  }
  throw vibe64Error(
    "Only an Auto turn that may not write the plan hands it over; this turn writes the plan itself with vibe64-helper plan.",
    "vibe64_work_plan_handoff_unavailable",
    { status: 409 }
  );
}

/**
 * What a turn hears when the plan command refuses its role a plan change. In Auto, creating a plan, reopening or
 * archiving it, and any plan change an answer-only turn makes, is Senior's: the request goes to Senior's planning turn
 * once this turn ends, without what the turn wrote. Junior's own refused Plan content write is often a slip while ticking
 * marks, so it goes to no one. A Junior or Custom chat keeps the refusal, saying how the person gets the change.
 * @param {object} refusal
 * @param {string} refusal.sessionId
 * @param {object | null} refusal.request the saved routing request
 * @param {{ operation: string, text?: string }} refusal.input the plan command's input
 * @param {Error & { code?: string }} refusal.error the plan command's refusal
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} refusal.handPlanToSenior
 * @param {RuntimeLogger} refusal.logger
 */
async function refusedPlanChange({ sessionId, request, input, error, handPlanToSenior, logger }) {
  if (!PLAN_HANDOFF_OPERATIONS.includes(input.operation)) return error;
  if (error?.code === "vibe64_work_plan_content_senior_only") {
    const scopeChange = request?.mode === "auto"
      ? "If the person asked to change the plan's scope, run vibe64-helper plan handoff instead and end your turn: in " +
        "Auto, Senior makes the change in its own turn right after yours."
      : "If the person asked to change the plan's scope, tell them this chat cannot, and that switching Chat mode to " +
        "Senior or Auto does.";
    return vibe64Error(`${error.message} ${scopeChange}`, error.code, { status: 409 });
  }
  if (error?.code !== "vibe64_work_plan_senior_required") return error;
  if (assistantPlanHandsOff(request)) {
    try {
      await handPlanToSenior(sessionId, {
        messageId: request.messageId,
        turnId: request.turnId,
        operation: input.operation
      }, { vibe64User: request.submittedBy || null });
    } catch (handoffError) {
      logOperationalEvent(logger, "warn", {
        component: "vibe64.assistant_routing",
        event: "vibe64.assistant_routing.plan_handoff_failed",
        sessionId,
        code: handoffError?.code,
        error: handoffError?.message
      }, "A plan change only Senior may make could not be handed to Senior; the turn hears the refusal.");
      return error;
    }
    return vibe64Error(
      "Senior makes this plan change: in Auto, Vibe64 hands this request to Senior's planning turn as soon as your " +
        "turn ends, and Senior writes the plan from the request and the conversation. Nothing was saved. Next time, " +
        "run vibe64-helper plan handoff instead of writing a plan. End your turn now with one short line saying Senior " +
        "is making the plan; do not ask the person to switch modes or to ask Senior, and do not repeat the plan command.",
      "vibe64_work_plan_handed_to_senior",
      { status: 409 }
    );
  }
  if (["junior", "custom"].includes(request?.mode)) {
    return vibe64Error(
      `This is a ${assistantModeLabel(request.mode)} chat: it can update a plan's checklist marks and Progress, but only ` +
        "Senior creates a plan, changes its scope, reopens or archives it. Tell the person to switch Chat mode to " +
        "Senior or Auto and ask again; write no plan, not even a chat-only outline.",
      error.code,
      { status: 409 }
    );
  }
  return error;
}

export {
  ASSISTANT_PLAN_CHANGE_MESSAGE,
  ASSISTANT_PLAN_HANDOFF_MESSAGE,
  PLAN_HANDOFF_OPERATIONS,
  assistantPlanHandoffNotice,
  handPlanOver,
  refusedPlanChange
};
