// Auto's plan handoff: a plan change the running turn's role may not make goes, with that turn's draft, to Senior's
// planning turn once the turn ends, so a request that needs a plan always gets one without the person asking.
import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantPlanHandsOff } from "./assistantRoutingRequests.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// The plan operations Auto hands to Senior when the turn that tried one may not make it.
const PLAN_HANDOFF_OPERATIONS = Object.freeze(["new", "write", "reopen", "archive"]);
// How much of that turn's draft Senior's follow-up carries.
const PLAN_HANDOFF_DRAFT_CHARACTERS = 32_000;
const ASSISTANT_PLAN_HANDOFF_MESSAGE = [
  "Save the plan:",
  "the previous turn could not save the plan change my request asks for, because only Senior creates a plan, changes its scope, reopens or archives it.",
  "Save it now through vibe64-helper plan, following my request, the conversation and accepted steering: read the current Plan and Progress first, and if a current plan exists and I have not said whether to update it or archive and replace it, ask me.",
  "The previous turn's draft is below; correct it wherever it departs from my request or the conversation.",
  "This is a planning-only turn: change no application files and do not implement the plan."
].join(" ");

/**
 * The bounded draft a plan handoff carries, from the text the refused plan command received.
 * @param {unknown} text
 */
function assistantPlanHandoffDraft(text) {
  const characters = Array.from(typeof text === "string" ? text : "");
  if (characters.length <= PLAN_HANDOFF_DRAFT_CHARACTERS) return characters.join("");
  return characters.slice(0, PLAN_HANDOFF_DRAFT_CHARACTERS).join("") +
    "\n\n[The draft continues beyond this excerpt; complete it from the conversation.]";
}

/** The chat notice of a request Auto handed to Senior's planning turn. */
function assistantPlanHandoffNotice(request) {
  return {
    messageId: `assistant-plan-handoff:${request.messageId}:${request.planHandoff.turnId}`,
    text: "Senior is saving the plan.\n\nOnly Senior creates a plan, changes its scope, reopens or archives it, " +
      "so Vibe64 handed this request and the previous turn's draft to Senior."
  };
}

/**
 * What a turn hears when the plan command refuses its role a plan change. In Auto, creating a plan, reopening or
 * archiving it, and any plan change an answer-only turn makes, is Senior's: the request and the turn's draft go to
 * Senior's planning turn once this turn ends. Junior's own refused Plan content write is often a slip while ticking
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
      ? "If the person asked to change the plan's scope, send the complete plan they asked for with vibe64-helper plan " +
        "new instead: in Auto, the helper hands it to Senior, who saves it in its own turn right after yours."
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
        operation: input.operation,
        draft: input.text
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
      "Senior saves this plan change: in Auto, Vibe64 hands this request and your draft to Senior's planning turn " +
        "as soon as your turn ends. Nothing was saved yet. End your turn now with a short reply saying Senior is " +
        "saving the plan; do not ask the person to switch modes or to ask Senior, and do not repeat the plan command.",
      "vibe64_work_plan_handed_to_senior",
      { status: 409 }
    );
  }
  if (["junior", "custom"].includes(request?.mode)) {
    return vibe64Error(
      `This is a ${assistantModeLabel(request.mode)} chat: it can update a plan's checklist marks and Progress, but only ` +
        "Senior creates a plan, changes its scope, reopens or archives it. Tell the person to switch Chat mode to " +
        "Senior or Auto and ask again; do not offer a chat-only outline as the saved plan.",
      error.code,
      { status: 409 }
    );
  }
  return error;
}

export {
  ASSISTANT_PLAN_HANDOFF_MESSAGE,
  PLAN_HANDOFF_OPERATIONS,
  assistantPlanHandoffDraft,
  assistantPlanHandoffNotice,
  refusedPlanChange
};
