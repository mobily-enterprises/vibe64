import { AppError } from "@jskit-ai/kernel/server/runtime";
import { projectOnboardingRequest } from "@local/vibe64-project/shared/onboardingRequest";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const SETUP_HANDOFF = [
  "Return kind=complete with a factual report as soon as the project's setup is done. Vibe64 then inspects the project itself and returns anything still unset to this same conversation.",
  "Return kind=question whenever you need the person's answer, and ask that specific question. Return kind=cannot only when this cannot be done, and say why."
].join("\n");
// Each request a person can make, and the inspection state it answers.
const MODES = Object.freeze({
  repair: { state: "attention", noun: "fix" },
  create: { state: "new", noun: "task" },
  adopt: { state: "adoption", noun: "task" },
  inspect: { state: "adoption", noun: "task" }
});
// States that still need setup: anything else is a project ready to work on.
const UNSET_STATES = Object.freeze(["attention", "new", "adoption"]);
const READY_MESSAGE = "Project setup is ready.";
const UPDATE_FIRST_MESSAGE = "Project setup waits for Update. Fix Update first, then Check now.";

const text = value => String(value || "").trim();
const diagnosticsOf = inspection => (inspection?.diagnostics || []).map(({ message }) => text(message)).filter(Boolean);

function setupRetryMessage(diagnostic) {
  return [
    "Vibe64 inspected the project after your work, and its setup still needs attention. Your edits remain. Fix only what is still unset.",
    `Latest inspection:\n${diagnostic}`,
    SETUP_HANDOFF
  ].join("\n\n");
}

/**
 * How the inspection reads after the AI's work.
 * @param {{ ok?: boolean, code?: string, error?: string, inspection?: object, updateFirst?: object | null }} onboarding
 * @returns {AiTaskCheckResult}
 */
function setupCheckResult(onboarding) {
  if (onboarding?.ok === false) {
    const error = text(onboarding.error) || "Project setup could not be read.";
    return { passed: false, message: `Project setup could not be read: ${error}`, retryKey: JSON.stringify([onboarding.code, error]), diagnostic: error };
  }
  const state = text(onboarding?.inspection?.state);
  if (!UNSET_STATES.includes(state)) return { passed: true, message: READY_MESSAGE };
  if (onboarding.updateFirst) return { passed: false, message: UPDATE_FIRST_MESSAGE, retryKey: "", diagnostic: UPDATE_FIRST_MESSAGE };
  const diagnostic = diagnosticsOf(onboarding.inspection).join("\n") || "The project still has no setup.";
  return {
    passed: false,
    message: `Project setup still needs attention: ${diagnostic.split("\n")[0]}`,
    retryKey: JSON.stringify([state, diagnostic]),
    diagnostic
  };
}

function setupBrief(problem) {
  return [problem.facts.message, SETUP_HANDOFF].join("\n\n");
}

function setupContext() {
  return SETUP_HANDOFF;
}

/**
 * Project setup: the AI repairs, adopts, inspects or starts the project, then Vibe64 inspects it itself.
 * @param {{ project: ProjectService }} dependencies
 * @returns {AiTaskKind}
 */
function createProjectSetupKind({ project }) {
  /**
   * The setup screen's state is the problem; the person's request picks which one, with what they said.
   * Setup that can't be read at all is a problem to repair too.
   * @param {{ runtime: object, sessionId: string }} context
   * @param {{ mode?: string, purpose?: string }} input
   */
  async function readSetupProblem({ sessionId }, input) {
    const mode = text(input.mode);
    const expected = MODES[mode];
    if (!expected) throw new AppError(400, "Choose what to do with this project's setup.", { code: "vibe64_ai_task_no_problem" });
    const onboarding = await project.readOnboarding({ sessionId });
    const unreadable = onboarding?.ok === false;
    const inspection = unreadable ? { state: "attention", diagnostics: [], nextAction: "" } : onboarding?.inspection;
    if (inspection?.state !== expected.state) {
      throw new AppError(409, "Project setup has nothing to do for this right now.", { code: "vibe64_ai_task_no_problem" });
    }
    if (mode === "repair" && onboarding.updateFirst) {
      throw new AppError(409, "Fix Update first. Project setup waits for it.", { code: "vibe64_ai_task_update_first" });
    }
    const diagnostics = unreadable ? [text(onboarding.error) || "Project setup could not be read."] : diagnosticsOf(inspection);
    const purpose = text(input.purpose).slice(0, 2000);
    let request;
    try {
      request = projectOnboardingRequest(mode, { purpose, diagnostic: diagnostics.join(" "), nextAction: inspection.nextAction });
    } catch (error) {
      throw new AppError(400, error.message, { code: "vibe64_ai_task_no_problem" });
    }
    return {
      key: JSON.stringify(["project-setup", mode, diagnostics, purpose]),
      summary: mode === "repair" ? diagnostics[0] || "Project setup needs attention." : request.displayMessage,
      details: diagnostics.join("\n") || request.displayMessage,
      facts: { mode, message: request.message },
      title: request.title,
      noun: expected.noun,
      opening: request.displayMessage
    };
  }

  return Object.freeze({
    id: "project-setup",
    title: "Set up the project",
    noun: "task",
    tray: "Setting up the project…",
    routing: "fix",
    repository: true,
    busy: "The project's setup is being worked on. Finish that first.",
    opening: "Set up this project.",
    problem: readSetupProblem,
    brief: setupBrief,
    context: setupContext,
    steps: ["The AI sets up the project", "Vibe64 inspects the project"],
    check: {
      by: "vibe64",
      label: "Inspecting the project…",
      output: "",
      unstoppable: "Inspecting can't be interrupted. The task ends as soon as it finishes.",
      async run({ sessionId }) {
        return setupCheckResult(await project.readOnboarding({ sessionId }));
      },
      retry: {
        limit: 3,
        display: "Continue with what the project's setup still needs.",
        message: setupRetryMessage
      }
    },
    done: READY_MESSAGE
  });
}

export {
  createProjectSetupKind,
  setupCheckResult
};
