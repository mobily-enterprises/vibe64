import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { normalizeProjectSlug } from "@local/vibe64-core/server/studioProjectContext";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { createInstalledTrainingContent, validateInstalledTopicPin } from "./installedContent.js";

const MAX_REQUEST_IDS = 64;
const MAX_RECORD_BYTES = 64 * 1024;
const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const requestPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const version = { type: "integer", required: true, enum: [1] };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const preparationSchema = createSchema({ phase: { ...text, enum: ["reserved"] } });
const pinSchema = createSchema({
  course: { type: "object", required: true, schema: createSchema({ courseId: { ...text, maxLength: 64 }, release: text }) },
  // The existing installed-pin owner validates this opaque nested object.
  topic: { type: "object", required: true },
  lesson: { type: "object", required: true, schema: createSchema({ code: { ...text, maxLength: 64 }, hash: { ...text, maxLength: 64 } }) }
});
const attemptSchema = createSchema({
  attemptId: { ...text, maxLength: 36 },
  requestIds: { type: "array", required: true, minLength: 1, maxLength: MAX_REQUEST_IDS, items: { ...text, maxLength: 64 } },
  createdAt: { ...text, maxLength: 24 },
  pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, maxLength: 48 },
  preparation: { type: "object", required: true, schema: preparationSchema }
});
const progressSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, revision,
  activeAttemptId: { ...text, maxLength: 36, nullable: true },
  // This reservation-only increment has one active attempt and no restart API.
  attempts: { type: "array", required: true, maxLength: 1, items: attemptSchema }
});
const activeSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, maxLength: 36 }, pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, maxLength: 48 }, preparation: { type: "object", required: true, schema: preparationSchema }
});

function failure(code, message, statusCode, details = {}) {
  return Object.assign(new Error(message), { code, ...(statusCode ? { statusCode } : {}), ...details });
}

function learnerIdentity(actor) {
  if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
    throw new Error("Learning state requires an actor supplied by the admitted authenticated caller.");
  }
  const value = actor?.uid ?? actor?.username;
  if ((typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))) {
    throw new Error("Learning state requires a valid identity from the admitted authenticated caller.");
  }
  const id = String(value);
  if (!id || id.trim() !== id || Buffer.byteLength(id) > 128 || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw new Error("Learning state requires a bounded nonempty actor identity; no local fallback is used.");
  }
  return { id, key: Buffer.from(id).toString("base64url") };
}

function validatePin(value) {
  const pin = validateContent(pinSchema, value, "Learner reservation pin");
  validateInstalledTopicPin(pin.topic);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(pin.course.courseId) || !/^\d+\.\d+\.\d+$/u.test(pin.course.release) ||
      !idPattern.test(pin.lesson.code) || !/^[a-f0-9]{64}$/u.test(pin.lesson.hash)) {
    throw new Error("Reserve the exact course release, installed topic pin and published lesson hash.");
  }
  return { course: { ...pin.course }, topic: { ...pin.topic }, lesson: { ...pin.lesson } };
}

function validateAttempt(attempt) {
  validatePin(attempt.pin);
  if (!uuidPattern.test(attempt.attemptId) || attempt.projectSlug !== normalizeProjectSlug(`training-${attempt.attemptId.replaceAll("-", "")}`) ||
      !Number.isFinite(Date.parse(attempt.createdAt)) || new Date(attempt.createdAt).toISOString() !== attempt.createdAt ||
      !attempt.requestIds.length || attempt.requestIds.some(id => !requestPattern.test(id)) || new Set(attempt.requestIds).size !== attempt.requestIds.length) {
    throw new Error("Learning state has an invalid attempt identity, reservation time or retry inventory.");
  }
}

function deriveActive(progress) {
  const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
  if (!attempt) return null;
  return {
    schemaVersion: 1,
    learnerId: progress.learnerId,
    progressRevision: progress.revision,
    attemptId: attempt.attemptId,
    pin: attempt.pin,
    projectSlug: attempt.projectSlug,
    preparation: attempt.preparation
  };
}

async function inspectPath(filename, directory) {
  let stat;
  try {
    stat = await lstat(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (stat.isSymbolicLink() || await realpath(filename) !== filename || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink !== 1)) {
    throw new Error("Learning state requires canonical regular paths without symlink or file aliases.");
  }
  return stat;
}

async function inspectDirectoryChain(directory) {
  const parent = path.dirname(directory);
  if (parent !== directory) await inspectDirectoryChain(parent);
  return inspectPath(directory, true);
}

async function readRecord(filename) {
  const stat = await inspectPath(filename, false);
  if (!stat) return null;
  if (stat.size > MAX_RECORD_BYTES) throw new Error("Learning state exceeds its 64 KiB record limit.");
  const bytes = await readFile(filename);
  if (bytes.length > MAX_RECORD_BYTES) throw new Error("Learning state exceeds its 64 KiB record limit.");
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Learning state must contain a versioned record object.");
  return value;
}

// Callers derive actor from fresh authentication and admit a new start against
// the course lock. This internal store neither authenticates objects nor owns
// release enablement, project effects, grading or arbitrary state patches.
function createTrainingLearnerState({ systemRoot } = {}) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Learning state needs a canonical absolute, non-root server-owned system root.");
  }
  const installed = createInstalledTrainingContent({ systemRoot });

  function userPaths(actor) {
    const learner = learnerIdentity(actor);
    const trainingRoot = path.join(systemRoot, "training");
    const usersRoot = path.join(trainingRoot, "users");
    const userRoot = path.join(usersRoot, learner.key);
    return {
      learner,
      directories: [trainingRoot, usersRoot, userRoot],
      userRoot,
      progress: path.join(userRoot, "progress.json"),
      active: path.join(userRoot, "active-lesson.json"),
      lock: path.join(userRoot, "state.lock")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress);
    if (!value) return { schemaVersion: 1, learnerId: paths.learner.id, revision: 0, activeAttemptId: null, attempts: [] };
    const progress = validateContent(progressSchema, value, "Learner progress");
    if (progress.learnerId !== paths.learner.id || (progress.attempts.length ?
      progress.revision < 1 || progress.activeAttemptId !== progress.attempts[0].attemptId : progress.activeAttemptId !== null || progress.revision !== 0)) {
      throw new Error("Learning state differs from its learner or active reservation.");
    }
    for (const attempt of progress.attempts) validateAttempt(attempt);
    return progress;
  }

  async function loadState(paths) {
    try {
      await inspectDirectoryChain(systemRoot);
      for (const directory of paths.directories) await inspectPath(directory, true);
      const lock = await inspectPath(paths.lock, false);
      if (lock && lock.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
      let progress = await readProgress(paths);
      const savedActive = await readRecord(paths.active);
      if (savedActive) {
        const active = validateContent(activeSchema, savedActive, "Active learner reservation");
        validatePin(active.pin);
        if (active.learnerId !== paths.learner.id) throw new Error("Active summary belongs to another learner.");
        // Progress is saved first. A read concurrent with an alias reservation
        // can see its later summary; re-read the authority once, without writes.
        if (active.progressRevision > progress.revision) progress = await readProgress(paths);
        const expected = deriveActive(progress);
        if (!expected || active.progressRevision > progress.revision ||
            canonicalJson({ ...active, progressRevision: progress.revision }) !== canonicalJson(expected)) {
          throw new Error("Active summary conflicts with durable progress; inspect a consistent backup before recovery.");
        }
      }
      const active = deriveActive(progress);
      return {
        revision: progress.revision,
        progress,
        active,
        activeSummaryCurrent: canonicalJson(savedActive) === canonicalJson(active)
      };
    } catch (cause) {
      throw failure(
        "VIBE64_TRAINING_STATE_INVALID",
        `Learning state is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`,
        null,
        { cause }
      );
    }
  }

  async function acquire(paths) {
    // Preserve existing state/permissions. Create only this explicit operation's
    // private namespace; the persistent lock serializes cooperating writers.
    if (!await inspectDirectoryChain(systemRoot)) {
      throw new Error("Prepare the server-owned system root before reserving a lesson.");
    }
    for (const directory of paths.directories) {
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await inspectPath(directory, true);
    }
    const release = await tryAcquireExclusiveFileLock(paths.lock);
    if (!release) {
      throw failure("VIBE64_TRAINING_STATE_BUSY", "Learning state is being updated. Retry the same request after that operation finishes.", 409);
    }
    return release;
  }

  async function verifyInstalled(pin) {
    const lesson = await installed.readLesson({ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
    if (canonicalJson(lesson.pin) !== canonicalJson(pin.topic)) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
  }

  async function saveActive(paths, progress) {
    const active = deriveActive(progress);
    try {
      await writeJsonFileAtomic(paths.active, active, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      const error = failure(
        "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED",
        "The reservation is saved, but its active summary save was not confirmed. Retry the same request or resume before provisioning.",
        null,
        { reservationSaved: true, revision: progress.revision, attemptId: progress.activeAttemptId }
      );
      error.cause = cause;
      throw error;
    }
    return active;
  }

  async function readState({ actor } = {}) {
    return loadState(userPaths(actor));
  }

  async function reserveAttempt({ actor, requestId, expectedRevision, pin: inputPin } = {}) {
    const paths = userPaths(actor);
    if (typeof requestId !== "string" || !requestPattern.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Reserve with a bounded stable request ID and the revision returned by readState.");
    }
    const pin = validatePin(inputPin);
    await loadState(paths);
    await verifyInstalled(pin);
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      const replay = state.progress.attempts.find(attempt => attempt.requestIds.includes(requestId));
      if (replay) {
        if (canonicalJson(replay.pin) !== canonicalJson(pin)) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved another exact lesson pin. Resume its saved attempt.", 409);
        }
        await verifyInstalled(replay.pin);
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt: replay, active, replayed: true };
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read the current revision and resume or retry the same request.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. Resume the saved attempt; no new reservation was written.");
      }
      let attempt = state.progress.attempts[0];
      if (attempt) {
        if (canonicalJson(attempt.pin) !== canonicalJson(pin)) {
          throw failure("VIBE64_TRAINING_ATTEMPT_CONFLICT", "Another pinned lesson is already active. Resume it; this operation does not restart attempts.", 409);
        }
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error("This pilot attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed.");
        }
        attempt.requestIds.push(requestId);
      } else {
        const attemptId = randomUUID();
        attempt = {
          attemptId,
          requestIds: [requestId],
          createdAt: new Date().toISOString(),
          pin,
          projectSlug: normalizeProjectSlug(`training-${attemptId.replaceAll("-", "")}`),
          preparation: { phase: "reserved" }
        };
      }
      await verifyInstalled(pin);
      const progress = {
        schemaVersion: 1,
        learnerId: paths.learner.id,
        revision: state.revision + 1,
        activeAttemptId: attempt.attemptId,
        attempts: [attempt]
      };
      try {
        await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        const error = failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", "Reservation save was not confirmed. Retry the same request ID before provisioning; the atomic rename may already have saved it.");
        error.cause = cause;
        throw error;
      }
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt, active, replayed: false };
    } finally {
      await release();
    }
  }

  async function resumeAttempt({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId)) {
      throw new Error("Resume the saved active attempt ID returned by readState.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before resuming.", 404);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before resuming.", 404);
      }
      const attempt = state.progress.attempts[0];
      await verifyInstalled(attempt.pin);
      const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
      return { revision: state.revision, attempt, active };
    } finally {
      await release();
    }
  }

  return { readState, reserveAttempt, resumeAttempt };
}

export { createTrainingLearnerState };
