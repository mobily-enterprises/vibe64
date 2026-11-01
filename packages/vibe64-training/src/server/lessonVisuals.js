import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { pinnedLessonKey } from "./installedContent.js";

/** @typedef {import("./types.js").TrainingLearners} TrainingLearners */
/** @typedef {import("./types.js").TrainingContent} TrainingContent */

// A lesson bundle permits 32 MiB per diagram; base64 expansion and metadata
// stay bounded without reducing that file limit.
const MAX_RESOURCE_BYTES = 48 * 1024 * 1024;

/**
 * Lesson diagrams for the signed-in learner.
 * @param {object} dependencies
 * @param {TrainingLearners} dependencies.learners
 * @param {TrainingContent} dependencies.content
 */
function createTrainingLessonVisuals({ learners, content }) {
  /**
   * The pinned diagram of one of the signed-in learner's saved attempts, with the
   * snapshot the learner saved, inside its transport limit.
   * @param {{ attemptId: string, visualId: string }} input
   * @param {object} context
   */
  async function readLessonVisual({ attemptId, visualId }, context) {
    const actor = authenticatedVibe64User(context);
    if (!actor) throw Object.assign(new Error("Log in to Vibe64 before reading your lesson diagram."), {
      code: "vibe64_auth_required",
      statusCode: 401
    });
    const state = await learners.readState({ actor, attemptId, includeCompletion: true });
    // The reader shows ended lessons too, so any of this learner's retained
    // attempts may read its pinned diagram.
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) {
      throw Object.assign(new Error("Read one of this learner's exact saved attempts before requesting its diagram."), {
        code: "VIBE64_TRAINING_ATTEMPT_MISSING",
        statusCode: 404
      });
    }
    const { pin } = attempt;
    const resource = await content.readVisual({ ...pinnedLessonKey(pin), visualId });
    const savedVisual = attempt.learning?.resume?.visuals.find(item => item.visualId === visualId);
    const encode = file => ({ path: file.path, encoding: "base64", bytes: file.bytes.toString("base64") });
    const result = {
      pin: resource.pin,
      lessonCode: resource.lessonCode,
      lessonHash: resource.lessonHash,
      revision: state.revision,
      ...(savedVisual ? { snapshot: savedVisual.snapshot } : {}),
      id: resource.id,
      descriptorPath: resource.descriptorPath,
      visual: resource.visual,
      svg: encode(resource.svg),
      controller: encode(resource.controller),
      assets: resource.assets.map(encode)
    };
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESOURCE_BYTES) {
      throw Object.assign(
        new Error(
          "The verified lesson diagram exceeds its transport limit. Ask the owner to inspect the pinned content; no files were omitted."
        ),
        {
          code: "VIBE64_TRAINING_VISUAL_RESOURCE_TOO_LARGE",
          statusCode: 413
        }
      );
    }
    return result;
  }

  return Object.freeze({
    readLessonVisual
  });
}

export { createTrainingLessonVisuals };
