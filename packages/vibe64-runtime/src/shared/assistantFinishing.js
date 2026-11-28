/**
 * How a chat's work finishes. A plan's steps are Implementation, Senior review, Passes and Completed: its final Passes
 * section lists the passes it runs, written when the plan is made from the chat's After a plan ticks (or added by the
 * person from Passes, or by typing). Senior review is one Senior turn: it verifies and full-ticks every item outside
 * Passes and, when the plan's next pass is its Review (PLAN_REVIEW_PASS), runs that pass in the same turn, so the
 * plan's changes are reviewed once (assistantPlanReviewMessage); it is Done once both are ticked. Every other pass
 * then runs in a Senior turn of its own. Once every item is ticked and no question is open the plan is completed and
 * archived, and Automatically save changes runs. A turn ending never starts a pass of its own, and neither does Save.
 * No step of a plan runs the whole-project checks (assistantWholeChecks.js).
 */

// The order the after-plan passes run in, Genesis's Master pass order: Review
// first, so every later pass starts from tested work, then Security, and Deslop
// last, so it cleans up after the others.
const AFTER_PLAN_PASS_ORDER = Object.freeze([
  "review", "security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass", "identity-pass", "ui-pass", "deslop"
]);
// Always ticked: every completed plan is reviewed and security-checked.
const AFTER_PLAN_MANDATORY_PASSES = Object.freeze(["review", "security-pass"]);
// The pass Senior's review of a plan runs in its own turn when it is the plan's next pass: Genesis's Review, which
// reviews the plan's changes as Senior's review does, so one turn does both and the changes are reviewed once.
const PLAN_REVIEW_PASS = "review";
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
 * The system notice a plan's pass writes when Vibe64 starts it.
 * @param {{ title: string, item: string }} pass the pass and its Passes item
 * @param {string} key the follow-up it belongs to
 */
function planPassNotice(pass, key) {
  return { messageId: `assistant-plan-pass:${key}`, text: `${pass.title} started: the plan's next pass (${pass.item})` };
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
 * Automatically save changes on, Vibe64 saves the finished work after its last
 * turn, and the agent saves each finished, checked stage before then itself, so
 * the project's other sessions can update onto it; with it off, the person saves.
 * @param {boolean} autoSave
 */
function assistantSaveInstruction(autoSave) {
  return autoSave
    ? "Vibe64 saves this work automatically once it is finished, after any Senior review of the plan and the plan's passes. Before then, save each finished and checked stage of a plan, or a finished piece of work, yourself with `vibe64-helper session save`, never mid-edit, running `vibe64-helper session update` first when session status says this session is behind; once it has saved, tell the other sessions you are working with, so they update before building on the old code. After your complete reply, say what you saved or that the work will be saved automatically, as a note that never replaces the reply, since the person reads only your final response; never ask the person to press Save."
    : "This chat's settings turn automatic save off: the person saves finished work with the Save button, and `vibe64-helper session save` refuses in this chat.";
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

// What a plan may leave undone: only what this session can't do. Every implementing role and every step reads it.
const PLAN_LEFTOVERS_RULE = "What this session can fix is fixed before the plan completes, whether or not it is in this step's scope: development data and files you created, small defects you found (a barely visible focus ring), a step that fails (a compose that fails while Preview runs). A failing or flaky test is a defect to fix until it passes every run, never a Leftover. The plan's one Leftovers list in Progress holds only what needs the person (a choice, a real device, an account, a click) or what this session can't reach (another repository, a setting only the owner can change), each with its reason; a choice becomes a numbered question with a recommended answer. Never offer to make a plan for what is left.";

// What the person reads once a plan's last step is Done: one message for the whole plan.
const PLAN_CLOSING_MESSAGE = "one line per step (Senior review, with the plan's Review pass when it ran that pass too, and each other pass) saying what it fixed, from Progress; the choices made for the person; and the Leftovers from Progress, each with its reason. It asks no question about them: a choice among them is a numbered question with a recommended answer, and the step ends Needs you instead.";

// The plan's last step finishes what the earlier ones left that this session can fix.
const PLAN_FINISHING_STEP = "Before it ends Done, fix whatever Progress still holds that this session can fix: the plan's last step is its finishing step, and leaves Leftovers holding only what needs the person or what this session can't reach.";

// How every step of a plan ends, Senior review and each pass alike.
const PLAN_STEP_ENDINGS = "Never end with partial, for later, not run here or worth knowing: when you run out of room, report continue and carry on in your next turn; a check that can't run here is made to run or becomes a question (for example: these browser tests run only in CI; accept CI as their proof?); a broken setup is a blocker question. Explain every failure; never call one pre-existing or environmental: a missing tool or an environment's refusal is a defect to fix, reported with what is missing. Never detach a check to outlive the session. An answer becomes a rule written into Plan or Progress, never a footnote. " + PLAN_LEFTOVERS_RULE + " When Progress records that the person said to pick your recommendation, pick it for every question, record each choice in Progress with the time, and never wait.";

// What Senior's review of a plan reads and checks, with or without the Review pass it runs.
const PLAN_REVIEW_READ = "Read every page of BOTH Plan and Progress, including the complete technical implementation plan, and follow the rules and choices recorded there.";
const PLAN_REVIEW_CHANGES = "Review the plan's changes against Plan and Progress: check that they make sense and do what each item says. Verify EVERY checklist item outside the plan's Passes section against the code as it is now, not only the open ones: marks and earlier records do not establish completion. Check each against my request, accepted steering and the evidence, inspect the implementation, fix what you find within the plan's scope, each fix proven by a test that failed first, and run the focused tests for what changed. Leave unrelated plans unchanged.";
// An item that asks for the whole-project checks, in a plan made before no step ran them.
const PLAN_REVIEW_WHOLE_ITEM = " An item that asks for them (\"the whole suite passes\", in a plan made before this rule) is not proven by focused tests, so never tick it on them: rewrite it with the plan helper, as a plan change within the agreed outcome, into what this review can prove (the focused tests for the plan's changes pass), record in Progress that Vibe64 offers the whole run to the person once the plan is finished, and report continue with the returned revisions: your next turn reviews the plan as it now stands and ticks what the evidence proves.";
const PLAN_REVIEW_TICKS = "Full-tick (- [x]) each item your review proves and move unsupported or regressed ones back to - [~] or - [ ].";
const PLAN_REVIEW_NEEDS_YOU = "Needs you: numbered questions, each with a recommended answer, in your final reply and in Progress; report wait. For substantial necessary rework, update the Technical details and Progress and report handoff.";
const PLAN_REVIEW_QUESTIONS = "Each item whose proof can't run in this session (a real phone, a suite only CI runs) ends as Needs you: a numbered question with a recommended answer, in your final reply and in Progress. A question Junior's last reply asked the person is yours now: settle it from Plan and Progress, or ask it as a Needs you question. Whether to run the passes, save or run the whole-project checks is never one: Vibe64 runs the passes, saves, and asks the person about the whole-project checks itself.";

/**
 * Senior's review of a plan whose next pass is not its Review: it reads the plan's changes against the plan, Progress
 * and the code, runs the focused tests for what changed, fixes what is wrong within the plan's scope and ticks what it
 * proves; then the plan moves on to its passes, or, with none, Senior completes it. It is not a pass, runs none and
 * runs no whole-project checks.
 */
const ASSISTANT_PLAN_COMPLETION_MESSAGE = [
  "Senior review of the plan:",
  PLAN_REVIEW_READ,
  PLAN_REVIEW_CHANGES,
  "This review is a review: run no whole-project checks, such as one whole run of the test suite, which the plan's passes would leave behind as they change the code after it. Once the plan is finished and saved, Vibe64 asks the person whether to run them once, so never ask about them yourself." +
    PLAN_REVIEW_WHOLE_ITEM,
  PLAN_REVIEW_TICKS,
  "End one of two ways. Done: every item outside Passes is - [x]. When the plan has Passes items, leave it active and report complete with the returned revisions: Vibe64 then runs each pass in its own turn and completes the plan after the last. Without Passes items, this review is the plan's last step. " + PLAN_FINISHING_STEP + " Then complete the plan with the plan helper and report complete with the returned revisions; your final reply is then the plan's one closing message: " + PLAN_CLOSING_MESSAGE + " " + PLAN_REVIEW_NEEDS_YOU,
  PLAN_STEP_ENDINGS,
  PLAN_REVIEW_QUESTIONS,
  "This turn reviews the plan only: run no pass. Do not ask for permission merely to verify or complete verified work."
].join(" ");

/**
 * What Senior's review of a plan tells its agent: the plan's review step. With the plan's Review pass (its next pass,
 * planReviewPass), the same turn runs that pass too, over the request Genesis wrote for its Passes item, which the
 * caller sends word for word as the message's last paragraph, where Genesis recognises the pass's run: one review of
 * the plan's changes, never a Senior review and then a Review pass. Done needs every item outside Passes and the
 * Review item ticked (recordOutcome refuses otherwise); then the plan runs its other passes, each in its own turn, or,
 * with none left, Vibe64 completes it.
 * @param {{ title: string, item: string } | null} [pass] the Review pass this review runs, or null for the review alone
 * @param {{ last?: boolean }} [options] last: no other Passes item is left unticked, so this is the plan's last step
 */
function assistantPlanReviewMessage(pass = null, { last = false } = {}) {
  if (!pass) return ASSISTANT_PLAN_COMPLETION_MESSAGE;
  return [
    `Senior review of the plan with its ${pass.title} pass: this one turn is the plan's review step. It reviews the plan and runs the plan's Passes item “${pass.item}”, the ${pass.title} pass, whose request from Genesis is this message's last paragraph: one review of the plan's changes does both, and Vibe64 runs no ${pass.title} pass after it.`,
    PLAN_REVIEW_READ,
    PLAN_REVIEW_CHANGES,
    `As the ${pass.title} pass, judge the plan's changes as that request asks, against the whole app: that the tests prove each change (each changed behaviour has a test that would fail without it, none weakened or skipped), the gaps between intent, code and explanation, and costs that grow with the data; fix each defect after writing the test that fails without the fix.`,
    "This review runs no whole-project checks, such as one whole run of the test suite, even where the pass's guidance asks for one: run the focused tests for what you changed. Once the plan is finished and saved, Vibe64 asks the person whether to run them once, so never ask about them yourself, and never take the pass's PASS RECORD step: the turn the person's Yes starts records the plan's passes once every check passes." +
      PLAN_REVIEW_WHOLE_ITEM,
    `${PLAN_REVIEW_TICKS} Record in Progress, under ${pass.title}, one line saying what the pass fixed and proved, and full-tick its Passes item (- [x] ${pass.item}) once everything in its scope is fixed and proven; change no other Passes item.`,
    `End one of two ways. Done: every item outside Passes is - [x] and “${pass.item}” is - [x]; Vibe64 refuses complete until both are. Leave the plan active and report complete with the returned revisions: ` +
      (last
        ? `${pass.title} is the plan's last pass, so this step is the plan's last. ${PLAN_FINISHING_STEP} Your final reply is then the plan's one closing message: ${PLAN_CLOSING_MESSAGE} Vibe64 then completes the plan. `
        : "Vibe64 then runs each of the plan's other passes in its own turn and completes the plan after the last. ") +
      PLAN_REVIEW_NEEDS_YOU,
    PLAN_STEP_ENDINGS,
    PLAN_REVIEW_QUESTIONS,
    `This turn reviews the plan and runs its ${pass.title} pass only: run no other pass; Vibe64 starts each other Passes item in its own turn. Do not ask for permission merely to verify or complete verified work.`
  ].join(" ");
}

/**
 * What a plan's pass turn tells its agent, before the pass's request: the
 * Passes item it runs, what it may fix, how it ends and what it reports.
 * @param {{ title: string, item: string }} pass
 * @param {{ last?: boolean, person?: boolean }} [options] last: no other Passes item is left
 *   unticked; person: the person's message comes before the request
 */
function assistantPassInstructions(pass, { last = false, person = false } = {}) {
  return [
    `Plan pass: this turn runs ${pass.title}, the plan's Passes item “${pass.item}”, and only that pass; Vibe64 starts each other Passes item in its own turn.`,
    "Use vibe64-helper plan read to obtain workflow.messageId, workflow.turnId and workflow.stage, and read every page of BOTH Plan and Progress before working.",
    "Fix what you find within this pass's scope, each fix proven by a test that failed first: the pass decides what you look for, not what you may fix. A review writes the failing test and then fixes the code; Deslop keeps its cleanups behaviour-neutral but fixes a real defect it finds as a separate fix with its own test.",
    "Run no whole-project checks, such as one whole run of the test suite, even where this pass's guidance asks for one: run the focused tests for what you changed. Once the plan is finished and saved, Vibe64 asks the person whether to run them once, so never ask about them yourself, and never take this pass's PASS RECORD step: the turn the person's Yes starts records the plan's passes once every check passes.",
    "Record in Progress, under this pass's title, one line saying what it fixed and proved. In Plan change only this item's tick (vibe64-helper plan write with the paired revisions); the server refuses any other Plan change, and Vibe64 completes the plan after its last pass. write and progress-write replace the whole document: build them from every page you read and pass readThrough, which only the read's last page (hasMore false) and each write's answer return.",
    "End one of two ways, reported before your final response through vibe64-helper plan outcome with JSON on stdin: {messageId, turnId, stage, decision, explanation, progress, expectedRevision, expectedProgressRevision}, using the identity and revisions from your latest read. Done: everything within the scope is fixed and proven; full-tick (- [x]) this item, then report complete. Needs you: numbered questions, each with a recommended answer, in your final reply and in Progress; report wait.",
    PLAN_STEP_ENDINGS,
    ...(person ? ["The person's message comes before this pass's request below. When it answers this pass's questions, record each answer as a rule in Progress and finish the pass. When it asks for something else, do that as an ordinary request first, then finish the pass or report wait with its questions still open."] : []),
    last
      ? `This is the plan's last pass. ${PLAN_FINISHING_STEP} When it is Done, your final reply is the plan's one closing message: ${PLAN_CLOSING_MESSAGE}`
      : "Keep your final reply short: what this pass fixed and proved. Progress holds the details."
  ].join(" ");
}

/** Senior's verification after a review an explicitly chosen Junior did, with no plan involved. */
const ASSISTANT_SENIOR_VERIFICATION_MESSAGE = "Senior verification: Check the preceding review's findings and fixes against my request and accepted steering. Inspect the implementation and evidence, fix in-scope issues and run relevant checks. Report findings, fixes, actual checks and anything unverified.";

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
  PLAN_LEFTOVERS_RULE,
  PLAN_REVIEW_PASS,
  afterPlanChoiceProblem,
  assistantAutoSaveNotice,
  assistantPassInstructions,
  assistantPlanReviewMessage,
  assistantPlanCompletionFollows,
  assistantWorkflowEnding,
  inAfterPlanOrder,
  planPassNotice
};
