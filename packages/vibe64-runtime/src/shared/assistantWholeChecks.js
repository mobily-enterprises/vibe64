import { AFTER_PLAN_PASS_TITLES } from "./assistantFinishing.js";

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
 *
 * Genesis records a pass only after its whole-suite run passed with the
 * person's OK, so a plan's passes that Genesis records (run over the whole app,
 * since their last completion or deeply) are not recorded in their own turns:
 * the question holds their ids (`passes`), and the turn the Yes starts records
 * them once every check passes. After No, or another message, they stay unrecorded.
 */

// No step of a plan runs the whole-project checks; Vibe64 offers them to the person once the plan is finished.
const PLAN_NO_WHOLE_CHECKS = "No step of a plan runs the whole-project checks (such as one whole run of the test suite): not an implementation turn, not Senior's review and not a pass. Once the plan is finished and saved, Vibe64 asks the person whether to run them once, so never ask about them yourself.";

// The plan's passes by title, in a sentence: "Deslop", or "Security pass and Deslop".
function passTitles(passes) {
  const titles = passes.map((id) => AFTER_PLAN_PASS_TITLES[id] || id);
  return titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

// The person knows the whole-project checks as the full test suite. The question Vibe64 asks once a plan is finished,
// in the chat and above the message box with its Yes and No.
const WHOLE_CHECKS_QUESTION = "Run the full test suite?";
// What the Yes sends as the person's message: an ordinary request, as a release before this one reads it too when it
// resumes that turn. The session has no current plan by then, and nothing about the plan rides on it.
const WHOLE_CHECKS_YES_MESSAGE = "Run the full test suite.";
const WHOLE_CHECKS_LABEL = "Full test suite";

/**
 * The chat note Vibe64 writes once a plan is finished (completed, archived and,
 * with Automatically save changes on, after the save's own note): the question
 * the Yes and No above the message box answer.
 * @param {string} key the turn that finished the plan
 */
function assistantWholeChecksQuestionNotice(key) {
  return {
    messageId: `assistant-whole-checks:${key}`,
    text: WHOLE_CHECKS_QUESTION
  };
}

/** The note No writes: nothing runs, and Vibe64 never asks again for this plan. */
function assistantWholeChecksDeclinedNotice(key, { passes = [] } = {}) {
  return {
    messageId: `assistant-whole-checks-declined:${key}`,
    text: "Full test suite not run. Vibe64 won't ask again for this plan." +
      (passes.length ? ` ${passTitles(passes)} ${passes.length === 1 ? "stays" : "stay"} unrecorded as completed, since the full test suite didn't run.` : "")
  };
}

/**
 * What the turn the person's Yes starts is told to do: run the project's Verification once, as it is, fix what it
 * finds, and report the results plainly. It is an ordinary request on a session with no current plan, so it is told
 * nothing about the plan.
 */
const ASSISTANT_WHOLE_CHECKS_INSTRUCTION = [
  "Run each entry of the project's Verification once (the checks its Stack declares there, such as one whole run of the test suite), each through its own command, in this session, never detached to outlive it.",
  "Never run them a second time in this request: after a fix, run the focused tests for what you changed.",
  "Fix what they find: a failing or flaky test is a defect to fix, each fix proven by a test that failed first. Explain every failure; never call one pre-existing or environmental: a missing tool or an environment's refusal is a defect to fix, reported with what is missing.",
  "Preserve unrelated work and staged changes. Do not commit, push or deploy.",
  "The person calls this the full test suite. Report the results plainly: what ran and how it went. Don't narrate the process."
].join(" ");

/**
 * How that turn ends and what it reports, and the plan's passes it records once every check passes.
 * @param {{ autoSave: boolean, passes?: string[] }} options autoSave: the chat's Automatically save changes switch;
 *   passes: the ids of the plan's passes Genesis records, which waited for this run
 */
function assistantWholeChecksInstructions({ autoSave, passes = [] }) {
  const record = passes.length
    ? `Once every check passes, record the ${passes.length === 1 ? "pass" : "passes"} ${passTitles(passes)} as completed, which waited for this run: take the Genesis \`passes done\` operation for ${passes.map((id) => `\`${id}\``).join(", ")}, one pass each, invoked as each pass's skill says, and leave the records with your other changes. Record none while a check fails. `
    : "";
  return [
    "Use vibe64-helper plan read to obtain workflow.messageId, workflow.turnId and workflow.stage, then report one outcome before your final response through vibe64-helper plan outcome with JSON on stdin: {messageId, turnId, stage, decision, explanation, progress}.",
    `${record}handoff: you fixed what the checks found${passes.length ? ` or recorded ${passes.length === 1 ? "that pass" : "those passes"}` : ""} (files changed); ${autoSave ? "Vibe64 then saves the fixes" : "the person saves the fixes with Save"}. complete: every check passed and you changed no files. continue: you ran out of room, and your next turn carries on without running the checks again. wait: a check can't run here or a failure needs the person: numbered questions, each with a recommended answer, in your final reply.`,
    "Your final reply records the result: each check you ran, with its command, whether it passed and its counts, then what you fixed and the test that proves each fix."
  ].join(" ");
}

// A message the person typed while the question was asked, instead of pressing Yes or No.
const WHOLE_CHECKS_OFFERED_NOTE = "Vibe64 had just asked the person whether to run the full test suite, and this message came instead of Yes or No. When it asks for it (\"yes, run it\", say), run each entry of the project's Verification once and fix what it finds, as for any request; otherwise ignore this note.";

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
