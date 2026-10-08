import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { mainConversationRequestContext } from "@local/vibe64-sessions/server/main-conversation-authority";
import { trainingObservationFields } from "../shared/practicalSchemas.js";

const TRAINING_MAIN_PRACTICAL_OBSERVATION_ACTION = "vibe64.training.practical.observe-native";
function createTrainingMainPracticalActions({ project, actions } = {}) {
  if (!project?.createRuntime || !actions?.execute) throw new TypeError("Main practical observations require original Project and action authority owners.");
  const { conversationId: _legacyConversationId, ...fields } = trainingObservationFields;
  return [withVibe64ActionContext({ id: TRAINING_MAIN_PRACTICAL_OBSERVATION_ACTION, version: 1,
    kind: "command", idempotency: "domain_native", channels: ["api"], surfaces: ["app"],
    extensions: { assistant: { exclude: true } },
    input: { mode: "create", schema: createSchema({ ...fields,
      sessionId: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128 } }) }, output: null,
    async execute(input, context) {
      const actor = authenticatedVibe64User(context), learning = context.vibe64Action?.learning;
      if (!actor || learning?.learningScope?.noExercise !== false || input.reference.attemptId !== learning.learningScope.attemptId) {
        throw Object.assign(new Error("Use this learner's exact prepared practical lesson and delivered question."), {
          code: "VIBE64_TRAINING_MAIN_UNADMITTED", statusCode: 409 });
      }
      const runtime = await project.createRuntime({ inspectSource: false });
      if (runtime.learningScope?.noExercise !== false || !runtime.learningTeaching?.observeTrainingPractical) {
        throw Object.assign(new Error("This saved lesson's practical observer is unavailable."), {
          code: "VIBE64_TRAINING_MAIN_UNAVAILABLE", statusCode: 503 });
      }
      return runtime.learningTeaching.observeTrainingPractical({ runtime, sessionId: input.sessionId, input, actions,
        context: { signal: context.signal, browserAuthority: { sessionId: input.sessionId,
          learningAttemptId: learning.learningScope.attemptId, actorId: context.actor.id,
          requestContext: mainConversationRequestContext(context) } } });
    }
  }, { projectScoped: false, learningAccess: "write" })];
}
export { TRAINING_MAIN_PRACTICAL_OBSERVATION_ACTION, createTrainingMainPracticalActions };
