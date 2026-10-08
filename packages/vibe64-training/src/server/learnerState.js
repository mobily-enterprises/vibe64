import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { normalizeProjectSlug } from "@local/vibe64-core/server/projectState";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { canonicalJson } from "./content.js";
import { list, validateContent } from "./contentSchemas.js";
import { createInstalledTrainingContent, validateInstalledTopicPin } from "./installedContent.js";

const MAX_REQUEST_IDS = 64;
const MAX_ATTEMPTS = 8;
const MAX_RECORD_BYTES = 64 * 1024;
const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const requestPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const text = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const version = { type: "integer", required: true, enum: [1] };
const revision = { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER };
const preparationFailureSchema = createSchema({
  stage: { ...text, enum: ["project", "session", "setup"] },
  code: { ...text, maxLength: 64 },
  message: { ...text, maxLength: 512 }
});
const preparationSchema = createSchema({
  phase: { ...text, enum: ["reserved", "preparing", "ready"] },
  initialSessionId: { ...text, required: false, maxLength: 128 },
  observedAt: { ...text, required: false, maxLength: 24 },
  failure: { type: "object", required: false, schema: preparationFailureSchema }
});
const pinSchema = createSchema({
  course: { type: "object", required: true, schema: createSchema({ courseId: { ...text, maxLength: 64 }, release: text }) },
  // The existing installed-pin owner validates this opaque nested object.
  topic: { type: "object", required: true },
  lesson: { type: "object", required: true, schema: createSchema({ code: { ...text, maxLength: 64 }, hash: { ...text, maxLength: 64 } }) }
});
const evidenceSchema = createSchema({
  kind: { ...text, enum: ["answer", "observation"] }, learnerId: { ...text, maxLength: 128 },
  attemptId: { ...text, maxLength: 36 }, text: { ...text, maxLength: 2048 },
  messageId: { ...text, required: false, maxLength: 128 }, questionId: { ...text, required: false, maxLength: 64 },
  observationId: { ...text, required: false, maxLength: 128 }, observedAt: { ...text, required: false, maxLength: 24 },
  projectSlug: { ...text, required: false, maxLength: 48 }, sessionId: { ...text, required: false, maxLength: 128 },
  producer: { ...text, required: false, enum: ["workspace", "colleague", "exercise"] },
  operation: { ...text, required: false, maxLength: 64 }, origin: { ...text, required: false, enum: ["learner", "demonstration"] },
  check: { ...text, required: false, maxLength: 64 }
});
const resultSchema = createSchema({
  submissionId: { ...text, maxLength: 64 }, assessmentId: { ...text, maxLength: 64 },
  kind: { ...text, enum: ["answer", "practical"] }, outcome: { ...text, enum: ["passed", "not-yet-passed", "needs-review"] },
  evidence: { type: "object", required: true, schema: evidenceSchema },
  explanation: { ...text, maxLength: 1024 }, assistance: { ...text, enum: ["none", "hint", "demonstration", "substantial"] },
  rubric: text, rubricRevision: { ...text, maxLength: 64 }, recordedAt: { ...text, maxLength: 24 }
});
const resumeSchema = createSchema({
  requestId: { ...text, maxLength: 64 }, revision, stage: { ...text, maxLength: 64 },
  pendingQuestion: { type: "object", required: true, nullable: true, schema: createSchema({
    id: { ...text, maxLength: 64 }, assessmentId: { ...text, maxLength: 64 }, text: { ...text, maxLength: 2048 },
    assistance: { ...text, required: false, enum: ["none", "hint", "demonstration", "substantial"] },
    issuedRevision: { ...revision, required: false, min: 1 }
  }) },
  visuals: list(createSchema({ visualId: { ...text, maxLength: 64 }, snapshot: { type: "object", required: true } }), 12),
  summary: { ...text, minLength: 0, maxLength: 2048 }
});
const learningSchema = createSchema({
  submissions: list(resultSchema, 64), resume: { type: "object", required: false, schema: resumeSchema }
});
const endedSchema = createSchema({
  requestId: { ...text, maxLength: 64 }, revision,
  reason: { ...text, enum: ["restart", "discard"] }
});
const attemptSchema = createSchema({
  attemptId: { ...text, maxLength: 36 },
  requestIds: { ...list({ ...text, maxLength: 64 }, MAX_REQUEST_IDS), minLength: 1 },
  createdAt: { ...text, maxLength: 24 },
  pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, maxLength: 48 },
  preparation: { type: "object", required: true, schema: preparationSchema },
  learning: { type: "object", required: false, schema: learningSchema },
  ended: { type: "object", required: false, schema: endedSchema }
});
const progressSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, revision,
  activeAttemptId: { ...text, maxLength: 36, nullable: true },
  // Retain ended attempts without replacing their evidence or identities.
  attempts: list(attemptSchema, MAX_ATTEMPTS)
});
const activeSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, maxLength: 36 }, pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, maxLength: 48 }, preparation: { type: "object", required: true, schema: preparationSchema },
  learning: { type: "object", required: false, schema: learningSchema }
});

const emptyActiveSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, nullable: true, maxLength: 36 }
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
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
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

function validatePreparation(preparation, attemptId) {
  if (preparation.phase === "reserved") {
    if (canonicalJson(preparation) !== canonicalJson({ phase: "reserved" })) {
      throw new Error("A reserved attempt must not contain preparation effects or a session identity.");
    }
    return;
  }
  if (preparation.initialSessionId !== `training-${attemptId}` ||
      assertValidVibe64SessionId(preparation.initialSessionId) !== preparation.initialSessionId) {
    throw new Error("Preparation must retain the exact server-reserved initial session identity.");
  }
  if (preparation.phase === "ready") {
    if (!Number.isFinite(Date.parse(preparation.observedAt)) ||
        new Date(preparation.observedAt).toISOString() !== preparation.observedAt || preparation.failure) {
      throw new Error("Ready preparation requires an observed time and no unresolved failure.");
    }
  } else if (preparation.observedAt) {
    throw new Error("Pending preparation must not claim an observed ready time.");
  }
  if (preparation.failure && (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u.test(preparation.failure.code) ||
      preparation.failure.message.trim() !== preparation.failure.message ||
      // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
      /[\u0000-\u001f\u007f]/u.test(preparation.failure.message))) {
    throw new Error("Preparation failure must contain a bounded code and a single-line recovery message.");
  }
}

function validateAttempt(attempt) {
  validatePin(attempt.pin);
  validatePreparation(attempt.preparation, attempt.attemptId);
  if (!uuidPattern.test(attempt.attemptId) || attempt.projectSlug !== normalizeProjectSlug(`training-${attempt.attemptId.replaceAll("-", "")}`) ||
      !Number.isFinite(Date.parse(attempt.createdAt)) || new Date(attempt.createdAt).toISOString() !== attempt.createdAt ||
      !attempt.requestIds.length || attempt.requestIds.some(id => !requestPattern.test(id)) || new Set(attempt.requestIds).size !== attempt.requestIds.length) {
    throw new Error("Learning state has an invalid attempt identity, reservation time or retry inventory.");
  }
}

function validateLearning(learning, attempt, learnerId, maximumRevision) {
  const { attemptId } = attempt;
  if (!learning) return;
  const identifiers = new Set();
  const references = new Set();
  for (const result of learning.submissions) {
    const evidence = result.evidence;
    const reference = evidence.kind === "answer" ? evidence.messageId : evidence.observationId;
    if (!requestPattern.test(result.submissionId) || !idPattern.test(result.assessmentId) ||
        result.rubricRevision !== attempt.pin.lesson.hash ||
        evidence.attemptId !== attemptId || evidence.learnerId !== learnerId || !reference ||
        (result.kind === "answer") !== (evidence.kind === "answer") || identifiers.has(result.submissionId) ||
        references.has(`${evidence.kind}:${reference}`) || !Number.isFinite(Date.parse(result.recordedAt)) ||
        new Date(result.recordedAt).toISOString() !== result.recordedAt) {
      throw new Error("Learning results have invalid identity, duplicate submission/evidence or an unconfirmed record time.");
    }
    if (evidence.kind === "answer") {
      if (!requestPattern.test(evidence.questionId || "") || Object.keys(evidence).some(key =>
        !["kind", "learnerId", "attemptId", "text", "messageId", "questionId"].includes(key))) {
        throw new Error("Saved answers must retain the actual learner message and question identity.");
      }
    } else if (!evidence.producer || !evidence.operation || !evidence.origin ||
        evidence.projectSlug !== attempt.projectSlug || evidence.sessionId !== `training-${attemptId}` ||
        !Number.isFinite(Date.parse(evidence.observedAt)) || new Date(evidence.observedAt).toISOString() !== evidence.observedAt ||
        evidence.messageId || evidence.questionId || result.outcome === "passed" && evidence.origin !== "learner") {
      throw new Error("Saved practical evidence must retain this attempt's native observation identity.");
    }
    identifiers.add(result.submissionId);
    references.add(`${evidence.kind}:${reference}`);
  }
  const resume = learning.resume;
  if (resume && (!requestPattern.test(resume.requestId) || !idPattern.test(resume.stage) ||
      resume.revision < 1 || resume.revision > maximumRevision ||
      resume.pendingQuestion && (!requestPattern.test(resume.pendingQuestion.id) || !idPattern.test(resume.pendingQuestion.assessmentId)) ||
      resume.pendingQuestion?.issuedRevision > resume.revision ||
      new Set(resume.visuals.map(value => value.visualId)).size !== resume.visuals.length)) {
    throw new Error("Learning resume has an invalid checkpoint identity, revision, question or visual inventory.");
  }
  for (const visual of resume?.visuals || []) validateSnapshot(visual.snapshot);
}

function validateSnapshot(snapshot) {
  if (canonicalJson(Object.keys(snapshot).sort()) !== canonicalJson(["labels", "paused", "state"]) ||
      !idPattern.test(snapshot.state) || typeof snapshot.paused !== "boolean" ||
      !snapshot.labels || typeof snapshot.labels !== "object" || Array.isArray(snapshot.labels) ||
      Object.keys(snapshot.labels).length > 32 || Object.entries(snapshot.labels).some(([name, value]) =>
        // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner input.
        !requestPattern.test(name) || typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) ||
      Buffer.byteLength(JSON.stringify(snapshot)) > 4096) {
    throw new Error("Save only a bounded semantic visual snapshot.");
  }
}

function validateProgress(value, learnerId) {
  const progress = validateContent(progressSchema, value, "Learner progress");
  if (progress.learnerId !== learnerId || (!progress.attempts.length &&
      (progress.activeAttemptId !== null || progress.revision !== 0))) {
    throw new Error("Learning state differs from its learner or active reservation.");
  }
  const attemptIds = new Set();
  const requestIds = new Set();
  let endedRevision = 0;
  let activeCount = 0;
  for (const [index, attempt] of progress.attempts.entries()) {
    validateAttempt(attempt);
    validateLearning(attempt.learning, attempt, learnerId, attempt.ended ? attempt.ended.revision - 1 : progress.revision);
    if (attemptIds.has(attempt.attemptId)) throw new Error("Learning history repeats an attempt identity.");
    attemptIds.add(attempt.attemptId);
    for (const requestId of [...attempt.requestIds, ...(attempt.ended ? [attempt.ended.requestId] : [])]) {
      if (!requestPattern.test(requestId) || requestIds.has(requestId)) {
        throw new Error("Learning history repeats or has an invalid reservation/end request identity.");
      }
      requestIds.add(requestId);
    }
    if (attempt.ended) {
      if (attempt.ended.revision < endedRevision + 2 || attempt.ended.revision > progress.revision ||
          attempt.attemptId === progress.activeAttemptId) {
        throw new Error("Ended attempts must retain ordered terminal revisions and cannot be active.");
      }
      endedRevision = attempt.ended.revision;
    } else {
      activeCount++;
      if (index !== progress.attempts.length - 1 || attempt.attemptId !== progress.activeAttemptId ||
          progress.revision <= endedRevision) {
        throw new Error("Learning history must contain exactly one active attempt at its declared identity.");
      }
    }
  }
  if (activeCount > 1 || (activeCount === 0 ? progress.activeAttemptId !== null ||
      progress.revision !== endedRevision : progress.activeAttemptId === null)) {
    throw new Error("Learning history must contain exactly one active attempt or only ended attempts.");
  }
  if (Buffer.byteLength(`${JSON.stringify(progress, null, 2)}\n`) > MAX_RECORD_BYTES) {
    throw new Error("Learning state exceeds its 64 KiB record limit. No evidence was removed or written.");
  }
  return progress;
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
    preparation: attempt.preparation,
    ...(attempt.learning ? { learning: attempt.learning } : {})
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

// Callers supply content-validated progress and the exact installed lesson.
function passedAssessmentIds(attempt, lesson, attempts = [attempt]) {
  const matching = attempts.filter(value => canonicalJson(value.pin.lesson) === canonicalJson(attempt.pin.lesson));
  return lesson.lesson.assessments.filter(assessment => matching.some(value => value.learning?.submissions.some(result =>
    result.assessmentId === assessment.id && result.rubricRevision === lesson.hash && result.outcome === "passed")))
    .map(assessment => assessment.id);
}

// Callers derive actor from fresh authentication and admit a new start against
// the course lock. This internal store neither authenticates objects nor owns
// release enablement, project effects, grading or arbitrary state patches.
function createTrainingLearnerState({ systemRoot, contentSystemRoot = systemRoot, content } = {}) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Learning state needs a canonical absolute, non-root server-owned system root.");
  }
  // Offline restore reads staged state against the live exact-pin installation.
  // An isolated author-preview store uses the same writer and its exact reader.
  const installed = content === undefined ? createInstalledTrainingContent({ systemRoot: contentSystemRoot }) : content;
  if (typeof installed?.readLesson !== "function") {
    throw new TypeError("Learning state requires the configured installed-content reader.");
  }

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
      lock: path.join(userRoot, "state.lock"),
      preparationLock: path.join(userRoot, "preparation.lock")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress);
    if (!value) return { schemaVersion: 1, learnerId: paths.learner.id, revision: 0, activeAttemptId: null, attempts: [] };
    const progress = validateProgress(value, paths.learner.id);
    return progress;
  }

  async function loadState(paths) {
    try {
      await inspectDirectoryChain(systemRoot);
      for (const directory of paths.directories) await inspectPath(directory, true);
      for (const lockPath of [paths.lock, paths.preparationLock]) {
        const lock = await inspectPath(lockPath, false);
        if (lock && lock.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
      }
      let progress = await readProgress(paths);
      const savedActive = await readRecord(paths.active);
      if (savedActive) {
        const isEmpty = savedActive.attemptId === null;
        const active = validateContent(isEmpty ? emptyActiveSchema : activeSchema, savedActive, "Active learner reservation");
        if (active.learnerId !== paths.learner.id) throw new Error("Active summary belongs to another learner.");
        // Progress is saved before its derived summary. Re-read once if a read
        // straddles those publications; never repair from a read.
        if (active.progressRevision > progress.revision) progress = await readProgress(paths);
        if (isEmpty) {
          if (!progress.attempts.some(attempt => attempt.ended?.revision === active.progressRevision)) {
            throw new Error("An empty active summary must describe an actual retained end revision.");
          }
        } else {
          validatePin(active.pin);
          validatePreparation(active.preparation, active.attemptId);
          validateLearning(active.learning, active, active.learnerId, active.progressRevision);
          const attemptIndex = progress.attempts.findIndex(attempt => attempt.attemptId === active.attemptId);
          const retained = progress.attempts[attemptIndex];
          const previousEndRevision = progress.attempts[attemptIndex - 1]?.ended?.revision || 0;
          const expectedRevision = retained?.ended ? retained.ended.revision - 1 : progress.revision;
          const expected = retained && deriveActive({ ...progress, activeAttemptId: retained.attemptId, revision: expectedRevision });
          if (previousEndRevision && active.progressRevision <= previousEndRevision) throw new Error("Active summary predates this attempt's reservation.");
          let preparation = active.preparation;
          if (expected && active.progressRevision < expectedRevision) {
            const previous = active.preparation;
            const current = expected.preparation;
            const revisionDistance = expectedRevision - active.progressRevision;
            // A phase-changing progress write can precede its derived summary.
            // Accept only reachable older preparation with the same reserved ID.
            let predecessor = false;
            if (current.phase !== "reserved") {
              if (previous.phase === "reserved") {
                const minimumDistance = current.phase === "ready" || current.failure ? 2 : 1;
                predecessor = revisionDistance >= minimumDistance;
              } else if (previous.initialSessionId === current.initialSessionId) {
                if (current.phase === "ready") {
                  // Observation times can move backward with the wall clock.
                  // Changed ready observations require an intervening failure write.
                  predecessor = previous.phase !== "ready" ||
                    previous.observedAt === current.observedAt || revisionDistance >= 2;
                } else if (current.failure) {
                  predecessor = true;
                } else {
                  predecessor = previous.phase === "preparing" && !previous.failure;
                }
              }
            }
            if (predecessor) {
              preparation = current;
            }
          }
          let projected = { ...active, progressRevision: expectedRevision, preparation };
          if (expected && active.progressRevision < expectedRevision && expected.learning) {
            const previous = active.learning;
            const current = expected.learning;
            const prefix = !previous || previous.submissions.length <= current.submissions.length &&
              previous.submissions.every((result, index) => canonicalJson(result) === canonicalJson(current.submissions[index]));
            const olderResume = !previous?.resume || current.resume &&
              (previous.resume.revision < current.resume.revision || canonicalJson(previous.resume) === canonicalJson(current.resume));
            if (prefix && olderResume) projected = { ...projected, learning: current };
          }
          if (!expected || active.progressRevision > expectedRevision ||
              canonicalJson(projected) !== canonicalJson(expected)) {
            throw new Error("Active summary conflicts with durable progress; inspect a consistent backup before recovery.");
          }
        }
      }
      const active = deriveActive(progress);
      return {
        revision: progress.revision,
        progress,
        active,
        activeSummaryCurrent: canonicalJson(savedActive) === canonicalJson(active || (progress.revision ? {
          schemaVersion: 1, learnerId: progress.learnerId, progressRevision: progress.revision, attemptId: null
        } : null))
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
    return lesson;
  }

  async function verifyProgressLessons(progress) {
    const lessons = new Map();
    for (const attempt of progress.attempts) {
      const lesson = await verifyInstalled(attempt.pin);
      validateLessonLearning(attempt, lesson);
      lessons.set(attempt.attemptId, lesson);
    }
    return lessons;
  }

  async function saveActive(paths, progress) {
    const active = deriveActive(progress);
    try {
      const summary = active || { schemaVersion: 1, learnerId: progress.learnerId, progressRevision: progress.revision, attemptId: null };
      await writeJsonFileAtomic(paths.active, summary, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      const error = failure(
        "VIBE64_TRAINING_ACTIVE_SAVE_UNCONFIRMED",
        active ? "The reservation is saved, but its active summary save was not confirmed. Retry the same request or resume before provisioning."
          : "The attempt end is saved, but its empty active summary save was not confirmed. Read or retry the same end request; no project disposal was claimed.",
        null,
        { reservationSaved: Boolean(active), ...(active ? {} : { attemptEndSaved: true }), revision: progress.revision, attemptId: progress.activeAttemptId }
      );
      error.cause = cause;
      throw error;
    }
    return active;
  }

  async function readState({ actor, includeCompletion = false } = {}) {
    const state = await loadState(userPaths(actor));
    if (includeCompletion !== true) return state;
    const lessons = await verifyProgressLessons(state.progress);
    if (!state.active) return { ...state, completion: null };
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    return { ...state, completion: lessonCompletion(attempt, lessons.get(attempt.attemptId), state.progress.attempts) };
  }

  // Internal host context, never an assistant result or caller-selected path.
  // Read the real reservation and installed descriptor before using a private
  // source-less Main namespace. Historical attempts may be read, not continued.
  async function readLearningSessionScope({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId)) {
      throw new Error("Use the exact saved learning attempt ID.");
    }
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    }
    const lesson = await verifyInstalled(attempt.pin);
    if (lesson.lesson.exercise) {
      throw failure("VIBE64_TRAINING_EXERCISE_REQUIRED", "This lesson requires its real exercise workspace; it cannot use a source-less learning session.", 409);
    }
    const projectRuntimeRoot = path.join(paths.userRoot, "learning-sessions", attemptId);
    await inspectDirectoryChain(projectRuntimeRoot);
    return {
      scope: { learnerId: paths.learner.id, attemptId, pin: structuredClone(attempt.pin), noExercise: true },
      projectRuntimeRoot,
      systemRoot,
      active: state.progress.activeAttemptId === attemptId && !attempt.ended,
      activeSummaryCurrent: state.activeSummaryCurrent
    };
  }

  // Read the original saved exercise identity, never infer it from a project
  // name or source directory. The caller owns callback-scoped Project admission.
  async function readExerciseProjectScope({ actor, attemptId, access = "observe" } = {}) {
    if (!["observe", "control", "write", "create"].includes(access)) {
      throw new TypeError("Use an explicit practice operation scope.");
    }
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId)) {
      throw new Error("Use the exact saved exercise attempt ID.");
    }
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    if (!lesson.lesson.exercise) {
      throw failure("VIBE64_TRAINING_EXERCISE_MISSING", "This saved lesson has no practice project. Use its source-less learning conversation.", 409);
    }
    const active = state.progress.activeAttemptId === attemptId && !attempt.ended;
    if ((access === "write" || access === "create") && (!active || !state.activeSummaryCurrent)) {
      throw failure("VIBE64_TRAINING_ATTEMPT_INACTIVE", "Resume this exact confirmed active lesson before admitting practice work.", 409);
    }
    if (typeof installed.readExercise !== "function") {
      throw failure("VIBE64_TRAINING_EXERCISE_UNAVAILABLE", "This installed content reader cannot supply the lesson's exact bundled exercise.", 409);
    }
    const exercise = await installed.readExercise({ ...attempt.pin.topic,
      lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    return {
      scope: { learnerId: paths.learner.id, attemptId, pin: structuredClone(attempt.pin), noExercise: false },
      systemRoot,
      training: { schemaVersion: 1, learnerKey: paths.learner.key, attemptId, pin: structuredClone(attempt.pin),
        exercise: { kind: "bundled", sourcePath: exercise.sourcePath } },
      projectSlug: attempt.projectSlug,
      ...(attempt.preparation.initialSessionId ? { initialSessionId: attempt.preparation.initialSessionId } : {}),
      active, activeSummaryCurrent: state.activeSummaryCurrent
    };
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
      await verifyProgressLessons(state.progress);
      if (state.progress.attempts.some(attempt => attempt.ended?.requestId === requestId)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already ended an attempt; use its original end operation.", 409);
      }
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
      let attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      if (attempt) {
        if (canonicalJson(attempt.pin) !== canonicalJson(pin)) {
          throw failure("VIBE64_TRAINING_ATTEMPT_CONFLICT", "Another pinned lesson is already active. Resume it; this operation does not restart attempts.", 409);
        }
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error("This pilot attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed.");
        }
        attempt.requestIds.push(requestId);
      } else {
        if (state.progress.attempts.length >= MAX_ATTEMPTS) {
          throw new Error("This pilot learner reached the eight retained-attempt limit. Keep the history and ask the owner to review capacity; no evidence or request identity was removed.");
        }
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
        attempts: state.active ? state.progress.attempts.map(value => value.attemptId === attempt.attemptId ? attempt : value)
          : [...state.progress.attempts, attempt]
      };
      validateProgress(progress, paths.learner.id);
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

  // The admitted host runs normal Stop/archive/delete, if requested, and this
  // final typed retirement inside runPreparationExclusive. No disposal receipt
  // or project/session side effect is fabricated by the learner-state owner.
  async function endAttempt({ actor, attemptId, requestId, expectedRevision, reason } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !requestPattern.test(requestId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !["restart", "discard"].includes(reason)) {
      throw new Error("End the exact saved attempt with a stable request ID, current revision and explicit restart/discard reason.");
    }
    await loadState(paths);
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      await verifyProgressLessons(state.progress);
      const replay = state.progress.attempts.find(value => value.ended?.requestId === requestId);
      if (replay) {
        if (replay.attemptId !== attemptId || replay.ended.reason !== reason) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This end request already retired a different attempt or reason.", 409);
        }
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt: replay, active, replayed: true };
      }
      if (state.progress.attempts.some(value => value.requestIds.includes(requestId))) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved an attempt; use a distinct stable end request.", 409);
      }
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Only this learner's exact active attempt can be ended; retained history is not reactivated.", 404);
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read it before ending the same attempt.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("Learning state reached its revision limit. No attempt was ended.");
      const previous = state.progress.attempts.find(value => value.attemptId === attemptId);
      const attempt = { ...previous, ended: { requestId, revision: state.revision + 1, reason } };
      const progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: null,
        attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? attempt : value) };
      validateProgress(progress, paths.learner.id);
      try {
        await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", "Attempt end save was not confirmed; atomic rename may have succeeded. Read or retry this exact end request before a new reservation.", null, { cause });
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
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      const lessons = await verifyProgressLessons(state.progress);
      const lesson = lessons.get(attempt.attemptId);
      const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
      return { revision: state.revision, attempt, active, completion: lessonCompletion(attempt, lesson, state.progress.attempts) };
    } finally {
      await release();
    }
  }

  // The admitted server owner holds this across effects. Typed state writes
  // acquire only their short state.lock, so they remain usable inside it.
  async function runPreparationExclusive({ actor, attemptId } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId) || typeof operation !== "function") {
      throw new Error("Run preparation for the saved attempt with an admitted server operation.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before preparing.", 404);
    }
    await verifyProgressLessons(before.progress);
    const release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    if (!release) {
      throw failure("VIBE64_TRAINING_PREPARATION_BUSY", "This learner's exercise is being prepared. Retry the same attempt after that operation finishes.", 409);
    }
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before preparing.", 404);
      }
      await verifyProgressLessons(state.progress);
      return await operation();
    } finally {
      await release();
    }
  }

  // These typed operations record observations from an admitted server owner.
  // They never create/inspect projects, sessions or running applications.
  async function writePreparation(input, operation, failureInput) {
    const { actor, attemptId, expectedRevision, initialSessionId } = input;
    const paths = userPaths(actor);
    if (typeof attemptId !== "string" || !uuidPattern.test(attemptId) ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Update preparation for the saved attempt with its current state revision.");
    }
    if (operation !== "begin" && initialSessionId !== `training-${attemptId}`) {
      throw new Error("Observe preparation for the exact server-reserved initial session.");
    }
    const observedFailure = operation === "failure"
      ? structuredClone(validateContent(preparationFailureSchema, failureInput, "Preparation failure")) : null;
    if (observedFailure) {
      validatePreparation({ phase: "preparing", initialSessionId, failure: observedFailure }, attemptId);
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching active reservation. Read the current learning state before preparing.", 404);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The active attempt changed. Read the current learning state before preparing.", 404);
      }
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      await verifyProgressLessons(state.progress);
      const current = attempt.preparation;
      let next;
      if (operation === "begin") {
        next = current.phase === "reserved"
          ? { phase: "preparing", initialSessionId: assertValidVibe64SessionId(`training-${attemptId}`) } : current;
      } else {
        if (current.phase === "reserved" || current.initialSessionId !== initialSessionId) {
          throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "Begin and save this attempt's exact session identity before project or session effects.", 409);
        }
        if (operation === "ready") {
          if (current.phase === "ready") {
            next = current;
          } else {
            next = { phase: "ready", initialSessionId, observedAt: new Date().toISOString() };
          }
        } else {
          next = { phase: "preparing", initialSessionId, failure: observedFailure };
        }
      }
      if (canonicalJson(current) === canonicalJson(next)) {
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt, active, replayed: true };
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning preparation changed. Read the current revision before reporting another observation.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. No preparation change was written.");
      }
      validatePreparation(next, attemptId);
      const progress = {
        ...state.progress,
        revision: state.revision + 1,
        attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? { ...attempt, preparation: next } : value)
      };
      validateProgress(progress, paths.learner.id);
      try {
        await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", "Preparation save was not confirmed; atomic rename may already have succeeded. Read or retry this same preparation operation before external effects.", null, { cause });
      }
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt: progress.attempts.find(value => value.attemptId === attemptId), active, replayed: false };
    } finally {
      await release();
    }
  }

  function lessonCompletion(attempt, lesson, attempts = [attempt]) {
    const required = lesson.lesson.assessments.filter(value => value.required).map(value => value.id);
    const passed = passedAssessmentIds(attempt, lesson, attempts).filter(id => required.includes(id));
    return {
      lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash,
      required: required.length,
      passed: passed.length,
      completed: passed.length === required.length
    };
  }

  function validateResume(resume, lesson) {
    if (resume.pendingQuestion && !lesson.lesson.assessments.some(value => value.id === resume.pendingQuestion.assessmentId)) {
      throw new Error("The pending question must name an assessment in the exact pinned lesson.");
    }
    for (const { visualId, snapshot } of resume.visuals) {
      const visual = lesson.visuals.find(value => value.id === visualId)?.visual;
      validateSnapshot(snapshot);
      if (!visual || !visual.states.includes(snapshot.state)) {
        throw new Error("The semantic state must belong to a visual declared in this pinned lesson.");
      }
    }
  }

  function validateLessonLearning(attempt, lesson) {
    if (!attempt.learning) return;
    if (attempt.learning.resume) validateResume(attempt.learning.resume, lesson);
    for (const result of attempt.learning.submissions) {
      const declared = lesson.lesson.assessments.find(value => value.id === result.assessmentId);
      const evidence = result.evidence;
      if (!declared || result.kind !== declared.kind || result.rubric !== declared.rubric ||
          result.rubricRevision !== lesson.hash || declared.kind === "practical" &&
          (evidence.producer !== declared.evidence.producer || evidence.operation !== declared.evidence.operation ||
            evidence.check !== declared.evidence.check)) {
        throw new Error("Saved assessment receipts must match the exact pinned assessment, rubric and evidence contract.");
      }
    }
  }

  // These internal writes receive admitted facts. They do not authenticate the
  // actor, observe a browser, execute checks or grade the learner's answer.
  async function writeLearning({ actor, attemptId, expectedRevision }, operation, { requireCurrent, assertCurrent, signal } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Save learning for the exact attempt with the current state revision.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Resume this learner's saved active attempt before recording learning.", 404);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      if (state.progress.activeAttemptId !== attemptId) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The saved learning attempt changed.", 404);
      }
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      const lessons = await verifyProgressLessons(state.progress);
      const lesson = lessons.get(attempt.attemptId);
      if (requireCurrent) await requireCurrent();
      assertCurrent?.();
      signal?.throwIfAborted();
      const learning = operation(attempt, lesson, state.revision + 1);
      if (learning === false) {
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        return { revision: state.revision, attempt, active, completion: lessonCompletion(attempt, lesson, state.progress.attempts), replayed: true };
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning changed. Read the current revision before another write.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. No change was written.");
      }
      const updated = { ...attempt, learning };
      const progress = { ...state.progress, revision: state.revision + 1,
        attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? updated : value) };
      validateProgress(progress, paths.learner.id);
      validateLessonLearning(updated, lesson);
      try {
        await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", "Learning save was not confirmed; atomic rename may have succeeded. Read or retry the same identity.", null, { cause });
      }
      const active = await saveActive(paths, progress);
      return {
        revision: progress.revision,
        attempt: updated,
        active,
        completion: lessonCompletion(updated, lesson, progress.attempts),
        replayed: false
      };
    } finally {
      await release();
    }
  }

  async function saveLessonResume({ actor, attemptId, expectedRevision, requestId, resume } = {}, facilities) {
    if (!requestPattern.test(requestId || "")) throw new Error("Save a bounded stable resume request ID.");
    const input = structuredClone(validateContent(resumeSchema, { ...resume, requestId, revision: 1 }, "Lesson resume"));
    return writeLearning({ actor, attemptId, expectedRevision }, (attempt, lesson, nextRevision) => {
      validateResume(input, lesson);
      const previous = attempt.learning?.resume;
      const issued = previous?.pendingQuestion;
      const question = input.pendingQuestion;
      if (issued?.issuedRevision && question?.id === issued.id && question.issuedRevision === issued.issuedRevision &&
          canonicalJson(question) !== canonicalJson(issued)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "An issued question cannot change its text, assessment or assistance under the same identity and issued revision.", 409);
      }
      if (previous?.requestId === requestId) {
        if (canonicalJson({ ...previous, revision: 1 }) !== canonicalJson(input)) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This resume request ID already saved different lesson state.", 409);
        }
        return false;
      }
      return { submissions: attempt.learning?.submissions || [], resume: { ...input, revision: nextRevision } };
    }, facilities);
  }

  async function recordAssessment({ actor, attemptId, expectedRevision, submissionId, assessmentId, outcome, evidence, explanation, assistance } = {}, facilities) {
    return writeLearning({ actor, attemptId, expectedRevision }, (attempt, lesson) => {
      const assessment = lesson.lesson.assessments.find(value => value.id === assessmentId);
      if (!assessment) throw new Error("The assessment is not declared in this exact pinned lesson.");
      const input = structuredClone(validateContent(resultSchema, {
        submissionId, assessmentId, kind: assessment.kind, outcome, evidence, explanation, assistance,
        rubric: assessment.rubric, rubricRevision: lesson.hash, recordedAt: new Date().toISOString()
      }, "Assessment result"));
      const existing = attempt.learning?.submissions.find(value => value.submissionId === submissionId);
      if (existing) {
        if (canonicalJson({ ...existing, recordedAt: input.recordedAt }) !== canonicalJson(input)) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This submission ID already records different evidence or a different result.", 409);
        }
        return false;
      }
      const proof = input.evidence;
      if (proof.learnerId !== learnerIdentity(actor).id || proof.attemptId !== attemptId) {
        throw new Error("Assessment evidence belongs to another learner or attempt.");
      }
      if (assessment.kind === "answer") {
        const question = attempt.learning?.resume?.pendingQuestion;
        if (proof.kind !== "answer" || !proof.messageId || !question || question.id !== proof.questionId || question.assessmentId !== assessmentId ||
            Object.keys(proof).some(key => !["kind", "learnerId", "attemptId", "text", "messageId", "questionId"].includes(key))) {
          throw new Error("Answer evidence requires the actual admitted learner message and this saved question identity.");
        }
      } else {
        if (proof.kind !== "observation" || !proof.observationId ||
            proof.projectSlug !== attempt.projectSlug || proof.sessionId !== attempt.preparation.initialSessionId || attempt.preparation.phase !== "ready" ||
            !Number.isFinite(Date.parse(proof.observedAt)) || new Date(proof.observedAt).toISOString() !== proof.observedAt ||
            !proof.origin || input.outcome === "passed" && proof.origin !== "learner" ||
            proof.messageId || proof.questionId) {
          throw new Error("Practical evidence needs this prepared learner attempt's declared native producer, operation and check; demonstrations cannot pass.");
        }
      }
      const reference = proof.kind === "answer" ? "messageId" : "observationId";
      if (attempt.learning?.submissions.some(value => value.evidence.kind === proof.kind && value.evidence[reference] === proof[reference])) {
        throw failure("VIBE64_TRAINING_EVIDENCE_CONFLICT", "This admitted evidence reference has already been consumed by another submission.", 409);
      }
      return { ...(attempt.learning || {}), submissions: [...(attempt.learning?.submissions || []), input] };
    }, facilities);
  }

  async function beginPreparation({ actor, attemptId, expectedRevision } = {}) {
    return writePreparation({ actor, attemptId, expectedRevision }, "begin");
  }

  async function recordPreparationReady({ actor, attemptId, initialSessionId, expectedRevision } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "ready");
  }

  async function recordPreparationFailure({ actor, attemptId, initialSessionId, expectedRevision, stage, code, message } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "failure", { stage, code, message });
  }

  return { readState, readLearningSessionScope, readExerciseProjectScope, reserveAttempt, endAttempt, resumeAttempt, runPreparationExclusive, beginPreparation, recordPreparationReady, recordPreparationFailure, saveLessonResume, recordAssessment };
}

export { createTrainingLearnerState, evidenceSchema, passedAssessmentIds, validateSnapshot };
