import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { boundedTrainingResult } from "./errors.js";

/**
 * Training's result projections, bounds and error mappers, shared by its
 * operations and by a host's own Training actions.
 */

/**
 * The named fields a record has. Records may omit optional parts; a missing part projects as {}.
 * @param {object | undefined} value
 * @param {string[]} fields
 */
function pick(value, fields) {
  if (value === undefined) return {};
  return Object.fromEntries(fields.filter(field => Object.hasOwn(value, field)).map(field => [field, value[field]]));
}

function pin(value) {
  return {
    course: pick(value.course, ["courseId", "release"]),
    topic: pick(value.topic, ["topicId", "release", "commit", "topicHash"]),
    lesson: pick(value.lesson, ["code", "hash"])
  };
}

function preparation(value) {
  return {
    ...pick(value, ["phase", "initialSessionId", "observedAt"]),
    ...(value.failure ? { failure: pick(value.failure, ["stage", "code", "message"]) } : {})
  };
}

/**
 * The bounded projection of a saved attempt, or null.
 */
function attemptProjection(value) {
  if (!value) return null;
  return {
    attemptId: value.attemptId,
    pin: pin(value.pin),
    ...(value.preparation ? { projectSlug: value.projectSlug, preparation: preparation(value.preparation) } : {}),
    ...(value.ended ? { ended: pick(value.ended, ["requestId", "revision", "reason"]) } : {})
  };
}

/**
 * The bounded projection of a lesson completion, or null.
 */
function completionProjection(value) {
  return value ? pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed"]) : null;
}

/**
 * A Training action result, returned whole or refused.
 * @param {object} result
 */
function boundedResult(result) {
  return boundedTrainingResult(result, {
    message: "The training result exceeds 128 KiB. Ask the owner to inspect the content; no teaching text or progress was silently omitted."
  });
}

/**
 * The attempt-preserving error a failed Training operation reports.
 * @param {Error & { code?: string, statusCode?: number }} cause
 */
function toTrainingOperationError(cause) {
  if (cause.code === "VIBE64_TRAINING_PREPARATION_BUSY") {
    return Object.assign(new Error(
      "This saved exercise is still busy preparing or finishing a command. Wait for it to finish, then retry the same attempt."
    ),
      {
      code: cause.code,
      statusCode: 409,
      cause
    });
  }
  // Learner notes failures already carry notes-specific recovery text; the
  // generic attempt wording below would send the learner to the wrong place.
  if (/^VIBE64_TRAINING_NOTES_/u.test(cause.code || "")) {
    return Object.assign(new Error(cause.message), {
      code: cause.code,
      ...(cause.statusCode ? { statusCode: cause.statusCode } : {}),
      cause
    });
  }
  const unconfirmed = String(cause.code || "").includes("SAVE_UNCONFIRMED");
  return Object.assign(new Error(unconfirmed
    ? "The learning save was not confirmed. Read or retry the same request/attempt before creating another exercise or claiming progress."
    : "The training operation could not complete. Keep the saved attempt and ask the owner to inspect its exact content, state or preparation; no automatic repair was performed."),
    {
      code: cause.code || "VIBE64_TRAINING_OPERATION_FAILED",
      ...(cause.statusCode ? { statusCode: cause.statusCode } : {}),
      cause
    });
}

/**
 * The error a failed catalogue read or course install reports: its owner's own refusal, or what to do next.
 * @param {Error & { code?: string, statusCode?: number }} cause
 */
function toCourseInstallError(cause) {
  if (/^VIBE64_TRAINING_(COURSE|CATALOGUE|AVAILABLE|TOPIC|SOURCE)_/u.test(cause.code || "")) return cause;
  return Object.assign(new Error(
    `The course could not be installed: ${String(cause.message || "unknown failure").slice(0, 300)} No course was enabled. Retry; if it fails again, ask the owner to inspect this server's installed learning content.`
  ),
    {
    code: cause.code || "VIBE64_TRAINING_COURSE_INSTALL_FAILED",
    ...(cause.statusCode ? { statusCode: cause.statusCode } : {}),
    cause
  });
}

/**
 * A practice project exists only once preparation began for an exercise lesson.
 * The learning space says whether it still exists; a deleted or archived one
 * is left out (learning.read lists attempts with their slug). A presence check
 * that fails keeps the project listed instead of failing the whole read: one
 * bad record must not hide the learner's progress.
 */
async function practiceSlug({ attempt, actor, learningSpace }) {
  const slug = attempt.projectSlug;
  if (!attempt.preparation || attempt.preparation.phase === "reserved") return "";
  try {
    return await learningSpace.exists({ actor, attemptId: attempt.attemptId }) ? slug : "";
  } catch {
    return slug;
  }
}

function attemptSummary(attempt, slug = "") {
  const failure = attempt.preparation?.failure;
  return {
    attemptId: attempt.attemptId,
    pin: pin(attempt.pin),
    ...(attempt.preparation ? {
      preparation: {
        ...pick(attempt.preparation, ["phase", "observedAt"]),
        ...(failure ? { failure: pick(failure, ["code", "message"]) } : {})
      }
    } : {}),
    ...(slug ? { practiceSlug: slug } : {}),
    ...(attempt.ended ? { ended: pick(attempt.ended, ["revision", "reason"]) } : {})
  };
}

/**
 * The result of an attempt that has already ended.
 */
const endedResult = result => ({
  ok: true,
  available: true,
  revision: result.revision,
  attempt: attemptProjection(result.attempt),
  active: attemptProjection(result.active),
  replayed: result.replayed === true,
  previewReady: false
});
/**
 * The result of a lesson start, resume or restart: its saved attempt, or a refusal when none was returned.
 */
const preparedResult = result => {
  if (result?.ok === false || !result?.attempt) {
    throw Object.assign(new Error("Exercise preparation did not return a saved attempt."), { code: "VIBE64_TRAINING_PREPARATION_FAILED" });
  }
  if (result.attempt.ended) return { ...endedResult(result), completion: null };
  return {
    ok: true,
    available: true,
    revision: result.revision,
    active: attemptProjection(result.attempt),
    completion: completionProjection(result.completion),
    previewReady: false,
    ...(result.setup?.status ? { setupStatus: result.setup.status } : {})
  };
};

/**
 * The signed-in learner of a Training action; learning actions refuse anyone else.
 * @param {object} context
 */
function signedInLearner(context) {
  const actor = authenticatedVibe64User(context);
  if (!actor) {
    throw Object.assign(new Error("Log in to Vibe64 before using learning actions."), {
      code: "vibe64_auth_required",
      statusCode: 401
    });
  }
  return actor;
}

export {
  attemptProjection,
  attemptSummary,
  boundedResult,
  completionProjection,
  endedResult,
  pick,
  practiceSlug,
  preparedResult,
  signedInLearner,
  toCourseInstallError,
  toTrainingOperationError
};
