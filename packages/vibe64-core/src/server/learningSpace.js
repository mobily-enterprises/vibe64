// The learning space: practice projects live only in their learner's own
// namespace, <root>/<learnerKey>/<practiceId>/<slug>, apart from the project
// catalogue, on both hosts. Their runtime root stays in the shared
// <systemRoot>/projects inventory, and their immutable project record carries
// the `training` marker (schema 2) that names the learner and practice.

import path from "node:path";

import { isPlainObject } from "./core.js";

const LEARNING_SPACE_DIR = ".learning";
const PRACTICE_SLUG_PATTERN = /^training-[a-f0-9]{32}$/u;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

// A learner's practice project that no longer has its record (deleted, or
// being deleted), or that belongs to another learner, is not found to its open
// pages. The learner's saved lesson remains in Learning.
const PRACTICE_PROJECT_DELETED_CODE = "vibe64_practice_project_deleted";

function practiceProjectDeletedError() {
  return Object.assign(new Error("This practice project was deleted. Its lesson is still in Learning."), {
    code: PRACTICE_PROJECT_DELETED_CODE, statusCode: 404
  });
}

function practiceIdFromSlug(slug = "") {
  const hex = PRACTICE_SLUG_PATTERN.test(String(slug || "")) ? String(slug).slice("training-".length) : "";
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : "";
}

function practiceSlug(practiceId = "") {
  return `training-${String(practiceId).replaceAll("-", "")}`;
}

// Learner state keys on String(uid ?? username).
function practiceLearnerKey(actor = null) {
  const id = String(actor?.uid ?? actor?.username ?? "");
  return id ? Buffer.from(id).toString("base64url") : "";
}

// The learner a key names, for work that has no person (agent turns after the
// browser closes, maintenance, archive). Either id field yields the same key.
function practiceLearnerActor(learnerKey = "") {
  const id = Buffer.from(String(learnerKey || ""), "base64url").toString("utf8");
  return id && practiceLearnerKey({ username: id }) === learnerKey ? Object.freeze({ username: id }) : null;
}

function practiceNamespace(root = "", { learnerKey, practiceId }) {
  const slug = practiceSlug(practiceId);
  const projectsRoot = path.join(root, learnerKey, practiceId);
  return Object.freeze({ slug, projectsRoot, projectContextRoot: path.join(projectsRoot, slug) });
}

function trainingInvalidError() {
  return Object.assign(new Error("Project training provenance must contain the exact bounded learner, practice, content pin and bundled exercise identity."),
    { code: "vibe64_project_training_invalid" });
}

function validLearnerKey(learnerKey) {
  if (typeof learnerKey !== "string" || learnerKey.length < 1 || learnerKey.length > 171) return false;
  const bytes = Buffer.from(learnerKey, "base64url");
  const id = bytes.toString("utf8");
  return bytes.length >= 1 && bytes.length <= 128 && bytes.toString("base64url") === learnerKey &&
    Buffer.from(id).toString("base64url") === learnerKey && id.trim() === id &&
    // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
    !/[\u0000-\u001f\u007f]/u.test(id);
}

// The immutable marker: {schemaVersion: 2, learnerKey, practiceId, pin, exercise}.
function normalizeProjectTraining(value) {
  const shapes = [
    [value, ["schemaVersion", "learnerKey", "practiceId", "pin", "exercise"]],
    [value?.pin, ["course", "topic", "lesson"]],
    [value?.pin?.course, ["courseId", "release"]],
    [value?.pin?.topic, ["schemaVersion", "topicId", "release", "repository", "commit", "topicHash"]],
    [value?.pin?.lesson, ["code", "hash"]],
    [value?.exercise, ["kind", "sourcePath"]]
  ];
  for (const [object, fields] of shapes) {
    if (!isPlainObject(object) || Object.keys(object).length !== fields.length ||
        fields.some(field => !Object.hasOwn(object, field))) {
      throw trainingInvalidError();
    }
  }
  const { learnerKey, practiceId, pin, exercise } = value;
  const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
  const releasePattern = /^\d+\.\d+\.\d+$/u;
  if (value.schemaVersion !== 2 || pin.topic.schemaVersion !== 1 || !validLearnerKey(learnerKey) ||
      typeof practiceId !== "string" || !UUID_PATTERN.test(practiceId) ||
      typeof pin.course.courseId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(pin.course.courseId) ||
      typeof pin.course.release !== "string" || pin.course.release.length > 256 || !releasePattern.test(pin.course.release) ||
      typeof pin.topic.topicId !== "string" || !idPattern.test(pin.topic.topicId) ||
      typeof pin.topic.release !== "string" || pin.topic.release.length > 256 || !releasePattern.test(pin.topic.release) ||
      typeof pin.topic.repository !== "string" || pin.topic.repository.length > 256 || !/^[a-zA-Z0-9_.-]+\/learn-[a-zA-Z0-9_.-]+$/u.test(pin.topic.repository) ||
      typeof pin.topic.commit !== "string" || !/^[a-f0-9]{40}$/u.test(pin.topic.commit) ||
      typeof pin.topic.topicHash !== "string" || !/^[a-f0-9]{64}$/u.test(pin.topic.topicHash) ||
      typeof pin.lesson.code !== "string" || !idPattern.test(pin.lesson.code) ||
      typeof pin.lesson.hash !== "string" || !/^[a-f0-9]{64}$/u.test(pin.lesson.hash) || exercise.kind !== "bundled") {
    throw trainingInvalidError();
  }
  const sourcePath = exercise.sourcePath;
  if (typeof sourcePath !== "string" || !sourcePath || sourcePath.length > 512 ||
      sourcePath.includes("\\") || sourcePath.includes("\0") || path.posix.isAbsolute(sourcePath) ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(sourcePath) ||
      (sourcePath !== "." && sourcePath.split("/").some(part => !part || part === "." || part === ".."))) {
    throw trainingInvalidError();
  }
  return {
    schemaVersion: 2,
    learnerKey,
    practiceId,
    pin: { course: { ...pin.course }, topic: { ...pin.topic }, lesson: { ...pin.lesson } },
    exercise: { ...exercise }
  };
}

// The one admission rule for a training-<hex> slug, on both hosts. A person
// (an actor, or a real request, which carries headers) opens only their own
// practice project; anything else is not found, with no owner exception. Work
// without a person is admitted as the marker's learner. Null means the
// learning space has no such project, so the caller may try the catalogue.
async function admitPracticeProject({ projectContext, slug = "", actor = null, person = false } = {}) {
  if (!practiceIdFromSlug(slug)) return null;
  const project = await projectContext.readLearningSpaceProject(slug);
  if (!project) return null;
  if (!person && !actor) return { actor: practiceLearnerActor(project.learnerKey), training: project.training };
  if (practiceLearnerKey(actor) !== project.learnerKey) throw practiceProjectDeletedError();
  return { actor, training: project.training };
}

export {
  LEARNING_SPACE_DIR,
  PRACTICE_PROJECT_DELETED_CODE,
  PRACTICE_SLUG_PATTERN,
  admitPracticeProject,
  normalizeProjectTraining,
  practiceIdFromSlug,
  practiceLearnerActor,
  practiceLearnerKey,
  practiceNamespace,
  practiceProjectDeletedError,
  practiceSlug
};
