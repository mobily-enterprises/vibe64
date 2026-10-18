import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

const TRAINING_CODE_FILE_SAVE_ACTION = "vibe64.training.code.file.save";
const text = { type: "string", noTrim: true, required: false };

// A lesson's Code tab saves through this learner-scoped action. The generic
// source editor performs the save; Training records it in the authorship ledger.
function createTrainingCodeEditorActions({ authorship, sourceEditor } = {}) {
  if (typeof sourceEditor?.saveFile !== "function") return [];
  if (typeof authorship?.saveLearnerFile !== "function") throw new TypeError("Lesson code saves require the original authorship owner.");
  return [withVibe64ActionContext({
    id: TRAINING_CODE_FILE_SAVE_ACTION, version: 1, kind: "command", idempotency: "optional",
    channels: ["api"], surfaces: ["app"], extensions: { assistant: { exclude: true } },
    input: { mode: "create", schema: createSchema({
      sessionId: { ...text, required: true, minLength: 1, maxLength: 256 },
      path: { ...text, required: true, minLength: 1, maxLength: 4096 },
      baseHash: { ...text, required: true, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" },
      text: { ...text, required: true }, originId: text
    }) }, output: null,
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      const learning = context.vibe64Action?.learning;
      if (!actor || learning?.learningScope?.noExercise !== false) {
        throw Object.assign(new Error("Save lesson code only in this learner's prepared practice lesson."), {
          code: "VIBE64_TRAINING_CODE_UNADMITTED", statusCode: 409 });
      }
      return authorship.saveLearnerFile({ actor, attemptId: learning.learningScope.attemptId, input,
        save: () => sourceEditor.saveFile(input) });
    }
  }, { learningAccess: "control" })];
}

function registerTrainingCodeEditorRoutes(http) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 lesson code routes only accept loopback Studio requests.",
    projectScoped: false, routeRelativePath: "learning/:learningAttemptId/vibe64", routeSurface: "app",
    tags: ["studio", "vibe64-training"]
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    actionId: TRAINING_CODE_FILE_SAVE_ACTION, bodyLimit: 2 * 1024 * 1024,
    summary: "Autosave an existing source file of this lesson's practice project and record the learner's authorship.",
    buildInput(request) {
      // The editor also sends its page project; the saved attempt selects the project here.
      const { vibe64User: _user, projectSlug: _project, learningAttemptId: _attempt, ...body } = routes.requestBody(request);
      void _user; void _project; void _attempt;
      return { ...body, sessionId: request.params.sessionId, learningAttemptId: request.params.learningAttemptId };
    }
  });
}

export { TRAINING_CODE_FILE_SAVE_ACTION, createTrainingCodeEditorActions, registerTrainingCodeEditorRoutes };
