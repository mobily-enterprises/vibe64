import { AppError } from "@jskit-ai/kernel/server/runtime";
import { VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingFromMetadata,
  assistantRoutingGoalFromMetadata,
  assistantWorkflowStateIsSupported,
  assistantWorkflowMessageIds,
  assistantWorkflowRole
} from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantTaskPurpose } from "@local/vibe64-runtime/shared/assistantExplicitTask";
import { workPlanStep } from "../shared/assistantWorkPlan.js";
import { awaitsAccount } from "./turnInterruptions.js";

/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

const STATE_KEY = "assistant_routing_request";
// Since 20261123-passes-in-plans: a plan's passes live in the plan, the request holds only the running pass.
const ASSISTANT_ROUTING_REQUEST_SCHEMA = 7;
// Messages the person cancelled in this chat, newest last and bounded. A send
// never admits one again, and a snapshot never offers one for recovery.
const CANCELLED_KEY = "assistant_cancelled_messages";
const MAX_CANCELLED_MESSAGES = 50;

const activeMessage = state => state.followup || state.input;
/**
 * The turn an engine's receipt for a message names: the turn it started, or the running turn it joined. A request's
 * turn (`turnId`) is the turn the receipt of the latest message routing delivered under it names: its own message, a
 * follow-up or resume, or a steer its engine started as a turn of its own (`joinSteering`). Whether a turn is the
 * request's (its end, its reported outcome, its plan handoff and check, its interruption) is always a comparison with
 * that one id, so a turn that replaced another is the request's from its receipt on, and the replaced turn's end is no
 * longer the request's to decide.
 * @param {{ turnId?: string, turn?: { id?: string }, codexAgentTurn?: { turnId?: string } } | null} result
 */
const receiptTurnId = result => result?.turnId || result?.turn?.id || result?.codexAgentTurn?.turnId || "";

/**
 * A steer the AI received joins the request it was sent under, whose reported outcome it makes stale. A steer its
 * engine started as a turn of its own, because the request's turn it was sent into ended as it went (the engine
 * stopped that turn to change the signed-in account, say), is the request's turn from then on: the request takes its
 * id and works on, as if its own turn had taken the steer, so its agent can report the step's outcome and the step is
 * decided when that turn ends. The end of the turn it replaced then matches no request. A request the person stopped,
 * one that finished, and one whose next step is being sent or has been sent stay as they are.
 * @param {object} request the saved routing request, changed in place
 * @param {{ messageId: string, message: string, displayMessage?: string }} input the steer
 * @param {string} steeredTurnId the running turn the steer was sent into
 * @param {object} result the engine's receipt for the steer
 */
function joinSteering(request, input, steeredTurnId, result) {
  request.steering.push({ messageId: input.messageId, text: input.displayMessage || input.message });
  delete request.outcome;
  const turnId = receiptTurnId(result);
  const undecided = request.status === "working" && request.delivery === "accepted";
  const settled = request.status === "waiting" && ["accepted", "pending"].includes(request.delivery);
  if (result?.deliveryMode !== "new_turn" || !turnId || turnId === request.turnId || !steeredTurnId ||
      request.turnId !== steeredTurnId || request.stopped || request.cancelled || !(undecided || settled)) return;
  Object.assign(request, { turnId, status: "working", delivery: "accepted" });
  // What the replaced turn's end prepared for Continue, or for its timed resume, belongs to that turn.
  for (const field of ["error", "followup", "awaitingAnswer", "resumeAt"]) delete request[field];
}

/**
 * The role the plan command acts as for the request's running turn: "" (read only) for a task or no working request;
 * "pass" for a plan's pass, which ticks only its own Passes item; "review" for Auto's Senior check in a review
 * follow-up; otherwise the routed role, so a Senior, Junior or Custom chat's agent keeps its own, also in a turn that
 * only answers (reason conversation): a person asking "Are you going to do it?" gets their plan ticked.
 * @param {object | null} request the saved routing request
 */
function assistantPlanRole(request) {
  if (assistantTaskPurpose(request?.task) || request?.status !== "working" || request.delivery !== "accepted") return "";
  if (request.stage === "pass") return request.pass ? "pass" : "";
  return request.stage === "review" && request.followup && assistantWorkflowRole(request) === "senior" ? "review" : request.resolvedMode;
}
// The plan roles that may change the plan in some way; any other may only read it.
const PLAN_CHANGING_ROLES = Object.freeze(["senior", "review", "junior", "pass"]);
/**
 * Whether the request's running turn hands a plan change to Senior's planning turn: in Auto only, for a routed turn
 * whose role may not make it (Junior's) and for a turn Router took for conversation, whose plan request Senior's
 * planning turn makes, never for a pass or task.
 * @param {object | null} request the saved routing request
 */
function assistantPlanHandsOff(request) {
  return request?.mode === "auto" && !request.stopped && Boolean(request.turnId) && !assistantTaskPurpose(request.task) &&
    request.stage !== "pass" && request.status === "working" && request.delivery === "accepted" &&
    (request.reason === "conversation" || !["senior", "review"].includes(assistantPlanRole(request)));
}
const usesWorkPlan = state => state.planInvolved === true;
function failure(message, code) {
  return new AppError(409, message, { code });
}
/**
 * Whether finished work is saved automatically now: the chat's Automatically
 * save changes switch. Unreadable preferences save nothing.
 */
function savesAutomatically(metadata) {
  try {
    return assistantRoutingFromMetadata(metadata)?.autoSave === true;
  } catch {
    return false;
  }
}
function parseRequest(value) {
  const request = value ? JSON.parse(value) : null;
  if (request && request.schemaVersion !== ASSISTANT_ROUTING_REQUEST_SCHEMA) {
    throw failure("Saved workflow needs the candidate stopped-service state upgrade.", "vibe64_assistant_workflow_upgrade_required");
  }
  if (request && !assistantWorkflowStateIsSupported(request)) {
    throw failure("Saved workflow has an unsupported state. Inspect it before continuing.", "vibe64_assistant_workflow_invalid");
  }
  return request;
}
/** The saved request whose routed message or automatic follow-up is the given turn. */
function assistantRoutingRequestForMessage(metadata, isMessage) {
  const request = parseRequest(metadata?.[STATE_KEY]);
  return request && assistantWorkflowMessageIds(request).some(isMessage) ? request : null;
}
/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
function read(store, sessionId) {
  return store.readMetadataValue(sessionId, STATE_KEY).then(parseRequest);
}
function parseCancelled(value) {
  try {
    const list = JSON.parse(value || "[]");
    return Array.isArray(list) ? list.filter(entry => typeof entry?.messageId === "string" && entry.messageId) : [];
  } catch {
    return [];
  }
}
/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
const readCancelled = async (store, sessionId) => parseCancelled(await store.readMetadataValue(sessionId, CANCELLED_KEY));
/** The ids of the messages the person cancelled in this chat. */
function assistantCancelledMessageIds(metadata) {
  return parseCancelled(metadata?.[CANCELLED_KEY]).map(entry => entry.messageId);
}

/** Only the host's stopped disposable copy may drop these process handles. */
function prepareCopiedAssistantRouting(metadata = {}) {
  const patch = {};
  if (metadata.assistant_goal_intent) patch.assistant_goal_intent = "null";
  const request = parseRequest(metadata[STATE_KEY]);
  if (request) {
    if (request.status !== "complete") {
      Object.assign(request, {
        stopped: true,
        status: "waiting",
        error: "Copied workflow is stopped. Inspect retained delivery before continuing."
      });
    }
    if (request.helper) request.helper.executionId = "";
    // Keep uncertain delivery and the original message/turn receipt intact.
    patch[STATE_KEY] = JSON.stringify(request);
  }
  const goal = assistantRoutingGoalFromMetadata(metadata);
  if (goal?.status === "active") patch.assistant_routing_goal = JSON.stringify({ ...goal, status: "paused" });
  return patch;
}
// The visible messages an automatic step is decided on, which its delivery compares with the conversation then.
const FOLLOWUP_SNAPSHOT_MESSAGES = 5;
// How many of the latest user messages are read back for the person's own since an automatic step was decided.
const PERSON_LOOKBACK_MESSAGES = 20;

/** Whether the turn's user message is Vibe64's own (a note to the main chat is the app's) or a request's follow-up. */
const automaticTurn = (turn) => turn.metadata?.actorId === "app" || Boolean(turn.metadata?.assistantRouting?.parentMessageId);

function visibleMessages(turns, limit) {
  return turns.flatMap((turn) => [
    ...(turn.user ? [{ role: "user", text: turn.user.text, ...(automaticTurn(turn) ? { automatic: true } : {}) }] : []),
    ...(turn.messages || []).filter(({ role }) => role === "assistant").map(({ text }) => ({ role: "assistant", text }))
  ]).slice(-limit);
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {number} limit
 */
async function recentVisibleMessages(store, sessionId, limit) {
  return visibleMessages(await store.readConversationTail(sessionId, { userLimit: limit }), limit);
}

/**
 * What an automatic step is decided on in the conversation: its latest visible messages, which its delivery compares
 * with the conversation then, and its latest user message, after which any message is one the conversation gained
 * since.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
async function followupConversation(store, sessionId) {
  const turns = await store.readConversationTail(sessionId, { userLimit: FOLLOWUP_SNAPSHOT_MESSAGES });
  return {
    messages: visibleMessages(turns, FOLLOWUP_SNAPSHOT_MESSAGES),
    lastUserMessageId: turns.findLast((turn) => turn.user?.messageId)?.user.messageId || ""
  };
}

/** Whether the turn's user message is the person's own: neither Vibe64's nor a message from another session. */
const personTurn = (turn) => Boolean(turn.user) && !automaticTurn(turn) && turn.metadata?.projectMessage?.direction !== "received";

/**
 * The turns with a user message the conversation gained after the user message `messageId`; null when that message
 * can't be found (none recorded, or beyond the lookback), so what came since is not known.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {string} messageId
 */
async function userTurnsSince(store, sessionId, messageId) {
  if (!messageId) return null;
  const turns = await store.readConversationTail(sessionId, { userLimit: PERSON_LOOKBACK_MESSAGES });
  const since = turns.findIndex((turn) => turn.user?.messageId === messageId);
  return since < 0 ? null : turns.slice(since + 1).filter((turn) => turn.user);
}

/**
 * The latest user message of the request's turn sent as `messageId`: that message, or the last of its steers that
 * follow it with no other message between; "" when it is beyond the lookback, so what came after is not known.
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} state the saved routing request, with its accepted steering
 * @param {string} messageId the turn's own message
 */
async function turnLastUserMessageId(store, sessionId, state, messageId) {
  const steered = new Set((state.steering || []).map((entry) => entry.messageId));
  const turns = (await store.readConversationTail(sessionId, { userLimit: PERSON_LOOKBACK_MESSAGES + steered.size }))
    .filter((turn) => turn.user);
  let last = turns.findIndex((turn) => turn.user.messageId === messageId);
  if (last < 0) return "";
  while (steered.has(turns[last + 1]?.user.messageId)) last += 1;
  return turns[last].user.messageId;
}

/**
 * Whether the saved request still owes its step to a turn or message that came before it
 * (assistantRoutingOwedSteps.js): waiting with the step unsent (never attempted, so never sent twice), not stopped or
 * cancelled. A Continue the turn still running refused leaves it owed too.
 * @param {object | null} state the saved routing request
 */
const owesStep = (state) => Boolean(state?.followup?.owed) && state.status === "waiting" && state.delivery === "pending" &&
  !state.attemptedMessageId && !state.stopped && !state.cancelled;

/**
 * Whether the saved request is a turn its AI account stopped, waiting for an account its person can use
 * (assistantRoutingInterruptions.js): its latest interruption is marked with the resume it prepared, still unsent, and
 * the person has not stopped or cancelled it. Setting an account continues it, once; a Continue, a new message or a
 * Stop leaves nothing marked.
 * @param {object | null} state the saved routing request
 */
const waitsForAccount = (state) => awaitsAccount(state?.interruptions, state?.followup?.messageId) &&
  state.status === "waiting" && state.delivery === "pending" && !state.attemptedMessageId && !state.stopped &&
  !state.cancelled && !state.followup.owed;

/**
 * Whether `input` is another session's message while the request owes its step: not the person's word, it never
 * replaces that step, and runs as its own turn as written (assistantRoutingAdmission.js).
 * @param {object | null} state the saved routing request
 * @param {{ messageId: string, turnMetadata?: object }} input the message being admitted
 */
const passesOwedStep = (state, input) => state?.messageId !== input.messageId && owesStep(state) &&
  input.turnMetadata?.projectMessage?.direction === "received";

/**
 * Whether the request's prepared step still fits the plan, when it involves one: Senior's review fits any active plan
 * whose every item outside Passes is built, or the plan it was decided on (completed too); any other step needs that
 * plan active and unchanged, except that the person's Continue goes on with an implementation from the active plan as
 * it now is.
 * @param {object} state the saved routing request, with its prepared follow-up
 * @param {{ status: string, revision: string, text: string } | null} plan the current plan
 * @param {{ continued?: boolean }} [options] continued: the person's Continue asks for the step
 */
function followupFitsPlan(state, plan, { continued = false } = {}) {
  if (!usesWorkPlan(state)) return true;
  const unchanged = Boolean(plan) && plan.revision === state.followup.planRevision;
  if (state.stage === "review") {
    return plan?.status === "active" && (unchanged || workPlanStep(plan)?.step === "review") || plan?.status === "completed" && unchanged;
  }
  return plan?.status === "active" && (unchanged || continued && state.stage === "implementation");
}
function withSelection(context, selection) {
  return {
    ...context,
    assistantSelection: selection,
    session: {
      ...context.session,
      metadata: {
        ...context.session.metadata,
        [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection)
      }
    }
  };
}

export {
  ASSISTANT_ROUTING_REQUEST_SCHEMA,
  CANCELLED_KEY,
  MAX_CANCELLED_MESSAGES,
  PLAN_CHANGING_ROLES,
  STATE_KEY,
  activeMessage,
  assistantCancelledMessageIds,
  assistantPlanHandsOff,
  assistantPlanRole,
  assistantRoutingRequestForMessage,
  failure,
  followupConversation,
  followupFitsPlan,
  joinSteering,
  owesStep,
  passesOwedStep,
  personTurn,
  prepareCopiedAssistantRouting,
  read,
  readCancelled,
  receiptTurnId,
  recentVisibleMessages,
  turnLastUserMessageId,
  savesAutomatically,
  userTurnsSince,
  usesWorkPlan,
  waitsForAccount,
  withSelection
};
