import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { mainConversationRequestContext } from "@local/vibe64-sessions/server/main-conversation-authority";
import { presentationClientId, presentationReceipt, presentationCueReceipt } from "../shared/presentationSchemas.js";

const TRAINING_MAIN_PRESENTATION_ACTION = "vibe64.training.presentation.read";
const TRAINING_MAIN_PRESENTATION_FOCUS_ACTION = "vibe64.training.presentation.focus.update";
const TRAINING_MAIN_PRESENTATION_ACK_ACTION = "vibe64.training.presentation.acknowledge";
const sessionId = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128 };
// These are display reports, never source, native execution or practical proof.
const focus = { type: "object", required: false, schema: createSchema({
  projectSlug: { type: "string", required: false, noTrim: true, maxLength: 128, pattern: "^[a-zA-Z0-9_-]*$" },
  sessionId: { ...sessionId, required: false },
  pane: { type: "string", required: true, enum: ["session", "preview"] },
  previewScreen: { type: "string", required: false, enum: ["existing-project-setup", "new-project-setup", "checking-project-setup", "outputs", "outputs-with-setup-warning", "lesson-presentation"] }
}) };

function createTrainingMainPresentationActions({ project, actions } = {}) {
  if (typeof project?.createRuntime !== "function" || typeof actions?.execute !== "function") {
    throw new TypeError("Main presentation requires the original Project and action authority owners.");
  }
  function definition(id, operation, fields, access) {
    return withVibe64ActionContext({
      id, version: 1, kind: operation === "read" ? "query" : "command", idempotency: "none",
      channels: ["api"], surfaces: ["app"], extensions: { assistant: { exclude: true } },
      input: { mode: "create", schema: createSchema({ sessionId, clientId: presentationClientId, ...fields }) }, output: null,
      async execute(input, context) {
        const learning = context.vibe64Action?.learning;
        const actor = authenticatedVibe64User(context);
        if (!actor || typeof learning?.learningScope?.noExercise !== "boolean") {
          throw Object.assign(new Error("Use this learner’s authorized pinned lesson conversation."), {
            statusCode: 409, code: "VIBE64_TRAINING_MAIN_UNADMITTED"
          });
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        if (typeof runtime.learningScope?.noExercise !== "boolean" || !runtime.learningTeaching) {
          throw Object.assign(new Error("Main presentation is unavailable for this saved lesson conversation."), {
            statusCode: 409, code: "VIBE64_TRAINING_MAIN_UNADMITTED"
          });
        }
        const current = { browserAuthority: { sessionId: input.sessionId,
          learningAttemptId: learning.learningScope.attemptId, actorId: context.actor.id,
          requestContext: mainConversationRequestContext(context) }, signal: context.signal };
        const result = await runtime.learningTeaching[operation === "read" ? "readPresentation"
          : operation === "focus" ? "focusPresentation" : "acknowledgePresentation"]({
          runtime, sessionId: input.sessionId, input, context: current, actions
        });
        if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) {
          throw Object.assign(new Error("The presentation report exceeds its limit; no facts were omitted."), {
            code: "VIBE64_TRAINING_PRESENTATION_RESULT_TOO_LARGE", statusCode: 413
          });
        }
        return result;
      }
    }, { projectScoped: false, learningAccess: access });
  }
  return [definition(TRAINING_MAIN_PRESENTATION_ACTION, "read", {}, "observe"),
    definition(TRAINING_MAIN_PRESENTATION_FOCUS_ACTION, "focus", { focus: { ...focus, required: true } }, "observe"),
    definition(TRAINING_MAIN_PRESENTATION_ACK_ACTION, "ack", {
      commandId: presentationClientId, ok: { type: "boolean", required: true },
      error: { type: "string", required: false, maxLength: 2000 }, focus,
      presentation: presentationReceipt, cue: presentationCueReceipt
    }, "write")];
}

export { TRAINING_MAIN_PRESENTATION_ACTION, TRAINING_MAIN_PRESENTATION_FOCUS_ACTION,
  TRAINING_MAIN_PRESENTATION_ACK_ACTION, createTrainingMainPresentationActions };
