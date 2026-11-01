import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";

/** @typedef {import("./types.js").TrainingLessonVisuals} TrainingLessonVisuals */

const TRAINING_VISUAL_RESOURCE_ACTION = "vibe64.training.visual-resource.read";
/**
 * The learner's lesson diagram read, one call on the lesson visuals.
 * @param {object} dependencies
 * @param {TrainingLessonVisuals} dependencies.lessonVisuals
 */
function createTrainingVisualResourceActions({ lessonVisuals }) {
  return Object.freeze([Object.freeze({
    ...VIBE64_QUERY,
    id: TRAINING_VISUAL_RESOURCE_ACTION,
    input: {
      mode: "create",
      schema: createSchema({
        attemptId: {
          type: "string",
          required: true,
          noTrim: true,
          maxLength: 36,
          pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
        },
        visualId: {
          type: "string",
          required: true,
          noTrim: true,
          maxLength: 64,
          pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$"
        }
      })
    },
    channels: ["api"],
    extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
    execute: (input, context) => lessonVisuals.readLessonVisual(input, context)
  })]);
}

export { TRAINING_VISUAL_RESOURCE_ACTION, createTrainingVisualResourceActions };
