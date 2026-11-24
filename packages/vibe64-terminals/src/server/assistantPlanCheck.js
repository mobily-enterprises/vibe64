// The plan check at the end of a turn. Vibe64 knows two facts about a turn that may tick an active plan: whether
// the session's source changed during it (files or commits), and whether the plan's marks, Progress or its check
// record changed. When the source changed and the plan did not, the AI gets one note in the same chat, before the
// request settles, asking it to walk the checklist and update it or record that nothing needs a new mark. Which item a
// change belongs to is the AI's to judge: Vibe64 never infers it. The note is never repeated for its own turn.
import { assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";
import { assistantPlanCompletionFollows } from "@local/vibe64-runtime/shared/assistantFinishing";
import { workPlanAtPasses, workPlanScope, workPlanStep } from "../shared/assistantWorkPlan.js";
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
 * Whether the request's turn gets the plan check: Senior's, Junior's or a review's own turn, never a pass's (its own
 * Passes item only), a task's, a Custom chat's or a turn that only answers, which may tick the plan but is not asked to.
 * @param {object} request the saved routing request
 */
function assistantPlanChecks(request) {
  return request?.reason !== "conversation" &&
    ["senior", "junior", "review"].includes(assistantPlanRole({ ...request, status: "working", delivery: "accepted" }));
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
      "Senior's review, the plan's passes and Save are the plan's next steps, which Vibe64 runs: never a question for the person.",
      "If this turn asked the person anything else, ask it again at the end of your reply, as you asked it.",
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
   * bring the plan up to date or record that nothing needs a new mark. Never for a turn the person stopped or a goal's.
   * A turn that ended asking the person gets it too: the note asks the AI to ask again, and Senior's review, the passes
   * and Save are never such a question.
   * @returns {Promise<boolean>} whether the check was sent and the request waits for its turn
   */
  async function send(context, state, run, start) {
    const sessionId = context.session.sessionId;
    if (!routingState.allowAuto || run.state !== "completed" || state.stopped || !assistantPlanChecks(state)) return false;
    const { goal } = await records.currentGoal(sessionId, context);
    if (assistantGoalIsActive(goal)) return false;
    const changes = await planCheckChanges(context, start);
    if (!changes) return false;
    const before = JSON.stringify(state);
    await records.preparePlanCheck(context, state, planCheckNote(changes));
    // The plan as the check found it: unchanged since the turn started.
    Object.assign(state.planCheck, { planRevision: start.planRevision, progressRevision: start.progressRevision, mark: start.mark });
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
   * @returns {Promise<boolean>} whether the AI left the plan, Progress and record exactly as the check found them
   */
  async function settle(context, state, plan) {
    const checked = state.planCheck;
    if (!checked) return false;
    const carried = state.outcome?.turnId === checked.turnId ? state.outcome : null;
    // A check sent again (its uncertain delivery confirmed) carries the outcome on from this turn.
    checked.turnId = state.turnId;
    if (carried) {
      carried.turnId = state.turnId;
      if (carried.planRevision !== null && state.workPlan && plan && workPlanScope(plan.text) === workPlanScope(state.workPlan.text)) {
        carried.planRevision = plan.revision;
        carried.progressRevision = plan.progressRevision || null;
        state.workPlan = plan;
      }
    }
    return Boolean(plan) && plan.revision === checked.planRevision && (plan.progressRevision || "") === checked.progressRevision &&
      markIdentity(await readMark(context)) === checked.mark;
  }

  /**
   * A turn implementing the active plan that would stop the plan (it reported wait, reported nothing, asked the
   * person, or, in a Senior chat, reported Done short of the plan's passes) moves the plan on instead, as Auto's
   * Junior's handoff would, when every item outside Passes is built, or when the AI left the plan exactly as Vibe64's
   * plan check found it: Senior's review of the plan follows, which verifies every item, ticks it, and asks the person
   * what is left as numbered Needs you questions; a Senior chat whose plan reached its passes goes on to them. In
   * Auto that is Junior's turn; in a Senior chat Senior's own (`planReview`). A Junior chat has no Senior turns. A
   * plan never waits at its last item, nor on a question about the steps Vibe64 runs. Vibe64 judges no item: the
   * marks are the AI's. The turn implements the plan when its request does (Implement plan, or an outcome naming
   * the plan) or it changed the plan.
   * @param {{ ignored: boolean, start: object | null }} turn ignored: the plan check's turn left the plan as it found
   *   it; start: what the turn started from
   */
  async function reviewBuiltPlan(context, state, run, plan, { ignored, start }) {
    if (!routingState.allowAuto || run.state !== "completed" || state.stopped || plan?.status !== "active") return;
    const involved = state.planInvolved === true || Boolean(start) && plan.revision !== start.planRevision;
    const reported = state.outcome?.turnId === state.turnId ? state.outcome.decision : "";
    const senior = state.mode === "senior" && state.resolvedMode === "senior" && state.workflow === true && state.stage === "implementation";
    if (!involved || !senior && !assistantPlanCompletionFollows({ ...state, planInvolved: true })) return;
    // A Done that reached the plan's passes, or completed it, moves it on as it is.
    if (["continue", "handoff"].includes(reported) || reported === "complete" && (workPlanAtPasses(plan) || !senior)) return;
    // Built: no item outside Passes is still - [ ] (a plan without a checklist never is).
    const built = ["review", "pass"].includes(workPlanStep(plan)?.step);
    if (!built && !ignored) return;
    if (assistantGoalIsActive((await records.currentGoal(context.session.sessionId, context)).goal)) return;
    Object.assign(state, { planInvolved: true, workPlan: plan, ...(senior ? { planReview: true } : {}) });
    state.outcome = {
      decision: "handoff",
      explanation: built ? "Every item outside the plan's Passes is built: Senior reviews the plan."
        : "The AI left the plan as Vibe64's plan check found it: Senior reviews every item against the work.",
      progress: true,
      turnId: state.turnId,
      stage: state.stage,
      planRevision: plan.revision,
      progressRevision: plan.progressRevision || null,
      vibe64: true
    };
  }

  /** What the ended turn started from, once: null when this process did not deliver it. */
  function takeStart(key, messageId) {
    return takePlanCheckStart(routingState, key, messageId);
  }

  /**
   * At a turn's end, before the request settles: the check's own turn settles as the turn before it would have; any
   * other turn whose start this process kept (null: a restart or a disconnected schedule lost it) may get the check.
   * A turn that gets none may then hand Auto's built plan to Senior's review (reviewBuiltPlan).
   * @returns {Promise<boolean>} whether the check was sent, and the request waits for its turn
   */
  async function afterTurn(context, state, run, start) {
    const checkTurn = Boolean(state.followup?.planCheck);
    if (!checkTurn) delete state.planCheck;
    if (!checkTurn && start && await send(context, state, run, start)) return true;
    const plan = await readWorkPlan(context).catch(() => null);
    const ignored = checkTurn && await settle(context, state, plan);
    // The check's turn started from the plan as the check found it.
    await reviewBuiltPlan(context, state, run, plan, { ignored, start: checkTurn ? state.planCheck || null : start });
    return false;
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
