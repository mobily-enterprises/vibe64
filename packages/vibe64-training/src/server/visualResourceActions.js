import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const TRAINING_VISUAL_RESOURCE_ACTION = "vibe64.training.visual-resource.read";
// The original lesson bundle permits 32 MiB; base64 expansion and metadata
// remain bounded without reducing that original file contract.
const MAX_RESOURCE_BYTES = 48 * 1024 * 1024;

function createTrainingVisualResourceActions({ learners, content } = {}) {
  if (typeof learners?.readState !== "function" || typeof content?.readVisual !== "function") {
    throw new TypeError("Visual resource reads require the original learner and installed content owners.");
  }
  return [withVibe64ActionContext({
    id: TRAINING_VISUAL_RESOURCE_ACTION, version: 1, kind: "query", idempotency: "none",
    channels: ["api"], surfaces: ["app"],
    input: { mode: "create", schema: createSchema({
      attemptId: { type: "string", required: true, noTrim: true, maxLength: 36,
        pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
      visualId: { type: "string", required: true, noTrim: true, maxLength: 64,
        pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" }
    }) }, output: null,
    extensions: { assistant: { exclude: true } },
    async execute({ attemptId, visualId }, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in to Vibe64 before reading your lesson diagram."), {
        code: "vibe64_auth_required", statusCode: 401
      });
      const state = await learners.readState({ actor, attemptId, includeCompletion: true });
      // The reader shows ended lessons too, so any of this learner's retained
      // attempts may read its pinned diagram.
      const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
      if (!attempt) {
        throw Object.assign(new Error("Read one of this learner's exact saved attempts before requesting its diagram."), {
          code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 404
        });
      }
      const { pin } = attempt;
      const resource = await content.readVisual({ ...pin.topic, lessonCode: pin.lesson.code,
        lessonHash: pin.lesson.hash, visualId });
      const savedVisual = attempt.learning?.resume?.visuals.find(item => item.visualId === visualId);
      const encode = file => ({ path: file.path, encoding: "base64", bytes: file.bytes.toString("base64") });
      const result = {
        pin: resource.pin, lessonCode: resource.lessonCode, lessonHash: resource.lessonHash,
        revision: state.revision,
        ...(savedVisual ? { snapshot: savedVisual.snapshot } : {}),
        id: resource.id, descriptorPath: resource.descriptorPath, visual: resource.visual,
        svg: encode(resource.svg), controller: encode(resource.controller), assets: resource.assets.map(encode)
      };
      if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESOURCE_BYTES) {
        throw Object.assign(new Error("The verified lesson diagram exceeds its transport limit. Ask the owner to inspect the pinned content; no files were omitted."), {
          code: "VIBE64_TRAINING_VISUAL_RESOURCE_TOO_LARGE", statusCode: 413
        });
      }
      return result;
    }
  }, { projectScoped: false })];
}

export { TRAINING_VISUAL_RESOURCE_ACTION, createTrainingVisualResourceActions };
