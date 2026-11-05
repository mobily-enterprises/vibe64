import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */

const TRANSCRIPT_LIMIT = 12_000;
const SETUP_HANDOFF = [
  "Diagnose and repair the current workspace while preserving its existing work. Return kind=complete with a factual report as soon as the repair is ready. Vibe64 then runs its deterministic workspace preparation itself and returns any new failure to this same conversation. Do not tell the user to retry.",
  "Return kind=question only when the repair needs information only the user can provide, and ask for it. Return kind=cannot only when this cannot be repaired, and say why."
].join("\n");
const SETUP_SUCCEEDED_MESSAGE = "Workspace preparation succeeded.";
const NEEDS_ATTENTION = Object.freeze(["failed", "ambiguous", "required"]);

/** The end of a long preparation transcript, which is where its failure is. */
function recentTranscript(transcript) {
  const value = normalizeText(transcript);
  return value.length > TRANSCRIPT_LIMIT ? `[Earlier preparation output omitted.]\n${value.slice(-TRANSCRIPT_LIMIT)}` : value;
}

function setupRetryMessage(diagnostic) {
  return [
    "Vibe64 ran workspace preparation after your repair, but it did not succeed. Your edits remain. Repair only what still fails; do not start over or repeat completed work.",
    `Latest preparation diagnostic:\n${diagnostic}`,
    SETUP_HANDOFF
  ].join("\n\n");
}

/**
 * The session's own preparation state is the problem. Update owns a session whose Update failed: it prepares
 * the workspace again itself, so no preparation repair starts before it.
 * @param {{ runtime: object, sessionId: string }} context
 */
async function readSetupProblem({ runtime, sessionId }) {
  const [session, update] = await Promise.all([
    runtime.getSessionWithoutSource(sessionId),
    runtime.store.readBackgroundTask(sessionId, "update-session")
  ]);
  const setup = session.workspaceSetup || {};
  const status = normalizeText(setup.status);
  if (!NEEDS_ATTENTION.includes(status) || setup.connectedChoiceRequired === true) {
    throw new AppError(409, "Workspace preparation has no problem to fix right now.", { code: "vibe64_ai_task_no_problem" });
  }
  if (update?.status === "failed") {
    throw new AppError(409, "Fix Update first. Update prepares the workspace again.", { code: "vibe64_ai_task_update_first" });
  }
  const diagnostic = normalizeText(setup.diagnostic) || "Workspace preparation did not complete.";
  return {
    key: JSON.stringify(["workspace-setup", status, normalizeText(setup.updatedAt), diagnostic]),
    summary: diagnostic.split("\n")[0],
    details: [diagnostic, recentTranscript(setup.transcript)].filter(Boolean).join("\n\n"),
    facts: { diagnostic, transcript: recentTranscript(setup.transcript) }
  };
}

function setupBrief(problem) {
  return [
    "Workspace preparation needs attention.",
    `Diagnostic:\n${problem.facts.diagnostic}`,
    problem.facts.transcript ? `Recent preparation output:\n${problem.facts.transcript}` : "",
    SETUP_HANDOFF
  ].filter(Boolean).join("\n\n");
}

function setupContext() {
  return SETUP_HANDOFF;
}

/**
 * How preparation ended, as the task's check.
 * @param {{ ok?: boolean, code?: string, error?: string, workspaceSetup?: object | null }} result
 * @returns {AiTaskCheckResult}
 */
function setupCheckResult(result) {
  if (result?.ok === false) {
    const error = normalizeText(result.error) || "Workspace preparation could not start.";
    if (result.code === "vibe64_workspace_setup_running") return { waiting: true, message: "Preparation is already running" };
    return { passed: false, message: `Workspace preparation still needs attention: ${error}`, retryKey: "", diagnostic: error };
  }
  const setup = result.workspaceSetup || {};
  if (setup.status === "succeeded") return { passed: true, message: SETUP_SUCCEEDED_MESSAGE };
  const diagnostic = normalizeText(setup.diagnostic) || "Workspace preparation did not complete.";
  if (setup.status === "ambiguous") {
    return { passed: false, message: "Preparation needs your choice. Make it on the notice, then Check now.", retryKey: "", diagnostic };
  }
  return {
    passed: false,
    message: `Workspace preparation still fails: ${diagnostic.split("\n")[0]}`,
    retryKey: JSON.stringify([setup.status, diagnostic]),
    diagnostic
  };
}

/**
 * Fix workspace preparation: the AI repairs the workspace, then Vibe64 runs preparation itself.
 * @param {{ sessions: SessionsService }} dependencies
 * @returns {AiTaskKind}
 */
function createWorkspaceSetupKind({ sessions }) {
  return Object.freeze({
    id: "workspace-setup",
    title: "Fix workspace preparation",
    noun: "fix",
    tray: "Fixing preparation…",
    routing: "fix",
    repository: true,
    busy: "Workspace preparation is being fixed. Finish that first.",
    opening: "Fix workspace preparation.",
    problem: readSetupProblem,
    brief: setupBrief,
    context: setupContext,
    steps: ["The AI repairs the workspace", "Vibe64 prepares the workspace"],
    check: {
      by: "vibe64",
      label: "Preparing the workspace…",
      output: "Preparation output",
      // Cancel stops the preparation step that is running.
      async run({ sessionId, signal, taskId }) {
        return setupCheckResult(await sessions.retryWorkspaceSetup(sessionId, { aiTaskId: taskId, signal }, { channel: "api" }));
      },
      retry: {
        limit: 3,
        display: "Continue repairing workspace preparation.",
        message: setupRetryMessage
      }
    },
    done: SETUP_SUCCEEDED_MESSAGE
  });
}

export {
  createWorkspaceSetupKind,
  setupCheckResult
};
