import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { operationError } from "./actions.js";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

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
function createTrainingPresentationActions({ learners, content, colleague } = {}) {
  if (typeof learners?.readState !== "function" || typeof content?.readVisual !== "function" || typeof colleague?.navigate !== "function") {
    throw new TypeError("Training presentation actions require the learner, content and Colleague owners.");
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
      try {
        const saved = await learners.readState({ actor, includeCompletion: true });
        const attempt = saved.active;
        if (attempt?.attemptId !== input.attemptId || attempt.projectSlug !== (context.vibe64Action?.project?.slug || currentProjectRequestContext()?.slug) ||
            attempt.preparation.phase !== "ready" || !attempt.preparation.initialSessionId) {
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
        const result = operation === "cue-read"
          ? await colleague.readCue({ attemptId: attempt.attemptId, visualId: resource.id, cueId: input.cueId }, context)
          : await colleague.navigate({ projectSlug: attempt.projectSlug,
            sessionId: attempt.preparation.initialSessionId, pane: "preview", presentation }, context);
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
  });
  return Object.freeze([
    definition("open", {}, "Show one declared visual in this learner's prepared exercise Preview, only after a teaching request or accepted offer. Supply exact projectSlug, attemptId and visualId from the saved lesson and teaching brief. Wait for the original player's ready receipt before describing it as visible. App preview stays mounted. This does not play narration, grade an answer or prove a transition completed."),
    definition("command", { commandId: identity, name: identity, parameters: { type: "object", required: false, additionalProperties: true } },
      "Pilot a declared lesson diagram command with its exact visual/attempt/project and command ID. Reuse that ID with identical parameters for an uncertain retry; never guess a different command or re-open to replay. The initiating browser must have this visual selected. Wait for completed, not accepted, before describing the visual result. This receipt does not prove narration finished or grant an assessment pass."),
    definition("cue", { cueId: identity, commandId: identity, name: identity, parameters: { type: "object", required: false, additionalProperties: true } },
      "Arm one declared diagram transition for your next short FINAL explanation in the current admitted teaching turn. First show its exact visual/start state. This returns armed, never motion or narration completed. Then give only that explanation without another tool/progress sentence or question. The native final output ID is captured by Vibe64, not supplied by you. Motion starts on its actual audible start, or on the person's Continue with sound off. Before another cue or question, read cue.read and require completed; interruption needs an explicit requested repeat. This grants no assessment pass or autonomous follow-up."),
    definition("cue-read", { cueId: identity },
      "Read the exact live initiating-browser lesson cue. Armed/bound/accepted is not completion. Only a completed receipt means its actual visual and required audio finished, or the person explicitly continued without sound. Missing/reloaded/retired cues require explicit recovery; do not replay or start another model turn from playback alone. This read saves no learning result."),
    definition("snapshot", {}, "Read the original displayed player's semantic snapshot for the exact lesson attempt/visual/project. It records state, paused and bounded labels without SVG, controller code or pixels. This read neither persists learning progress nor grades it. A hidden visual is not claimed visible and a saved snapshot is not current playback completion.")
  ]);
}

export { createTrainingPresentationActions };
