import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { normalizeProjectSlug } from "@local/vibe64-core/server/projectState";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { canonicalJson } from "./content.js";
import { list, validateContent } from "./contentSchemas.js";
import {
  failure, inspectDirectoryChain, inspectPath, learnerIdentity, lessonSteps, readRecord, stepReceiptSchema, stepResultSchema,
  validateLessonStepResults, validatePin, validateStepEntry
} from "./learnerState.js";

// Frozen read-only reader of version 1 learner progress (vibe64 0.1.35 up to
// Learning v2 Rev 3), moved unchanged from learnerState.js. Only the published
// 20261008-learning-practice-history upgrade uses it: that upgrade runs before
// the 20261022 reset scraps this format. It never writes. Shared file safety,
// identity, pin and step-result validation come from the live learner state.

const MAX_REQUEST_IDS = 64;
const MAX_ATTEMPTS = 32;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_STEP_RESULTS = 64;
const MAX_STEP_RECEIPTS = 32;
const MAX_STEP_LESSONS = 128;
const MAX_STEP_RECORD_BYTES = 1024 * 1024;
const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const requestPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
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
const lessonKeySchema = createSchema({ code: { ...text, maxLength: 64 }, hash: { ...text, maxLength: 64 } });
const pinSchema = createSchema({
  course: { type: "object", required: true, schema: createSchema({ courseId: { ...text, maxLength: 64 }, release: text }) },
  // The existing installed-pin owner validates this opaque nested object.
  topic: { type: "object", required: true },
  lesson: { type: "object", required: true, schema: lessonKeySchema }
});
const evidenceSchema = createSchema({
  kind: { ...text, enum: ["answer", "observation"] }, learnerId: { ...text, maxLength: 128 },
  attemptId: { ...text, maxLength: 36 }, text: { ...text, maxLength: 2048 },
  messageId: { ...text, required: false, maxLength: 128 }, questionId: { ...text, required: false, maxLength: 64 },
  observationId: { ...text, required: false, maxLength: 128 }, observedAt: { ...text, required: false, maxLength: 24 },
  projectSlug: { ...text, required: false, maxLength: 48 }, sessionId: { ...text, required: false, maxLength: 128 },
  producer: { ...text, required: false, enum: ["workspace", "colleague", "exercise", "code"] },
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
// vibe64 0.1.35 attempts ended with "restart".
const endedSchema = createSchema({
  requestId: { ...text, maxLength: 64 }, revision,
  reason: { ...text, enum: ["left", "finished", "discard", "restart"] }
});
// practiceId names the practice project when the attempt continues one that an
// earlier attempt created; it is stored only when it differs from attemptId.
// projectSlug and preparation exist only for a lesson with an exercise.
const attemptSchema = createSchema({
  attemptId: { ...text, maxLength: 36 }, practiceId: { ...text, required: false, maxLength: 36 },
  requestIds: { ...list({ ...text, maxLength: 64 }, MAX_REQUEST_IDS), minLength: 1 },
  createdAt: { ...text, maxLength: 24 },
  pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, required: false, maxLength: 48 },
  preparation: { type: "object", required: false, schema: preparationSchema },
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
  attemptId: { ...text, maxLength: 36 }, practiceId: { ...text, required: false, maxLength: 36 }, pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, required: false, maxLength: 48 }, preparation: { type: "object", required: false, schema: preparationSchema },
  learning: { type: "object", required: false, schema: learningSchema }
});

const emptyActiveSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, nullable: true, maxLength: 36 }
});
// Version 2 step results: a separate append-only per-learner record with its
// own lock, so frequent step writes never advance the progress revision. They
// are kept per lesson content (code and hash), so every attempt of the same
// lesson content shares them and pruning an attempt never loses a pass.
const stepProgressSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [2] }, learnerId: { ...text, maxLength: 128 }, revision,
  lessons: list(createSchema({ lesson: { type: "object", required: true, schema: lessonKeySchema },
    results: list(stepResultSchema, MAX_STEP_RESULTS),
    receipts: { ...list(stepReceiptSchema, MAX_STEP_RECEIPTS), required: false } }), MAX_STEP_LESSONS)
});

function validateStepProgress(value, learnerId) {
  const record = validateContent(stepProgressSchema, value, "Learner step progress");
  if (record.learnerId !== learnerId) throw new Error("Step progress belongs to another learner.");
  const lessonKeys = new Set();
  for (const entry of record.lessons) {
    const key = canonicalJson(entry.lesson);
    if (!idPattern.test(entry.lesson.code) || !sha256Pattern.test(entry.lesson.hash) || lessonKeys.has(key)) {
      throw new Error("Step progress names a repeated or invalid lesson content identity.");
    }
    lessonKeys.add(key);
    validateStepEntry(entry);
  }
  if (Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`) > MAX_STEP_RECORD_BYTES) {
    throw new Error("Step progress exceeds its 1 MiB record limit. No result was removed or written.");
  }
  return record;
}

// The saved step results of one lesson content, or an empty entry.
function lessonStepEntry(lessons, lesson) {
  const key = canonicalJson({ code: lesson.code, hash: lesson.hash });
  return lessons.find(entry => canonicalJson(entry.lesson) === key) || { lesson: { code: lesson.code, hash: lesson.hash }, results: [] };
}

// Only a version 1 lesson has assessments, rubrics and a teaching document.
// Every reader of that data checks this first, so a version 2 lesson never
// reaches an assessment path.
function assessmentLesson(lesson) {
  return lesson?.lesson?.schemaVersion === 1;
}

// The practice project an attempt works in: its own, or the continued one.
function attemptPracticeId(attempt) {
  return attempt.practiceId ?? attempt.attemptId;
}

const practiceSlugFor = practiceId => normalizeProjectSlug(`training-${practiceId.replaceAll("-", "")}`);

// An attempt prepares the practice project's own session, or (continuing a
// project whose session is gone) a new session named after the attempt.
function preparationSessionIds(attempt) {
  return new Set([`training-${attemptPracticeId(attempt)}`, `training-${attempt.attemptId}`]);
}

function validatePreparation(preparation, attempt) {
  if (preparation.phase === "reserved") {
    if (canonicalJson(preparation) !== canonicalJson({ phase: "reserved" })) {
      throw new Error("A reserved attempt must not contain preparation effects or a session identity.");
    }
    return;
  }
  if (!preparationSessionIds(attempt).has(preparation.initialSessionId) ||
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
  if (!uuidPattern.test(attempt.attemptId) || attempt.practiceId !== undefined &&
      (!uuidPattern.test(attempt.practiceId) || attempt.practiceId === attempt.attemptId)) {
    throw new Error("Learning state has an invalid attempt or practice project identity.");
  }
  if (attempt.preparation) validatePreparation(attempt.preparation, attempt);
  // An attempt without preparation (its lesson has no exercise) names no practice project.
  const projectSlug = attempt.preparation ? practiceSlugFor(attemptPracticeId(attempt)) : undefined;
  if (attempt.projectSlug !== projectSlug || !attempt.preparation && attempt.practiceId !== undefined ||
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
    ...(attempt.practiceId ? { practiceId: attempt.practiceId } : {}),
    pin: attempt.pin,
    ...(attempt.preparation ? { projectSlug: attempt.projectSlug, preparation: attempt.preparation } : {}),
    ...(attempt.learning ? { learning: attempt.learning } : {})
  };
}

function passedAssessmentIds(attempt, lesson, attempts = [attempt]) {
  if (!assessmentLesson(lesson)) return [];
  const matching = attempts.filter(value => canonicalJson(value.pin.lesson) === canonicalJson(attempt.pin.lesson));
  return lesson.lesson.assessments.filter(assessment => matching.some(value => value.learning?.submissions.some(result =>
    result.assessmentId === assessment.id && result.rubricRevision === lesson.hash && result.outcome === "passed")))
    .map(assessment => assessment.id);
}

function createPracticeHistoryReader({ systemRoot, content } = {}) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Learning state needs a canonical absolute, non-root server-owned system root.");
  }
  const installed = content;
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
      preparationLock: path.join(userRoot, "preparation.lock"),
      stepProgress: path.join(userRoot, "step-progress.json")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress, MAX_RECORD_BYTES);
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
      const savedActive = await readRecord(paths.active, MAX_RECORD_BYTES);
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
          if (active.preparation) validatePreparation(active.preparation, active);
          validateLearning(active.learning, active, active.learnerId, active.progressRevision);
          const attemptIndex = progress.attempts.findIndex(attempt => attempt.attemptId === active.attemptId);
          const retained = progress.attempts[attemptIndex];
          const previousEndRevision = progress.attempts[attemptIndex - 1]?.ended?.revision || 0;
          const expectedRevision = retained?.ended ? retained.ended.revision - 1 : progress.revision;
          const expected = retained && deriveActive({ ...progress, activeAttemptId: retained.attemptId, revision: expectedRevision });
          if (previousEndRevision && active.progressRevision <= previousEndRevision) throw new Error("Active summary predates this attempt's reservation.");
          let preparation = active.preparation;
          if (preparation && expected?.preparation && active.progressRevision < expectedRevision) {
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
          let projected = { ...active, progressRevision: expectedRevision, ...(preparation ? { preparation } : {}) };
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

  async function verifyInstalled(pin, { admissionOnly = false } = {}) {
    const read = admissionOnly && typeof installed.readAdmissionIdentity === "function"
      ? installed.readAdmissionIdentity : installed.readLesson;
    const lesson = await read.call(installed, { ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash });
    if (canonicalJson(lesson.pin) !== canonicalJson(pin.topic)) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return lesson;
  }

  // Each distinct pinned lesson is verified once per read, however many
  // attempts (every leave and continue adds one) share it.
  async function verifyProgressLessons(progress) {
    const lessons = new Map();
    const verified = new Map();
    for (const attempt of progress.attempts) {
      const key = canonicalJson([attempt.pin.topic, attempt.pin.lesson]);
      if (!verified.has(key)) verified.set(key, await verifyInstalled(attempt.pin));
      const lesson = verified.get(key);
      validateLessonPractice(attempt, lesson);
      validateLessonLearning(attempt, lesson);
      lessons.set(attempt.attemptId, lesson);
    }
    return lessons;
  }

  async function readState({ actor, includeCompletion = false } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    if (includeCompletion !== true) return state;
    const lessons = await verifyProgressLessons(state.progress);
    const { lessons: stepLessons } = await readLessonStepProgress(paths, state.progress, lessons);
    // Read-only per-lesson summary of the same verified passes; a lesson counts
    // in every course that contains its exact code and hash.
    const byLesson = new Map();
    for (const attempt of state.progress.attempts) {
      const key = canonicalJson(attempt.pin.lesson);
      const saved = byLesson.get(key) ||
        { ...lessonCompletion(attempt, lessons.get(attempt.attemptId), state.progress.attempts, stepLessons), open: false };
      saved.open ||= !attempt.ended;
      byLesson.set(key, saved);
    }
    const lessonCompletions = [...byLesson.values()];
    if (!state.active) return { ...state, completion: null, lessonCompletions };
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    return { ...state, completion: lessonCompletion(attempt, lessons.get(attempt.attemptId), state.progress.attempts, stepLessons), lessonCompletions };
  }

  // The exact bundled exercise of a saved attempt, with the original refusal
  // precedence: installed pin, no exercise, inactive work, unavailable reader.
  async function readAttemptExercise(state, attempt, access) {
    const active = state.progress.activeAttemptId === attempt.attemptId && !attempt.ended;
    const workInactive = (access === "write" || access === "create") && (!active || !state.activeSummaryCurrent);
    // Refusals retain the original installed-pin/no-exercise precedence. Admitted
    // reads use readExercise's existing lesson validation instead of repeating it.
    if (workInactive || typeof installed.readExercise !== "function") {
      const lesson = await verifyInstalled(attempt.pin);
      if (!lesson.lesson.exercise) {
        throw failure("VIBE64_TRAINING_EXERCISE_MISSING", "This saved lesson has no practice project. Use its source-less learning conversation.", 409);
      }
      if (workInactive) {
        throw failure("VIBE64_TRAINING_ATTEMPT_INACTIVE", "Resume this exact confirmed active lesson before admitting practice work.", 409);
      }
      throw failure("VIBE64_TRAINING_EXERCISE_UNAVAILABLE", "This installed content reader cannot supply the lesson's exact bundled exercise.", 409);
    }
    let exercise;
    try {
      exercise = await installed.readExercise({ ...attempt.pin.topic,
        lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash, metadataOnly: true,
        admissionOnly: access === "observe" || access === "control" });
    } catch (error) {
      if (error?.code === "VIBE64_TRAINING_EXERCISE_MISSING") {
        await verifyInstalled(attempt.pin);
        throw failure("VIBE64_TRAINING_EXERCISE_MISSING", "This saved lesson has no practice project. Use its source-less learning conversation.", 409);
      }
      throw error;
    }
    if (canonicalJson(exercise.pin) !== canonicalJson(attempt.pin.topic) ||
        exercise.lessonCode !== attempt.pin.lesson.code || exercise.lessonHash !== attempt.pin.lesson.hash) {
      throw new Error("The installed topic differs from the admitted reservation pin.");
    }
    return { active, sourcePath: exercise.sourcePath };
  }

  function exerciseScope(paths, state, attempt, { active, training }) {
    return {
      scope: { learnerId: paths.learner.id, attemptId: attempt.attemptId, pin: structuredClone(attempt.pin), noExercise: false },
      systemRoot,
      training,
      projectSlug: attempt.projectSlug,
      ...(attempt.preparation.initialSessionId ? { initialSessionId: attempt.preparation.initialSessionId } : {}),
      active, activeSummaryCurrent: state.activeSummaryCurrent
    };
  }

  // The upgrade compares the result with a version 1 project marker: one
  // attempt, its own project and the version 1 marker.
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
    if (attempt.practiceId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_CONFLICT", "This attempt continues a learning-space practice project; read it by its practice project.", 409);
    }
    const { active, sourcePath } = await readAttemptExercise(state, attempt, access);
    return exerciseScope(paths, state, attempt, { active, training: { schemaVersion: 1, learnerKey: paths.learner.key,
      attemptId, pin: structuredClone(attempt.pin), exercise: { kind: "bundled", sourcePath } } });
  }

  // v2 completes when every required step has passed for this lesson content.
  // v1 (read only, for published upgrades) counts its saved assessment passes.
  function lessonCompletion(attempt, lesson, attempts = [attempt], stepLessons = []) {
    const steps = lessonSteps(lesson);
    let required;
    let passed;
    if (steps) {
      const { results } = lessonStepEntry(stepLessons, attempt.pin.lesson);
      required = steps.filter(value => value.required).map(value => value.id);
      passed = required.filter(id => results.some(result => result.stepId === id && result.outcome === "passed"));
    } else if (assessmentLesson(lesson)) {
      required = lesson.lesson.assessments.filter(value => value.required).map(value => value.id);
      passed = passedAssessmentIds(attempt, lesson, attempts).filter(id => required.includes(id));
    } else {
      throw new Error(`Lesson ${lesson.lesson.code} uses an unsupported format.`);
    }
    return {
      lessonCode: lesson.lesson.code,
      lessonHash: lesson.hash,
      required: required.length,
      passed: passed.length,
      completed: passed.length === required.length
    };
  }

  function validateResume(resume, lesson) {
    if (!assessmentLesson(lesson)) throw new Error("A lesson resume checkpoint belongs only to a version 1 lesson.");
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

  // An exercise lesson's attempt names its practice project and preparation;
  // any other attempt names none. Read only: vibe64 0.1.35 reserved a project
  // for every lesson, and the published 20261008-learning-practice-history
  // upgrade still reads that progress.
  function validateLessonPractice(attempt, lesson) {
    if (lesson.lesson.exercise ? !attempt.preparation : attempt.preparation && attempt.preparation.phase !== "reserved") {
      throw new Error("An attempt names a practice project exactly when its lesson declares an exercise.");
    }
  }

  function validateLessonLearning(attempt, lesson) {
    if (!attempt.learning) return;
    if (!assessmentLesson(lesson)) throw new Error("A version 2 lesson records step results, not assessment learning.");
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

  async function readStepProgressRecord(paths) {
    const value = await readRecord(paths.stepProgress, MAX_STEP_RECORD_BYTES);
    return value ? validateStepProgress(value, paths.learner.id) : null;
  }

  // Entries of retained lesson content are checked against that pinned lesson.
  async function readLessonStepProgress(paths, progress, lessons) {
    try {
      const record = await readStepProgressRecord(paths);
      for (const entry of record?.lessons || []) {
        const attempt = progress.attempts.find(value => canonicalJson(value.pin.lesson) === canonicalJson(entry.lesson));
        if (attempt) validateLessonStepResults(entry, lessons.get(attempt.attemptId));
      }
      return { revision: record?.revision || 0, lessons: record?.lessons || [] };
    } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID",
        `Learning step progress is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`, null, { cause });
    }
  }

  return { readState, readExerciseProjectScope };
}

export { createPracticeHistoryReader };
