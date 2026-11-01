import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { practiceSlug } from "@local/vibe64-core/server/learningSpace";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";

import { LEARNER_NOTES_MAX_CHARS as MAX_NOTES_CHARS } from "../shared/learnerContract.js";
import { canonicalJson } from "./content.js";
import { lessonHasSteps, list, validateContent } from "./contentSchemas.js";
import { trainingFailure } from "./errors.js";
import { validateInstalledTopicPin } from "./installedContent.js";

// A learner's saved records: their schemas and limits, validation of
// progress, attempts, pins and step results, the learner's identity and the
// file checks every read and write of them repeats.
// One learner's Learning state (Rev 4 contract C1). An attempt is one run of a
// lesson; at most one is in progress (the last one, named by activeAttemptId).
// Its step results, code ledger and practice project belong to it alone.
// Completion outlives attempts in completedLessons, so pruning ended attempts
// and deleting archives never un-complete a lesson.
const MAX_REQUEST_IDS = 64;

const MAX_ATTEMPTS = 32;

const MAX_COMPLETED_LESSONS = 256;

const MAX_RECORD_BYTES = 128 * 1024;

const MAX_STEP_RESULTS = 64;

const MAX_STEP_RECEIPTS = 32;

const MAX_STEP_RECORD_BYTES = 1024 * 1024;

const MAX_READER_BYTES = 4096;

const MAX_NOTES_BYTES = 32 * 1024;

const MAX_NOTES_REQUESTS = 32;

const MAX_MODE_BYTES = 1024;

const MAX_REVIEW_HELPER_BYTES = 16 * 1024;

const STEP_LOCK_WAIT_MS = 2000;

const isoTime = value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// Browser receipts and Preview output starts hold the preparation barrier only
// briefly. Wait this long before reporting a genuinely long operation as busy.
const PREPARATION_BUSY_WAIT_MS = 5000;

const END_REASONS = ["finished", "archived", "deleted"];

const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

const uuidAnyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

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
  failure: { type: "object", required: false, schema: preparationFailureSchema },
  // The verified exercise commit the practice session started from (new
  // preparations only): an AI review reads the learner's changes against it.
  startCommit: { ...text, required: false, maxLength: 64 }
});

const lessonKeySchema = createSchema({ code: { ...text, maxLength: 64 }, hash: { ...text, maxLength: 64 } });

const pinSchema = createSchema({
  course: { type: "object", required: true, schema: createSchema({ courseId: { ...text, maxLength: 64 }, release: text }) },
  // The existing installed-pin owner validates this opaque nested object.
  topic: { type: "object", required: true },
  lesson: { type: "object", required: true, schema: lessonKeySchema }
});

const endedSchema = createSchema({
  requestId: { ...text, maxLength: 64 },
  revision,
  reason: { ...text, enum: END_REASONS }
});

// projectSlug and preparation exist only for a lesson with an exercise.
const attemptSchema = createSchema({
  attemptId: { ...text, maxLength: 36 },
  requestIds: { ...list({ ...text, maxLength: 64 }, MAX_REQUEST_IDS), minLength: 1 },
  createdAt: { ...text, maxLength: 24 },
  pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, required: false, maxLength: 48 },
  preparation: { type: "object", required: false, schema: preparationSchema },
  ended: { type: "object", required: false, schema: endedSchema }
});

const progressSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [2] },
  learnerId: { ...text, maxLength: 128 },
  revision,
  activeAttemptId: { ...text, maxLength: 36, nullable: true },
  completedLessons: list(createSchema({
    code: { ...text, maxLength: 64 },
    hash: { ...text, maxLength: 64 },
    completedAt: { ...text, maxLength: 24 }
  }), MAX_COMPLETED_LESSONS),
  attempts: list(attemptSchema, MAX_ATTEMPTS)
});

const activeSchema = createSchema({
  schemaVersion: version,
  learnerId: { ...text, maxLength: 128 },
  progressRevision: revision,
  attemptId: { ...text, maxLength: 36 },
  pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, required: false, maxLength: 48 },
  preparation: { type: "object", required: false, schema: preparationSchema }
});

const emptyActiveSchema = createSchema({
  schemaVersion: version,
  learnerId: { ...text, maxLength: 128 },
  progressRevision: revision,
  attemptId: { ...text, nullable: true, maxLength: 36 }
});

// Version 2: an earlier release wrote a different version 1 shape here.
const modeSchema = createSchema({
  schemaVersion: {
    type: "integer",
    required: true,
    enum: [2]
  },
  learnerId: {
    ...text,
    maxLength: 128
  },
  on: {
    type: "boolean",
    required: true
  }
});

const MAX_CODE_LEDGER_ENTRIES = 256;

const MAX_CODE_LEDGER_STEPS = 32;

const MAX_CODE_LEDGER_BYTES = 256 * 1024;

const codeFileSchema = createSchema({ path: { ...text, maxLength: 512 }, sha256: { ...text, maxLength: 64 } });

// One ledger per in-progress attempt (code-ledgers/<attemptId>.json). Each
// code step keeps its own baseline, keyed on the step and the step-progress
// revision at which the learner first entered it, and the index of the first
// save made after that entry; all saves share one log.
const codeLedgerSchema = createSchema({
  schemaVersion: {
    type: "integer",
    required: true,
    enum: [2]
  },
  learnerId: {
    ...text,
    maxLength: 128
  },
  attemptId: {
    ...text,
    maxLength: 36
  },
  steps: {
    ...list(createSchema({
      stepId: { ...text, maxLength: 64 },
      enteredRevision: revision,
      entryStart: { type: "integer", required: true, min: 0, max: MAX_CODE_LEDGER_ENTRIES },
      baseline: list(codeFileSchema, 8)
    }), MAX_CODE_LEDGER_STEPS),
    minLength: 1
  },
  entries: list(createSchema({
    path: { ...text, maxLength: 512 },
    baseHash: { ...text, maxLength: 64 },
    savedHash: { ...text, maxLength: 64 },
    intendedHash: { ...text, maxLength: 64 },
    actorId: { ...text, maxLength: 128 },
    at: { ...text, maxLength: 24 },
    saves: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER }
  }), MAX_CODE_LEDGER_ENTRIES)
});

function validateCodeLedger(value) {
  const ledger = validateContent(codeLedgerSchema, value, "Code authorship ledger");
  const baselines = ledger.steps.map(step => step.baseline);
  const tracked = new Set(baselines.flat().map(file => file.path));
  const hashes = [...baselines.flat().map(file => file.sha256),
    ...ledger.entries.flatMap(entry => [entry.baseHash, entry.savedHash, entry.intendedHash])];
  if (!uuidPattern.test(ledger.attemptId) || new Set(ledger.steps.map(step => step.stepId)).size !== ledger.steps.length ||
      ledger.steps.some(step => !idPattern.test(step.stepId) || step.entryStart > ledger.entries.length) ||
      hashes.some(hash => !sha256Pattern.test(hash)) || baselines.some(files =>
        new Set(files.map(file => file.path)).size !== files.length) ||
      ledger.entries.some(entry => !tracked.has(entry.path) || !isoTime(entry.at))) {
    throw new Error("The code authorship ledger has an invalid identity, hash, file or record time.");
  }
  return ledger;
}

// Step results: a separate append-only record of the attempt in progress, with
// its own lock, so frequent step writes never advance the progress revision.
// A new attempt's first result replaces it; ending the attempt removes it.
// A review result also keeps the reviewer's feedback for the learner.
const reviewFeedbackSchema = createSchema({
  comment: { ...text, maxLength: 600 },
  hint: { ...text, required: false, maxLength: 300 },
  points: { ...list(createSchema({ text: { ...text, maxLength: 120 }, met: { type: "boolean", required: true } }), 6), required: false }
});

const stepResultSchema = createSchema({
  stepId: { ...text, maxLength: 64 },
  kind: { ...text, enum: ["auto", "choice", "review", "self", "read", "fact"] },
  outcome: { ...text, enum: ["passed", "not-yet-passed"] },
  evidence: { type: "object", required: true },
  origin: { ...text, enum: ["learner", "check"] },
  requestId: { ...text, maxLength: 64 },
  recordedAt: { ...text, maxLength: 24 },
  reason: { ...text, required: false },
  review: { type: "object", required: false, schema: reviewFeedbackSchema }
});

// The latest learner-origin exercise interaction captured by the browser for a
// step; a later check run re-verifies it against the same App run identities.
const stepReceiptSchema = createSchema({
  stepId: { ...text, maxLength: 64 },
  checkId: { ...text, maxLength: 64 },
  observationId: { ...text, maxLength: 128 },
  instanceId: { ...text, maxLength: 36 },
  interactionId: { ...text, maxLength: 36 },
  requestId: { ...text, maxLength: 36 },
  sessionId: { ...text, maxLength: 128 },
  observedAt: { ...text, maxLength: 24 }
});

const stepProgressSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [3] },
  learnerId: { ...text, maxLength: 128 },
  revision,
  attemptId: { ...text, maxLength: 36 },
  lesson: { type: "object", required: true, schema: lessonKeySchema },
  results: list(stepResultSchema, MAX_STEP_RESULTS),
  receipts: list(stepReceiptSchema, MAX_STEP_RECEIPTS)
});

const readerSchema = createSchema({
  schemaVersion: version,
  learnerId: { ...text, maxLength: 128 },
  attemptId: { ...text, maxLength: 36 },
  stepId: { ...text, maxLength: 64 },
  scroll: { type: "number", required: true, min: 0, max: 10_000_000 }
});

const notesText = { type: "string", required: true, noTrim: true, minLength: 0, maxLength: MAX_NOTES_CHARS };

const notesSchema = createSchema({
  schemaVersion: version,
  learnerId: { ...text, maxLength: 128 },
  revision,
  text: notesText,
  updatedAt: { ...text, maxLength: 24 },
  updatedBy: { ...text, enum: ["colleague", "learner"] },
  // Recent writes for request-ID replay; the oldest identity leaves this window.
  requests: list(createSchema({
    requestId: { ...text, maxLength: 64 },
    textHash: { ...text, maxLength: 64 },
    revision
  }), MAX_NOTES_REQUESTS)
});

const byteSize = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);

function validateStepEvidence(result) {
  const { kind, evidence } = result;
  const keys = Object.keys(evidence || {}).sort();
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (kind === "self" || kind === "read") return keys.length === 0 && result.origin === "learner";
  // A fact check's answer, read by its registered reader when the learner asked.
  if (kind === "fact") {
    return result.origin === "check" && canonicalJson(keys) === canonicalJson(["fact"]) && idPattern.test(evidence.fact || "");
  }
  if (kind === "review") {
    return result.origin === "check" && canonicalJson(keys) === canonicalJson(["evidenceHash", "reviewId"]) &&
      uuidAnyPattern.test(evidence.reviewId || "") && sha256Pattern.test(evidence.evidenceHash || "");
  }
  if (kind === "choice") {
    return result.origin === "learner" && canonicalJson(keys) === canonicalJson(["selected"]) && Array.isArray(evidence.selected) &&
      evidence.selected.length <= 8 && new Set(evidence.selected).size === evidence.selected.length &&
      evidence.selected.every(value => Number.isSafeInteger(value) && value >= 0 && value < 8);
  }
  return result.origin === "check" && keys.every(key => ["checkId", "observationId", "filesHash"].includes(key)) &&
    idPattern.test(evidence.checkId || "") && (evidence.observationId === undefined || requestPattern.test(evidence.observationId)) &&
    (evidence.filesHash === undefined || sha256Pattern.test(evidence.filesHash));
}

/**
 * The results and receipts of one lesson content; shared with the frozen
 * practice-history reader, whose version 2 record keeps one entry per lesson.
 */
function validateStepEntry(entry) {
  if (!idPattern.test(entry.lesson.code) || !sha256Pattern.test(entry.lesson.hash)) {
    throw new Error("Step progress names an invalid lesson content identity.");
  }
  const requestIds = new Set();
  for (const result of entry.results) {
    if (!idPattern.test(result.stepId) || !requestPattern.test(result.requestId) || requestIds.has(result.requestId) ||
        !isoTime(result.recordedAt) || !validateStepEvidence(result) || (result.kind === "review") !== (result.review !== undefined) ||
        [result.reason, result.review?.comment, result.review?.hint, ...(result.review?.points || []).map(point => point.text)]
          // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in saved reasons.
          .some(value => value !== undefined && /[\u0000-\u001f\u007f]/u.test(value))) {
      throw new Error("Step results have an invalid step, request identity, evidence, origin or record time.");
    }
    requestIds.add(result.requestId);
  }
  const receiptSteps = new Set();
  for (const receipt of entry.receipts || []) {
    if (!idPattern.test(receipt.stepId) || receiptSteps.has(receipt.stepId) || !idPattern.test(receipt.checkId) ||
        !requestPattern.test(receipt.observationId) || ![
          receipt.instanceId,
          receipt.interactionId,
          receipt.requestId
        ].every(id => uuidAnyPattern.test(id)) ||
        !validSessionId(receipt.sessionId) || !isoTime(receipt.observedAt)) {
      throw new Error("Step receipts have an invalid step, interaction identity, session or time.");
    }
    receiptSteps.add(receipt.stepId);
  }
}

function validateStepProgress(value, learnerId) {
  const record = validateContent(stepProgressSchema, value, "Learner step progress");
  if (record.learnerId !== learnerId) throw new Error("Step progress belongs to another learner.");
  if (!uuidPattern.test(record.attemptId)) throw new Error("Step progress names an invalid attempt.");
  validateStepEntry(record);
  if (byteSize(record) > MAX_STEP_RECORD_BYTES) {
    throw new Error("Step progress exceeds its 1 MiB record limit. No result was removed or written.");
  }
  return record;
}

/**
 * Receipts bound only the session ID's format: the check runner compares it
 * with the attempt's own prepared session at use.
 */
function validSessionId(sessionId) {
  try { return assertValidVibe64SessionId(sessionId) === sessionId; } catch { return false; }
}

function lessonSteps(lesson) {
  return lessonHasSteps(lesson.lesson) && Array.isArray(lesson.lesson.steps) ? lesson.lesson.steps : null;
}

/**
 * The result kind a step's declared check records: a reading step (check
 * "none") records the learner's own "read" mark.
 */
const resultKind = step => step.check?.kind === "none" ? "read" : step.check?.kind;

/**
 * Saved step results must match the exact pinned version 2 lesson.
 */
function validateLessonStepResults(entry, lesson) {
  const steps = lessonSteps(lesson);
  if (!steps) throw new Error("Step results belong only to a version 2 lesson.");
  for (const result of entry.results) {
    const step = steps.find(value => value.id === result.stepId);
    if (!step || resultKind(step) !== result.kind || result.kind === "auto" && result.evidence.checkId !== step.check.check ||
        result.kind === "fact" && result.evidence.fact !== step.check.fact) {
      throw new Error("Saved step results must match the exact pinned lesson step and its declared check.");
    }
  }
  for (const receipt of entry.receipts || []) {
    const step = steps.find(value => value.id === receipt.stepId);
    if (step?.check?.kind !== "auto" || step.check.check !== receipt.checkId) {
      throw new Error("Saved step receipts must match the exact pinned lesson step's automatic check.");
    }
  }
}

/**
 * Step progress and the reader position use their own short locks so they
 * never contend with progress.json writers or the preparation barrier.
 * @param {string} lockPath
 * @param {string} code
 * @param {string} message
 */
async function acquireRecordLock(lockPath, code, message) {
  const existing = await inspectPath(lockPath, false);
  if (existing && existing.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
  let release = await tryAcquireExclusiveFileLock(lockPath);
  for (const deadline = Date.now() + STEP_LOCK_WAIT_MS; !release && Date.now() < deadline;) {
    await new Promise(resolve => setTimeout(resolve, 50));
    release = await tryAcquireExclusiveFileLock(lockPath);
  }
  if (!release) throw failure(code, message, 409);
  return release;
}

/**
 * Learner records live under one canonical, absolute, non-root server-owned system root.
 * @param {string} systemRoot
 */
function assertLearningSystemRoot(systemRoot) {
  if (typeof systemRoot !== "string" ||
      !path.isAbsolute(systemRoot) ||
      path.resolve(systemRoot) !== systemRoot ||
      systemRoot === path.parse(systemRoot).root) {
    throw new Error("Learning state needs a canonical absolute, non-root server-owned system root.");
  }
}

function failure(code, message, statusCode, details = {}) {
  return trainingFailure(code, message, { statusCode, ...details });
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
      !idPattern.test(pin.lesson.code) || !sha256Pattern.test(pin.lesson.hash)) {
    throw new Error("Reserve the exact course release, installed topic pin and published lesson hash.");
  }
  return { course: { ...pin.course }, topic: { ...pin.topic }, lesson: { ...pin.lesson } };
}

/**
 * The single session an attempt with a practice project prepares.
 */
const attemptSessionId = attemptId => `training-${attemptId}`;

function validatePreparation(preparation, attemptId) {
  if (preparation.phase === "reserved") {
    if (canonicalJson(preparation) !== canonicalJson({ phase: "reserved" })) {
      throw new Error("A reserved attempt must not contain preparation effects or a session identity.");
    }
    return;
  }
  if (preparation.initialSessionId !== attemptSessionId(attemptId) ||
      assertValidVibe64SessionId(preparation.initialSessionId) !== preparation.initialSessionId) {
    throw new Error("Preparation must retain the exact server-reserved initial session identity.");
  }
  if (preparation.phase === "ready") {
    if (!isoTime(preparation.observedAt) || preparation.failure) {
      throw new Error("Ready preparation requires an observed time and no unresolved failure.");
    }
  } else if (preparation.observedAt) {
    throw new Error("Pending preparation must not claim an observed ready time.");
  }
  if (preparation.startCommit !== undefined && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(preparation.startCommit)) {
    throw new Error("Preparation must name its start commit as an exact Git object ID.");
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
  if (!uuidPattern.test(attempt.attemptId)) throw new Error("Learning state has an invalid attempt identity.");
  if (attempt.preparation) validatePreparation(attempt.preparation, attempt.attemptId);
  // An attempt without preparation (its lesson has no exercise) names no practice project.
  const projectSlug = attempt.preparation ? practiceSlug(attempt.attemptId) : undefined;
  if (attempt.projectSlug !== projectSlug || !isoTime(attempt.createdAt) ||
      !attempt.requestIds.length || attempt.requestIds.some(id =>
        !requestPattern.test(id)) || new Set(attempt.requestIds).size !== attempt.requestIds.length) {
    throw new Error("Learning state has an invalid attempt identity, reservation time or retry inventory.");
  }
}

function validateProgress(value, learnerId) {
  const progress = validateContent(progressSchema, value, "Learner progress");
  if (progress.learnerId !== learnerId || (!progress.attempts.length &&
      (progress.activeAttemptId !== null || progress.revision !== 0))) {
    throw new Error("Learning state differs from its learner or active reservation.");
  }
  const completed = new Set();
  for (const lesson of progress.completedLessons) {
    const key = canonicalJson({ code: lesson.code, hash: lesson.hash });
    if (!idPattern.test(lesson.code) || !sha256Pattern.test(lesson.hash) || !isoTime(lesson.completedAt) || completed.has(key)) {
      throw new Error("Completed lessons repeat or have an invalid lesson identity or completion time.");
    }
    completed.add(key);
  }
  const attemptIds = new Set();
  const requestIds = new Set();
  let endedRevision = 0;
  let activeCount = 0;
  for (const [index, attempt] of progress.attempts.entries()) {
    validateAttempt(attempt);
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
        throw new Error("Learning history must contain exactly one lesson in progress at its declared identity.");
      }
    }
  }
  if (activeCount === 0 ? progress.activeAttemptId !== null || progress.revision !== endedRevision : progress.activeAttemptId === null) {
    throw new Error("Learning history must contain exactly one lesson in progress or only ended attempts.");
  }
  if (byteSize(progress) > MAX_RECORD_BYTES) {
    throw new Error(`Learning state exceeds its ${MAX_RECORD_BYTES / 1024} KiB record limit. Nothing was removed or written.`);
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
    ...(attempt.preparation ? { projectSlug: attempt.projectSlug, preparation: attempt.preparation } : {})
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
  if (stat.isSymbolicLink() ||
      await realpath(filename) !== filename ||
      (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (!directory && stat.nlink !== 1)) {
    throw new Error("Learning state requires canonical regular paths without symlink or file aliases.");
  }
  return stat;
}

async function inspectDirectoryChain(directory) {
  const parent = path.dirname(directory);
  if (parent !== directory) await inspectDirectoryChain(parent);
  return inspectPath(directory, true);
}

async function readRecord(filename, limit = MAX_RECORD_BYTES) {
  const stat = await inspectPath(filename, false);
  if (!stat) return null;
  const exceeded = `Learning state exceeds its ${limit / 1024} KiB record limit.`;
  if (stat.size > limit) throw new Error(exceeded);
  const bytes = await readFile(filename);
  if (bytes.length > limit) throw new Error(exceeded);
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Learning state must contain a versioned record object.");
  }
  return value;
}

/**
 * Markdown text: line breaks and tabs, no other control characters.
 */
function validNotesText(value) {
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner notes.
  return typeof value === "string" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

/**
 * The saved results of this attempt, or a fresh empty entry: a record left by
 * an earlier attempt belongs to nobody now.
 */
function attemptStepEntry(record, attempt) {
  return record?.attemptId === attempt.attemptId
    ? { lesson: record.lesson, results: record.results, receipts: record.receipts }
    : { lesson: { code: attempt.pin.lesson.code, hash: attempt.pin.lesson.hash }, results: [], receipts: [] };
}

/**
 * A step lesson completes when every required step available to the learner
 * here (lessonAvailability.js) has passed in this attempt.
 */
function lessonCompletion(lesson, entry, available) {
  const steps = lessonSteps(lesson);
  if (!steps) throw new Error(`Lesson ${lesson.lesson.code} uses an unsupported format.`);
  const required = steps.filter(value => value.required && available.has(value.id)).map(value => value.id);
  const passed = required.filter(id => entry.results.some(result => result.stepId === id && result.outcome === "passed"));
  return {
    lessonCode: lesson.lesson.code,
    lessonHash: lesson.hash,
    required: required.length,
    passed: passed.length,
    completed: passed.length === required.length
  };
}

export {
  acquireRecordLock,
  assertLearningSystemRoot,
  activeSchema,
  attemptSchema,
  attemptSessionId,
  attemptStepEntry,
  byteSize,
  codeFileSchema,
  codeLedgerSchema,
  deriveActive,
  emptyActiveSchema,
  END_REASONS,
  endedSchema,
  failure,
  idPattern,
  inspectDirectoryChain,
  inspectPath,
  isoTime,
  learnerIdentity,
  lessonCompletion,
  lessonKeySchema,
  lessonSteps,
  MAX_ATTEMPTS,
  MAX_CODE_LEDGER_BYTES,
  MAX_CODE_LEDGER_ENTRIES,
  MAX_CODE_LEDGER_STEPS,
  MAX_COMPLETED_LESSONS,
  MAX_MODE_BYTES,
  MAX_NOTES_BYTES,
  MAX_NOTES_REQUESTS,
  MAX_READER_BYTES,
  MAX_RECORD_BYTES,
  MAX_REQUEST_IDS,
  MAX_REVIEW_HELPER_BYTES,
  MAX_STEP_RECEIPTS,
  MAX_STEP_RECORD_BYTES,
  MAX_STEP_RESULTS,
  modeSchema,
  notesSchema,
  notesText,
  pinSchema,
  PREPARATION_BUSY_WAIT_MS,
  preparationFailureSchema,
  preparationSchema,
  progressSchema,
  readerSchema,
  readRecord,
  requestPattern,
  resultKind,
  reviewFeedbackSchema,
  revision,
  sha256Pattern,
  STEP_LOCK_WAIT_MS,
  stepProgressSchema,
  stepReceiptSchema,
  stepResultSchema,
  text,
  uuidAnyPattern,
  uuidPattern,
  validateAttempt,
  validateCodeLedger,
  validateLessonStepResults,
  validatePin,
  validatePreparation,
  validateProgress,
  validateStepEntry,
  validateStepEvidence,
  validateStepProgress,
  validNotesText,
  validSessionId,
  version
};
