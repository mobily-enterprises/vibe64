import { createSchema } from "@jskit-ai/kernel/shared/validators";

/**
 * The field schemas Training's actions share, and the result schema of its
 * course, learning and lesson actions. A host's own Training actions reuse them.
 */

const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const id = { ...text, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const requestId = { ...text, maxLength: 64, pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$" };
const attemptId = { ...text, maxLength: 36, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
const opaque = { type: "object", additionalProperties: true, required: true };
const courseId = { ...id, pattern: "^[a-z][a-z0-9-]{0,63}$" };
const release = { ...text, pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" };
const resultOutput = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    available: { type: "boolean", required: true },
    revision: { ...revision, required: false },
    activeSummaryCurrent: { type: "boolean", required: false },
    courses: { type: "array", required: false, items: opaque },
    canCreateCourses: {
      type: "boolean",
      required: false
    },
    canTryPreviews: {
      type: "boolean",
      required: false
    },
    course: {
      ...opaque,
      required: false
    },
    domains: { type: "array", required: false, items: opaque },
    repository: { ...text, required: false, maxLength: 256 },
    catalogueCommit: { ...text, required: false, maxLength: 64 },
    changed: { type: "boolean", required: false },
    retired: { type: "array", required: false, maxLength: 16, items: { ...text, maxLength: 32 } },
    lessonProgress: { type: "array", required: false, items: opaque },
    attempts: { type: "array", required: false, maxLength: 32, items: opaque },
    active: { ...opaque, required: false, nullable: true },
    attempt: { ...opaque, required: false },
    history: { type: "array", required: false, items: opaque },
    replayed: { type: "boolean", required: false },
    completion: { ...opaque, required: false, nullable: true },
    learningMode: { ...opaque, required: false },
    previewReady: { type: "boolean", required: false },
    setupStatus: { ...text, required: false, maxLength: 64 },
    error: { ...text, required: false, maxLength: 512 }
  })
};

export {
  attemptId,
  courseId,
  id,
  release,
  requestId,
  resultOutput,
  revision,
  text
};
