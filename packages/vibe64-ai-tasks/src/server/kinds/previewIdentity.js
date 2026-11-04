import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const IDENTITY_HANDOFF = [
  "Ensure the application's own idempotent development seed creates this user profile and any workspace membership the app requires in every fresh database, then run the normal database preparation command. Keep preview authentication material host-managed; do not add, reveal, or hardcode Vibe64 secrets.",
  "Return kind=complete with a factual report once the repair is ready. Vibe64 then signs in as this identity itself and returns any new failure to this same conversation. Return kind=question only when you need an actual user decision. Return kind=cannot only when this cannot be repaired, and say why."
].join("\n");
// Sign-in refused for a reason only a person can settle. The AI is not asked again.
const PERSON_MESSAGES = Object.freeze({
  vibe64_preview_identity_preview_not_ready: "Preview isn't running. Start it, then Check now.",
  vibe64_preview_application_identity_unsupported: "This preview can't switch identity. Restart Preview, then Check now.",
  vibe64_preview_identity_command_unavailable: "This preview can't switch identity. Restart Preview, then Check now."
});

function identityRetryMessage(diagnostic) {
  return [
    "Vibe64 tried this preview identity after your repair, and the application still rejected it. Your edits remain. Repair only what still fails.",
    `Latest sign-in diagnostic:\n${diagnostic}`,
    IDENTITY_HANDOFF
  ].join("\n\n");
}

/**
 * The failed sign-in the person saw is the problem: the identity exchange happens in their Preview.
 * @param {{ runtime: object, sessionId: string }} _context
 * @param {{ identity?: { name?: string, type?: string, value?: string }, error?: string }} input
 */
async function readIdentityProblem(_context, input) {
  const identity = input.identity || {};
  const name = normalizeText(identity.name);
  if (!name) throw new AppError(400, "Choose the preview identity that failed.", { code: "vibe64_ai_task_no_problem" });
  const error = normalizeText(input.error) || "The application rejected the identity.";
  return {
    key: JSON.stringify(["preview-identity", normalizeText(identity.type), normalizeText(identity.value), error]),
    summary: `Preview couldn't sign in as ${name}.`,
    details: error,
    facts: { name, type: normalizeText(identity.type) || "selector", value: normalizeText(identity.value) || "unknown", error }
  };
}

function identityBrief({ facts }) {
  return [
    `The managed preview could not sign in as \`${facts.name}\` (${facts.type}: \`${facts.value}\`):`,
    facts.error,
    "Please diagnose and fix this in the current application.",
    IDENTITY_HANDOFF
  ].join("\n\n");
}

function identityContext() {
  return IDENTITY_HANDOFF;
}

/**
 * What the application's answer means for its task.
 * @param {string} name
 * @param {{ ok?: boolean, code?: string, error?: string }} result
 * @returns {AiTaskCheckResult}
 */
function identityCheckResult(name, result) {
  if (result?.ok !== false) return { passed: true, message: `Preview accepts ${name} now. Choose it again to sign in.` };
  const code = normalizeText(result.code);
  const error = normalizeText(result.error) || "The application rejected the identity.";
  const person = PERSON_MESSAGES[code];
  return {
    passed: false,
    message: person || `Preview still can't sign in as ${name}: ${error}`,
    retryKey: person ? "" : JSON.stringify([code, error]),
    diagnostic: error
  };
}

/**
 * Fix preview sign-in: the AI repairs the app's seed, then Vibe64 signs in as that identity itself.
 * @param {{ terminals: TerminalsService }} dependencies
 * @returns {AiTaskKind}
 */
function createPreviewIdentityKind({ terminals }) {
  return Object.freeze({
    id: "preview-identity",
    title: "Fix preview sign-in",
    noun: "fix",
    tray: "Fixing sign-in…",
    routing: "fix",
    repository: true,
    busy: "Preview sign-in is being fixed. Finish that first.",
    opening: "Fix preview sign-in.",
    problem: readIdentityProblem,
    brief: identityBrief,
    context: identityContext,
    steps: ["The AI repairs the app's seed", "Vibe64 signs in as this identity"],
    check: {
      by: "vibe64",
      label: "Signing in…",
      // Signing in prints nothing worth reading; its answer is the check's message.
      output: "",
      unstoppable: "Signing in can't be interrupted. The fix ends as soon as it finishes.",
      async run({ sessionId }, task) {
        const { name } = task.problem.facts;
        return identityCheckResult(name, await terminals.verifyPreviewIdentity(sessionId, { identityName: name }));
      },
      retry: {
        limit: 3,
        display: "Continue repairing preview sign-in.",
        message: identityRetryMessage
      }
    },
    done: "Preview accepts this identity now. Choose it again to sign in."
  });
}

export {
  createPreviewIdentityKind,
  identityCheckResult
};
