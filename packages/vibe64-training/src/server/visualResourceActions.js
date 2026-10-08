import { isDeepStrictEqual } from "node:util";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

const TRAINING_VISUAL_RESOURCE_ACTION = "vibe64.training.visual-resource.read";
const TRAINING_VISUAL_CHECKPOINT_ACTION = "vibe64.training.visual.checkpoint";
// The original lesson bundle permits 32 MiB; base64 expansion and metadata
// remain bounded without reducing that original file contract.
const MAX_RESOURCE_BYTES = 48 * 1024 * 1024;

function createTrainingVisualResourceActions({ learners, content, teaching, actions } = {}) {
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
        pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" },
      sessionId: { type: "string", required: false, noTrim: true, minLength: 1, maxLength: 128 }
    }) }, output: null,
    extensions: { assistant: { exclude: true } },
    async execute({ attemptId, visualId, sessionId }, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in to Vibe64 before reading your lesson diagram."), {
        code: "vibe64_auth_required", statusCode: 401
      });
      const state = await learners.readState({ actor, attemptId, includeCompletion: true });
      const attempt = state.active;
      if (!attempt || attempt.attemptId !== attemptId) {
        throw Object.assign(new Error("Read this learner's exact saved active attempt before requesting its diagram."), {
          code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 404
        });
      }
      const learning = context.vibe64Action?.learning;
      if (learning && (!sessionId || learning.learningScope.attemptId !== attemptId ||
          learning.learningScope.learnerId !== state.progress.learnerId ||
          !isDeepStrictEqual(learning.learningScope.pin, attempt.pin))) {
        throw Object.assign(new Error("Read only this learning conversation’s exact saved lesson diagram."), {
          code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 409
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
  }, { projectScoped: false, learningAccess: "observe" }), withVibe64ActionContext({
    id: TRAINING_VISUAL_CHECKPOINT_ACTION, version: 1, kind: "command", idempotency: "domain_native",
    channels: ["api"], surfaces: ["app"], extensions: { assistant: { exclude: true } },
    input: { mode: "create", schema: createSchema({
      attemptId: { type: "string", required: true, noTrim: true, maxLength: 36,
        pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
      visualId: { type: "string", required: true, noTrim: true, maxLength: 64,
        pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" },
      requestId: { type: "string", required: true, noTrim: true, maxLength: 64,
        pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" },
      expectedRevision: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
      projectSlug: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128 },
      sessionId: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128 },
      snapshot: { type: "object", required: true }
    }) }, output: null,
    async execute(input, context) {
      const actor = authenticatedVibe64User(context);
      if (!actor) throw Object.assign(new Error("Log in before saving your lesson diagram."), {
        code: "vibe64_auth_required", statusCode: 401
      });
      const state = await learners.readState({ actor, attemptId: input.attemptId, includeCompletion: true });
      const attempt = state.active;
      const learning = context.vibe64Action?.learning;
      if (!attempt || attempt.attemptId !== input.attemptId || (learning
        ? !input.sessionId || learning.learningScope.attemptId !== input.attemptId ||
          learning.learningScope.learnerId !== state.progress.learnerId ||
          !isDeepStrictEqual(learning.learningScope.pin, attempt.pin)
        : attempt.preparation.phase !== "ready" || attempt.projectSlug !== input.projectSlug ||
          attempt.preparation.initialSessionId !== input.sessionId)) {
        throw Object.assign(new Error("Save only this learner's exact prepared exercise diagram."), {
          code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 409
        });
      }
      if (typeof teaching?.saveVisualCheckpoint !== "function") {
        throw Object.assign(new Error("Lesson diagram checkpointing is unavailable."), {
          code: "VIBE64_TRAINING_TEACHING_UNAVAILABLE", statusCode: 503
        });
      }
      let facilities;
      if (learning) {
        if (typeof actions?.execute !== "function") {
          throw Object.assign(new Error("Learning diagram checkpoint authority is unavailable."), {
            code: "VIBE64_TRAINING_TEACHING_UNAVAILABLE", statusCode: 503
          });
        }
        facilities = { learningScope: learning.learningScope, signal: context.signal,
          async requireCurrent() {
            const fresh = await actions.execute({ actionId: "vibe64.sessions.conversation.teaching-context.read",
              input: { learningAttemptId: input.attemptId, sessionId: input.sessionId },
              context: { channel: "internal", surface: context.surface, requestMeta: context.requestMeta, signal: context.signal } });
            if (fresh.actor.id !== learning.learningScope.learnerId ||
                !isDeepStrictEqual(fresh.project?.learningScope, learning.learningScope)) {
              throw Object.assign(new Error("The learning conversation changed before its diagram could be saved."), {
                code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 409
              });
            }
          } };
      }
      return teaching.saveVisualCheckpoint({ actor, attemptId: input.attemptId, visualId: input.visualId,
        expectedRevision: input.expectedRevision, requestId: input.requestId, snapshot: input.snapshot }, facilities);
    }
  }, { projectScoped: true, learningAccess: "write" })];
}

export { TRAINING_VISUAL_RESOURCE_ACTION, TRAINING_VISUAL_CHECKPOINT_ACTION, createTrainingVisualResourceActions };
