// The plan check at the end of a turn. Vibe64 knows two facts about a turn that may tick an active plan: whether
// the session's source changed during it (files or commits), and whether the plan's marks, Progress or its check
// record changed. When the source changed and the plan did not, the AI gets one note in the same chat, before the
// request settles, asking it to walk the checklist and update it or record that nothing needs a new mark. Which item a
// change belongs to is the AI's to judge: Vibe64 never infers it. The note is never repeated for its own turn.
import { assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantReplyAsksPerson, latestAssistantQuestionsAwaitingUserReply } from "@local/vibe64-runtime/shared/conversationQuestions";
import { workPlanScope } from "../shared/assistantWorkPlan.js";
import { readWorkPlan, readWorkPlanMark } from "./assistantWorkPlan.js";
import { readSourceState, sourceChangesSince } from "./planSourceChanges.js";
import { assistantPlanRole } from "./assistantRoutingRequests.js";

/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */

// The turns whose start this process keeps at once, oldest dropped first.
const PLAN_CHECK_TURNS_KEPT = 256;
// The changed files the note names; the rest it counts.
const NAMED_FILES = 5;
const PLAN_CHECK_LABEL = "Plan check";

/**
 * Whether the request's turn may change the plan's marks: Senior's, Junior's or a review's own turn, never a pass's
 * (its own Passes item only), a task's, an answer's or a Custom chat's.
 * @param {object} request the saved routing request
 */
function assistantPlanChecks(request) {
  return ["senior", "junior", "review"].includes(assistantPlanRole({ ...request, status: "working", delivery: "accepted" }));
}

const markIdentity = (mark) => (mark ? `${mark.how}:${mark.at}` : "");
const readMark = (context) => readWorkPlanMark(context).catch(() => null);

/**
 * What a turn that may tick an active plan starts from: the plan's revisions, its mark and the session's source. Null
 * for any other turn, the plan check's own, and a session without a source.
 * @param {object} context the routing context
 * @param {object} request the saved routing request about to be delivered
 */
async function planCheckStart(context, request) {
  if (request.followup?.planCheck || !assistantPlanChecks(request)) return null;
  const plan = await readWorkPlan(context).catch(() => null);
  if (plan?.status !== "active") return null;
  const [mark, source] = await Promise.all([readMark(context), readSourceState(context.session).catch(() => null)]);
  if (!source) return null;
  return { planRevision: plan.revision, progressRevision: plan.progressRevision || "", mark: markIdentity(mark), source };
}

/**
 * Keeps what the delivered turn started from, by request key.
 * @param {AssistantRoutingState} routingState
 * @param {string} key
 * @param {string} messageId the message whose turn it is
 * @param {Awaited<ReturnType<typeof planCheckStart>>} start
 */
function rememberPlanCheckStart(routingState, key, messageId, start) {
  routingState.planCheckTurns.delete(key);
  if (!start) return;
  routingState.planCheckTurns.set(key, { messageId, ...start });
  while (routingState.planCheckTurns.size > PLAN_CHECK_TURNS_KEPT) {
    routingState.planCheckTurns.delete(routingState.planCheckTurns.keys().next().value);
  }
}

/**
 * What the ended turn started from, once: null when this process did not deliver it.
 * @param {AssistantRoutingState} routingState
 * @param {string} key
 * @param {string} messageId the message whose turn ended
 */
function takePlanCheckStart(routingState, key, messageId) {
  const start = routingState.planCheckTurns.get(key);
  if (start?.messageId !== messageId) return null;
  routingState.planCheckTurns.delete(key);
  return start;
}

/**
 * The source's changes during a turn that left the plan as it started: the same active plan, Progress and mark.
 * Null when the plan changed, was checked, or the source did not change.
 * @param {object} context the routing context
 * @param {NonNullable<Awaited<ReturnType<typeof planCheckStart>>>} start
 * @returns {Promise<{ files: string[], more: boolean } | null>}
 */
async function planCheckChanges(context, start) {
  const plan = await readWorkPlan(context).catch(() => null);
  if (plan?.status !== "active" || plan.revision !== start.planRevision || (plan.progressRevision || "") !== start.progressRevision) {
    return null;
  }
  if (markIdentity(await readMark(context)) !== start.mark) return null;
  const changes = await sourceChangesSince(start.source, context.session).catch(() => null);
  return changes && (changes.files.length || changes.more) ? changes : null;
}

/** "3 files", "1 file", "1000 or more files". */
function fileCount({ files, more }) {
  const count = Math.max(files.length, more ? 1 : 0);
  return `${count}${more ? " or more" : ""} ${count === 1 && !more ? "file" : "files"}`;
}

/**
 * The plan check's note: what the chat shows as Vibe64's (displayMessage) and what the AI reads (message).
 * @param {{ files: string[], more: boolean }} changes
 */
function planCheckNote(changes) {
  const named = changes.files.slice(0, NAMED_FILES).join(", ") +
    (changes.files.length > NAMED_FILES ? ` and ${changes.files.length - NAMED_FILES} more` : "");
  const fact = `${fileCount(changes)} of the session's source changed in this turn, but the plan's checklist marks and Progress did not.`;
  return {
    displayMessage: `${fact} Vibe64 asked the AI to bring the plan up to date.`,
    message: [
      `Vibe64 plan check: ${fact.replace(" in this turn,", ` in this turn${named ? ` (${named})` : ""},`)}`,
      "Read the plan and Progress again and walk the checklist item by item, not only the item you were on: work on one item often builds parts of others.",
      "Half-tick (- [~]) every item this turn's work built whose own checks pass, full-tick (- [x]) only what the plan's final proof covers, and leave an item that is only partly built - [ ]; record in Progress what is built, what is partly built and how you checked it.",
      "If nothing needs a new mark or Progress, run vibe64-helper plan checked with the paired revisions instead.",
      "Then stop: start no other work in this turn."
    ].join(" ")
  };
}

/**
 * The plan check's part in a routed request's turn end.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDelivery} dependencies.delivery
 */
function createAssistantPlanCheck({ routingState, records, delivery }) {
  /**
   * Sends the check: when a turn that may tick the active plan completed, changing the session's source but not the
   * plan's marks, Progress or record, the AI gets one note in the same chat (the request's next turn) asking it to
   * bring the plan up to date or record that nothing needs a new mark. Never for a turn the person stopped, a goal's
   * or one that ended asking the person.
   * @returns {Promise<boolean>} whether the check was sent and the request waits for its turn
   */
  async function send(context, state, run, start) {
    const sessionId = context.session.sessionId;
    if (!routingState.allowAuto || run.state !== "completed" || state.stopped || !assistantPlanChecks(state)) return false;
    const { goal } = await records.currentGoal(sessionId, context);
    if (assistantGoalIsActive(goal)) return false;
    if (assistantReplyAsksPerson(latestAssistantQuestionsAwaitingUserReply(
      await context.runtime.store.readConversationTail(sessionId, { userLimit: 1 })
    ))) return false;
    const changes = await planCheckChanges(context, start);
    if (!changes) return false;
    const before = JSON.stringify(state);
    await records.preparePlanCheck(context, state, planCheckNote(changes));
    state.status = "working";
    await records.save(context, state);
    try {
      await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, true);
    } catch (error) {
      // A note that may have reached the AI is never sent again; one that never left settles the request as before.
      if (state.attemptedMessageId) {
        state.status = "waiting";
        state.delivery = "uncertain";
        state.error = error.message;
        await records.save(context, state);
        return true;
      }
      for (const field of Object.keys(state)) delete state[field];
      Object.assign(state, JSON.parse(before));
      await records.save(context, state);
      return false;
    }
    return true;
  }

  /**
   * The check's own turn ended: the outcome the turn before it reported stands for it, with the plan's revisions as
   * the check left them when the plan's scope is unchanged. An outcome the check reported itself stands as it is.
   */
  async function settle(context, state) {
    const checked = state.planCheck;
    if (!checked || !state.outcome || state.outcome.turnId !== checked.turnId) return;
    // A check sent again (its uncertain delivery confirmed) carries the outcome on from this turn.
    checked.turnId = state.turnId;
    state.outcome.turnId = state.turnId;
    if (state.outcome.planRevision === null || !state.workPlan) return;
    const plan = await readWorkPlan(context).catch(() => null);
    if (plan && workPlanScope(plan.text) === workPlanScope(state.workPlan.text)) {
      state.outcome.planRevision = plan.revision;
      state.outcome.progressRevision = plan.progressRevision || null;
      state.workPlan = plan;
    }
  }

  /** What the ended turn started from, once: null when this process did not deliver it. */
  function takeStart(key, messageId) {
    return takePlanCheckStart(routingState, key, messageId);
  }

  /**
   * At a turn's end, before the request settles: the check's own turn settles as the turn before it would have; any
   * other turn whose start this process kept (null: a restart or a disconnected schedule lost it) may get the check.
   * @returns {Promise<boolean>} whether the check was sent, and the request waits for its turn
   */
  async function afterTurn(context, state, run, start) {
    if (state.followup?.planCheck) {
      await settle(context, state);
      return false;
    }
    delete state.planCheck;
    return Boolean(start) && send(context, state, run, start);
  }

  return Object.freeze({
    takeStart,
    afterTurn
  });
}

export {
  PLAN_CHECK_LABEL,
  assistantPlanChecks,
  createAssistantPlanCheck,
  planCheckStart,
  rememberPlanCheckStart
};
