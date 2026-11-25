/**
 * The whole-project checks after a plan: the checks a project runs as a whole,
 * such as one whole run of the test suite. No step of a plan runs them, since
 * the plan's passes would leave a run before them behind. Once a plan is
 * finished (completed, archived and, with Automatically save changes on,
 * saved), Vibe64 asks the person once whether to run them now: Yes starts one
 * Senior turn that runs them once and fixes what they find as new work; No runs
 * nothing; any other message ends the question, its turn told what was asked.
 * The request that finished the plan holds the question (`wholeChecks`):
 * asked, then declined (No), run (the Yes's own request) or offered (another
 * message's request). Every value sits on a request at an existing stage, so a
 * release before this one reads it as an ordinary request.
 */

// No step of a plan runs the whole-project checks; Vibe64 offers them to the person once the plan is finished.
const PLAN_NO_WHOLE_CHECKS = "No step of a plan runs the whole-project checks (such as one whole run of the test suite): not an implementation turn, not Senior's review and not a pass. Once the plan is finished and saved, Vibe64 asks the person whether to run them once, so never ask about them yourself.";

// The question Vibe64 asks once a plan is finished, above the message box with its Yes and No.
const WHOLE_CHECKS_QUESTION = "Run the whole-project checks once now?";
// What the Yes sends as the person's message: the request the turn that runs the checks works from, whole in itself,
// as a release before this one reads it when it resumes that turn.
const WHOLE_CHECKS_YES_MESSAGE = "Yes, run the whole-project checks once now, on the finished plan's work. " +
  "The plan is finished, so this is new work, not one of its steps.";
const WHOLE_CHECKS_LABEL = "Whole-project checks";

/**
 * The chat note Vibe64 writes once a plan is finished (completed, archived and,
 * with Automatically save changes on, after the save's own note): the question
 * the Yes and No above the message box answer.
 * @param {string} key the turn that finished the plan
 */
function assistantWholeChecksQuestionNotice(key) {
  return {
    messageId: `assistant-whole-checks:${key}`,
    text: "The plan is finished. Run the whole-project checks once now, on the finished plan's work? " +
      "They are the checks the project runs as a whole, such as one whole run of the test suite, and can take a long time. " +
      "Choose Yes or No above the message box."
  };
}

/** The note No writes: nothing runs, and Vibe64 never asks again for this plan. */
function assistantWholeChecksDeclinedNotice(key) {
  return {
    messageId: `assistant-whole-checks-declined:${key}`,
    text: "Whole-project checks not run. Vibe64 won't ask again for this plan."
  };
}

/**
 * What the turn the person's Yes starts is told to do: run the whole-project
 * checks once, on the finished plan's work, and fix what they find as new work.
 */
const ASSISTANT_WHOLE_CHECKS_INSTRUCTION = [
  "Run the project's whole-project checks once: the checks it states for the whole project, such as one whole run of the test suite, through its own verification command.",
  "The person chose to run them now, after a finished plan, on the work as it is. Never run them a second time in this request: after a fix, run the focused tests for what you changed.",
  "Fix what they find as new work: a failing or flaky test is a defect to fix, each fix proven by a test that failed first. The plan is completed and archived: make no plan and change none.",
  "Preserve unrelated work and staged changes. Do not commit, push or deploy."
].join(" ");

/**
 * How that turn ends and what it reports.
 * @param {{ autoSave: boolean }} options autoSave: the chat's Automatically save changes switch
 */
function assistantWholeChecksInstructions({ autoSave }) {
  return [
    "Use vibe64-helper plan read to obtain workflow.messageId, workflow.turnId and workflow.stage, then report one outcome before your final response through vibe64-helper plan outcome with JSON on stdin: {messageId, turnId, stage, decision, explanation, progress}.",
    `handoff: you fixed what the checks found (files changed); ${autoSave ? "Vibe64 then saves the fixes" : "the person saves the fixes with Save"}. complete: every check passed and you changed no files. continue: you ran out of room, and your next turn carries on without running the checks again. wait: a check can't run here or a failure needs the person: numbered questions, each with a recommended answer, in your final reply.`,
    "Your final reply records the result: each check you ran, with its command, whether it passed and its counts, then what you fixed and the test that proves each fix."
  ].join(" ");
}

// A message the person typed while the question was asked, instead of pressing Yes or No.
const WHOLE_CHECKS_OFFERED_NOTE = "Vibe64 had just asked the person whether to run the whole-project checks once now, on the finished plan's work, and this message came instead of Yes or No. When it asks for them (\"yes, run them\", say), run them once and fix what they find, as for any request; otherwise ignore this note.";

/** Whether a request is the turn the person's Yes started, which runs the whole-project checks. */
const assistantRunsWholeChecks = (request) => request?.wholeChecks?.status === "run";
/**
 * Whether Vibe64 is asking the person about the whole-project checks: the request that finished a plan, until the
 * person answers or a newer message replaces it.
 */
const assistantAsksWholeChecks = (request) => request?.status === "complete" && request.wholeChecks?.status === "asked" &&
  !request.stopped;

export {
  ASSISTANT_WHOLE_CHECKS_INSTRUCTION,
  PLAN_NO_WHOLE_CHECKS,
  WHOLE_CHECKS_LABEL,
  WHOLE_CHECKS_OFFERED_NOTE,
  WHOLE_CHECKS_QUESTION,
  WHOLE_CHECKS_YES_MESSAGE,
  assistantAsksWholeChecks,
  assistantRunsWholeChecks,
  assistantWholeChecksDeclinedNotice,
  assistantWholeChecksInstructions,
  assistantWholeChecksQuestionNotice
};
