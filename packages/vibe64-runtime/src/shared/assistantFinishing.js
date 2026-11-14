/**
 * How a chat's work finishes: the passes that run after a completed plan
 * (Passes: After a plan), and Automatically save changes, which runs after
 * them. A turn ending never starts a pass, and neither does Save: only a plan
 * completed during a request does, or a person asking (Passes, the Master pass,
 * or a typed request).
 */

// The order the after-plan passes run in, Genesis's Master pass order: Review
// first, so every later pass starts from tested work, then Security, and Deslop
// last, so it cleans up after the others.
const AFTER_PLAN_PASS_ORDER = Object.freeze([
  "review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass", "identity-pass", "ui-pass", "deslop"
]);
// Always ticked: every completed plan is reviewed and security-checked.
const AFTER_PLAN_MANDATORY_PASSES = Object.freeze(["review", "security-pass"]);
// A new chat's ticks; Deeply starts off for every pass.
const AFTER_PLAN_DEFAULT_PASSES = Object.freeze(["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"]);
// The pass titles Genesis gives them, for messages written without its listing.
const AFTER_PLAN_PASS_TITLES = Object.freeze({
  review: "Review",
  "security-pass": "Security pass",
  "data-pass": "Data pass",
  "quality-pass": "Quality pass",
  "speed-pass": "Speed pass",
  "ux-pass": "User experience pass",
  "identity-pass": "Visual identity",
  "ui-pass": "UI pass",
  deslop: "Deslop"
});
const ASSISTANT_FINISHING_DEFAULTS = Object.freeze({
  afterPlan: AFTER_PLAN_DEFAULT_PASSES,
  afterPlanDeep: Object.freeze([]),
  autoSave: true
});
// Temporary chats, Fix it with AI and lessons run no after-plan pass and never
// save automatically; their saved choice keeps only the mandatory pair, which
// never runs there.
const ASSISTANT_NO_FINISHING = Object.freeze({
  afterPlan: AFTER_PLAN_MANDATORY_PASSES,
  afterPlanDeep: Object.freeze([]),
  autoSave: false
});
const AUTO_SAVE_SETTING = "Automatically save changes";

/**
 * Why a chat's after-plan choice cannot be saved, or "" when it can: every id
 * is a pass, Review and Security are ticked, and Deeply is ticked only on a
 * ticked pass.
 * @param {unknown} afterPlan the ticked pass ids
 * @param {unknown} afterPlanDeep the ids whose after-plan run is deep
 */
function afterPlanChoiceProblem(afterPlan, afterPlanDeep) {
  const known = (list) => Array.isArray(list) && list.every((id) => AFTER_PLAN_PASS_ORDER.includes(id));
  if (!known(afterPlan) || !known(afterPlanDeep)) {
    return `After a plan takes the passes ${AFTER_PLAN_PASS_ORDER.join(", ")}.`;
  }
  if (!AFTER_PLAN_MANDATORY_PASSES.every((id) => afterPlan.includes(id))) {
    return "Review and Security pass always run after a plan; they can't be unticked.";
  }
  if (afterPlanDeep.some((id) => !afterPlan.includes(id))) return "Tick After a plan for a pass before ticking Deeply.";
  return "";
}

/** Pass ids in the after-plan order, each once. */
const inAfterPlanOrder = (ids) => AFTER_PLAN_PASS_ORDER.filter((id) => ids.includes(id));

/**
 * The system notice a pass's automatic start after a completed plan writes.
 * @param {string} title the pass's title, as Genesis lists it
 * @param {string} key the follow-up it belongs to
 * @param {{ deep?: boolean }} [options]
 */
function afterPlanPassNotice(title, key, options = {}) {
  return {
    messageId: `assistant-after-plan:${key}`,
    text: `${title}${options.deep ? " deeply" : ""} started automatically after the plan (Passes: After a plan)`
  };
}

/** The notice Save's automatic start writes. */
function assistantAutoSaveNotice(key) {
  return { messageId: `assistant-finishing:autoSave:${key}`, text: `Save started automatically (Chat settings: ${AUTO_SAVE_SETTING})` };
}

/**
 * Whether a turn other turns follow: Auto's Junior implementing an involved plan,
 * which Senior verifies and completes in a turn of its own.
 * @param {object} request the workflow request being delivered
 */
const assistantPlanCompletionFollows = (request) => request?.stage === "implementation" && request.mode === "auto" &&
  request.planInvolved === true && request.resolvedMode === "junior";

/**
 * What an implementation turn tells its agent when Senior's plan-completion turn
 * follows it, or may: the piece of work goes on after a continue or a handoff,
 * so its final reply reports instead of inviting the person to try or publish
 * unfinished work. Auto's Junior working while the plan it found at admission is
 * active may be executing it, which only its outcome reports, so it says so from
 * its first turn. Every other workflow turn ends normally.
 * @param {object} request the workflow request being delivered
 * @returns {string} the line, or "" when this turn ends normally
 */
function assistantContinuationInstruction(request) {
  const executingPlan = request?.stage === "implementation" && request.mode === "auto" &&
    request.resolvedMode === "junior" && request.workPlan?.status === "active";
  if (!assistantPlanCompletionFollows(request) && !executingPlan) return "";
  return "When you report continue or handoff, this piece of work continues automatically after your turn: end your final reply with what you changed and what you verified, and don't use it to ask the person to try, publish or deploy the work or to offer next steps.";
}

/**
 * What every workflow turn tells its agent about saving: with the chat's
 * Automatically save changes on, Vibe64 saves the finished work after its last turn.
 * @param {boolean} autoSave
 */
function assistantSaveInstruction(autoSave) {
  return autoSave
    ? "Vibe64 saves this work automatically once it is finished, after any plan-completion turn and after-plan passes: after your complete reply, say it will be saved automatically, as a note that never replaces the reply, since the person reads only your final response; never ask the person to press Save."
    : "This chat's settings turn automatic save off: the person saves finished work with the Save button.";
}

/**
 * How a workflow turn's instructions end: whether the piece of work continues
 * after this turn, then what happens with saving. Other turns add nothing.
 * @param {object} request the request being delivered
 * @param {boolean} autoSave the chat's Automatically save changes switch
 */
function assistantWorkflowEnding(request, autoSave) {
  if (!request?.workflow) return "";
  return [assistantContinuationInstruction(request), assistantSaveInstruction(autoSave)].filter(Boolean).map(line => `\n${line}`).join("");
}

/**
 * Senior's turn after Auto's Junior implemented an involved plan: it verifies
 * the plan and completes it, or leaves it active, or hands substantial rework
 * back. It is not a pass and runs none.
 */
const ASSISTANT_PLAN_COMPLETION_MESSAGE = [
  "Plan completion:",
  "Read every page of BOTH Plan and Progress, including the complete technical implementation plan; checklist marks do not establish completion.",
  "Verify each agreed requirement against the preceding implementation, my request, accepted steering and the recorded evidence. Inspect the implementation, fix in-scope gaps and run relevant checks. Leave unrelated plans unchanged.",
  "Then explicitly complete the plan with the plan helper when every requirement is verified, and report complete with the returned revisions; otherwise leave Plan active, record the specific gaps and verification evidence in its paired Progress document, and report wait, or report handoff for substantial necessary rework.",
  "This turn checks the plan only: run no Deslop, UI pass or other pass. Once the plan is completed, Vibe64 runs the passes this chat ticks in Passes (After a plan) as their own turns.",
  "Do not ask for permission merely to verify or complete verified work. Report findings, fixes, actual checks and anything unverified."
].join(" ");

/** Senior's verification after a review an explicitly chosen Junior did, with no plan involved. */
const ASSISTANT_SENIOR_VERIFICATION_MESSAGE = "Senior verification: Check the preceding review's findings and fixes against my request and accepted steering. Inspect the implementation and evidence, fix in-scope issues and run relevant checks. Report findings, fixes, actual checks and anything unverified.";

/**
 * A plan completed during this request starts the after-plan passes: a workflow
 * request the chat runs them for, whose current plan is completed and is not
 * the plan it found already completed when it was admitted.
 * @param {object} request the saved routing request
 * @param {{ status: string, revision: string } | null} plan the current plan
 */
function planCompletedDuringRequest(request, plan) {
  const admitted = request?.afterPlan?.planAtAdmission;
  return Boolean(request?.afterPlan) && plan?.status === "completed" &&
    !(admitted?.status === "completed" && admitted.revision === plan.revision);
}

export {
  AFTER_PLAN_DEFAULT_PASSES,
  AFTER_PLAN_MANDATORY_PASSES,
  AFTER_PLAN_PASS_ORDER,
  AFTER_PLAN_PASS_TITLES,
  ASSISTANT_FINISHING_DEFAULTS,
  ASSISTANT_NO_FINISHING,
  ASSISTANT_PLAN_COMPLETION_MESSAGE,
  ASSISTANT_SENIOR_VERIFICATION_MESSAGE,
  AUTO_SAVE_SETTING,
  afterPlanChoiceProblem,
  afterPlanPassNotice,
  assistantAutoSaveNotice,
  assistantPlanCompletionFollows,
  assistantWorkflowEnding,
  inAfterPlanOrder,
  planCompletedDuringRequest
};
