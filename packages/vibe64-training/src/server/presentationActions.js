import { isDeepStrictEqual } from "node:util";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { operationError } from "./actions.js";
import { requireTrainingMainTeacher } from "./teachingRole.js";
import { TRAINING_GUIDE_TARGETS, trainingGuideRequest } from "../shared/guideTargets.js";

const identity = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 64, pattern: "^[a-zA-Z0-9-]{1,64}$" };
const fields = {
  attemptId: { ...identity, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
  visualId: { ...identity, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" }
};
const output = { mode: "replace", schema: createSchema({
  ok: { type: "boolean", required: true },
  error: { type: "string", required: false, maxLength: 2000 },
  focus: { type: "object", required: false, additionalProperties: true },
  presentation: { type: "object", required: false, additionalProperties: true }
}) };

// Teaching chooses a declared operation. The original Colleague navigation
// receipt waits for the initiating browser and the original sandbox player.
function createTrainingPresentationActions({ learners, content } = {}) {
  if (typeof learners?.readState !== "function" || typeof content?.readVisual !== "function") {
    throw new TypeError("Training presentation actions require the learner and content owners.");
  }
  const definition = (operation, extra, description) => withVibe64ActionContext({
    id: `vibe64.training.visual.${operation === "cue-read" ? "cue.read" : operation}`,
    version: 1,
    kind: ["snapshot", "cue-read"].includes(operation) ? "query" : "command",
    input: { mode: "create", schema: createSchema({ ...fields, ...extra }) }, output: null, idempotency: "none",
    extensions: { assistant: { description, output } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Sign in before showing a lesson presentation."), { statusCode: 401, code: "vibe64_auth_required" });
      const coordinator = requireTrainingMainTeacher(context, ["requirePresentationAttempt",
        operation === "cue-read" ? "readPresentationCue" : "navigatePresentation"]);
      try {
        const mainScope = await coordinator.requirePresentationAttempt(input.attemptId);
        const saved = await learners.readState({ actor, attemptId: input.attemptId, includeCompletion: true });
        const attempt = saved.active;
        if (attempt?.attemptId !== input.attemptId || !isDeepStrictEqual(mainScope.pin, attempt.pin) ||
            (mainScope.noExercise !== true && (mainScope.noExercise !== false ||
              attempt.preparation.phase !== "ready" || !attempt.preparation.initialSessionId ||
              attempt.projectSlug !== mainScope.projectSlug || attempt.preparation.initialSessionId !== mainScope.sessionId))) {
          throw Object.assign(new Error("Use the signed-in learner's current prepared exercise project and exact attempt."), {
            code: "VIBE64_TRAINING_PRESENTATION_ATTEMPT_MISMATCH", statusCode: 409
          });
        }
        const resource = await content.readVisual({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code,
          lessonHash: attempt.pin.lesson.hash, visualId: input.visualId });
        const presentation = { operation, attemptId: attempt.attemptId, visualId: resource.id };
        if (["command", "cue"].includes(operation)) {
          const declared = resource.visual.commands.find(command => command.name === input.name);
          const parameters = input.parameters || {};
          if (!declared || Object.keys(parameters).some(key => !declared.parameters.some(parameter => parameter.name === key)) ||
              declared.parameters.some(parameter => (parameters[parameter.name] === undefined && parameter.required) ||
                (parameters[parameter.name] !== undefined && (typeof parameters[parameter.name] !== "string" ||
                  !parameters[parameter.name].trim() || parameters[parameter.name].length > parameter.maxLength ||
                  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
                  /[\u0000-\u001f\u007f]/u.test(parameters[parameter.name]))))) {
            throw Object.assign(new Error("Use a command and bounded parameters declared by this exact lesson visual."), {
              code: "VIBE64_TRAINING_PRESENTATION_COMMAND_INVALID", statusCode: 422
            });
          }
          Object.assign(presentation, { commandId: input.commandId, name: declared.name, parameters });
        }
        if (operation === "cue") presentation.cueId = input.cueId;
        await coordinator.requirePresentationAttempt(input.attemptId);
        const result = operation === "cue-read"
          ? await coordinator.readPresentationCue({ attemptId: attempt.attemptId, visualId: resource.id, cueId: input.cueId }, context)
          : await coordinator.navigatePresentation(presentation, context);
        if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) {
          throw Object.assign(new Error("The presentation receipt exceeds its limit; no state was silently omitted."), {
            code: "VIBE64_TRAINING_PRESENTATION_RESULT_TOO_LARGE"
          });
        }
        return result;
      } catch (cause) {
        throw operationError(cause);
      }
    }
  }, { learningAccess: ["snapshot", "cue-read"].includes(operation) ? "observe" : "write" });
  const view = withVibe64ActionContext({
    id: "vibe64.training.view.open", version: 1, kind: "command", idempotency: "none",
    input: { mode: "create", schema: createSchema({ attemptId: fields.attemptId,
      target: { type: "string", required: true, enum: TRAINING_GUIDE_TARGETS },
      filePath: { type: "string", required: false, noTrim: true, minLength: 1, maxLength: 512 },
      navigate: { type: "boolean", required: false },
      highlight: { type: "boolean", required: false } }) },
    output: null,
    extensions: { assistant: { output,
      description: "As the bound Main teacher, guide this learner to a real place in their lesson's Vibe64 workspace: preview (app Preview tab), dashboard (Dashboard tab), database-erd (Dashboard → Database → ERD), database-data (Dashboard → Database → Data), files (Dashboard → Files; optional filePath opens one practice-project file, relative, no '..'), changes (Current changes), git-log (Git log), session-info (Session info), architecture (Architecture), or learning (the Learning pane with this lesson). Default is point only (navigate=false, highlight=true): Vibe64 rings the next control the learner must click, with a short caption such as \"Dashboard → Database → ERD\", for about 8 seconds or until they click; the learner then navigates themselves, which Watch me can observe. Prefer pointing so the learner learns where things are. navigate=true is \"show me\": you open the view yourself; its acknowledgement is demonstration, not learner evidence, and dashboard cannot be opened (open a section instead). workspace-preview and workspace-erd are older names that open preview/database-erd. Supply only the bound attemptId; Vibe64 derives its project/session and initiating browser. The receipt's guide.shown is true only when the highlight was actually drawn; shown=false with a reason (for example target-hidden on a phone layout) means nothing was highlighted, so tell the learner the path in words instead. A source-less lesson can only use learning. This does not start, resume, end or grade a lesson. Wait for the actual settled receipt before describing a view or highlight as visible." } },
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Sign in before navigating a lesson workspace."), { statusCode: 401, code: "vibe64_auth_required" });
      const coordinator = requireTrainingMainTeacher(context, ["requirePresentationAttempt", "navigateLearningView"]);
      // A closed product place, validated before any browser effect; its message tells the teacher what to change.
      const request = trainingGuideRequest(input);
      try {
        const mainScope = await coordinator.requirePresentationAttempt(input.attemptId);
        const saved = await learners.readState({ actor, attemptId: input.attemptId, includeCompletion: true });
        const attempt = saved.active;
        if (attempt?.attemptId !== input.attemptId || !isDeepStrictEqual(mainScope.pin, attempt.pin) ||
            (mainScope.noExercise !== true && (mainScope.noExercise !== false ||
              attempt.preparation.phase !== "ready" || !attempt.preparation.initialSessionId ||
              attempt.projectSlug !== mainScope.projectSlug || attempt.preparation.initialSessionId !== mainScope.sessionId))) {
          throw Object.assign(new Error("Use the signed-in learner's current prepared exercise project and exact attempt."), {
            code: "VIBE64_TRAINING_PRESENTATION_ATTEMPT_MISMATCH", statusCode: 409
          });
        }
        if (mainScope.noExercise && request.target !== "learning") {
          throw Object.assign(new Error("This source-less lesson has no project workspace to display."), {
            code: "VIBE64_TRAINING_WORKSPACE_UNAVAILABLE", statusCode: 409
          });
        }
        const result = await coordinator.navigateLearningView(request, context);
        if (Buffer.byteLength(JSON.stringify(result)) > 16 * 1024) {
          throw Object.assign(new Error("The navigation receipt exceeds its limit; no state was silently omitted."), {
            code: "VIBE64_TRAINING_PRESENTATION_RESULT_TOO_LARGE"
          });
        }
        return result;
      } catch (cause) { throw operationError(cause); }
    }
  }, { projectScoped: false, learningAccess: "write" });
  return Object.freeze([
    view,
    definition("open", {}, "As the Main teacher, show one declared visual in this learner's selected lesson Presentation, only after a teaching request or accepted offer. Supply exact attemptId and visualId from the saved lesson and teaching brief; Vibe64 derives the current Main conversation and browser. No-exercise lessons need no project. Unsupported practice presentation must be reported truthfully. Wait for the original player's ready receipt before describing it as visible. App preview stays mounted. This does not play narration, grade an answer or prove a transition completed."),
    definition("command", { commandId: identity, name: identity, parameters: { type: "object", required: false, additionalProperties: true } },
      "As the Main teacher, pilot a declared lesson diagram command with its exact visual/attempt and command ID; Vibe64 derives the current conversation and browser. Reuse that ID with identical parameters for an uncertain retry; never guess a different command or re-open to replay. The initiating browser must have this visual selected. Wait for completed, not accepted, before describing the visual result. This receipt does not prove narration finished or grant an assessment pass."),
    definition("cue", { cueId: identity, commandId: identity, name: identity, parameters: { type: "object", required: false, additionalProperties: true } },
      "Arm one declared diagram transition for your next short FINAL explanation in the current admitted teaching turn. First show its exact visual/start state. This returns armed, never motion or narration completed. Then give only that explanation without another tool/progress sentence or question. The native final output ID is captured by Vibe64, not supplied by you. Motion starts on its actual audible start, or on the person's Continue with sound off. Before another cue or question, read cue.read and require completed; interruption needs an explicit requested repeat. This grants no assessment pass or autonomous follow-up."),
    definition("cue-read", { cueId: identity },
      "Read the exact live initiating-browser lesson cue. Armed/bound/accepted is not completion. Only a completed receipt means its actual visual and required audio finished, or the person explicitly continued without sound. Missing/reloaded/retired cues require explicit recovery; do not replay or start another model turn from playback alone. This read saves no learning result."),
    definition("snapshot", {}, "Read the original displayed player's semantic snapshot for the exact lesson attempt/visual/project. It records state, paused and bounded labels without SVG, controller code or pixels. This read neither persists learning progress nor grades it. A hidden visual is not claimed visible and a saved snapshot is not current playback completion.")
  ]);
}

export { createTrainingPresentationActions };
