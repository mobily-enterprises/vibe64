import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { practiceSlug } from "@local/vibe64-core/server/learningSpace";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { assertValidVibe64SessionId } from "@local/vibe64-runtime/server/sessionStore";
import { canonicalJson } from "./content.js";
import { lessonHasSteps, list, validateContent } from "./contentSchemas.js";
import { createInstalledTrainingContent, validateInstalledTopicPin } from "./installedContent.js";
import { availableStepIds } from "./lessonAvailability.js";

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
// Learner notes (contract C7): one short teacher summary, never a transcript.
const MAX_NOTES_CHARS = 4000;
const MAX_NOTES_BYTES = 32 * 1024;
const MAX_NOTES_REQUESTS = 32;
const MAX_MODE_BYTES = 1024;
const MAX_REVIEW_HELPER_BYTES = 16 * 1024;
const STEP_LOCK_WAIT_MS = 2000;
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
  requestId: { ...text, maxLength: 64 }, revision,
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
  schemaVersion: { type: "integer", required: true, enum: [2] }, learnerId: { ...text, maxLength: 128 }, revision,
  activeAttemptId: { ...text, maxLength: 36, nullable: true },
  completedLessons: list(createSchema({ code: { ...text, maxLength: 64 }, hash: { ...text, maxLength: 64 },
    completedAt: { ...text, maxLength: 24 } }), MAX_COMPLETED_LESSONS),
  attempts: list(attemptSchema, MAX_ATTEMPTS)
});
const activeSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, maxLength: 36 }, pin: { type: "object", required: true, schema: pinSchema },
  projectSlug: { ...text, required: false, maxLength: 48 }, preparation: { type: "object", required: false, schema: preparationSchema }
});
const emptyActiveSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, progressRevision: revision,
  attemptId: { ...text, nullable: true, maxLength: 36 }
});
// Version 2: an earlier release wrote a different version 1 shape here.
const modeSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [2] }, learnerId: { ...text, maxLength: 128 }, on: { type: "boolean", required: true }
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
  schemaVersion: { type: "integer", required: true, enum: [2] }, learnerId: { ...text, maxLength: 128 }, attemptId: { ...text, maxLength: 36 },
  steps: { ...list(createSchema({ stepId: { ...text, maxLength: 64 }, enteredRevision: revision,
    entryStart: { type: "integer", required: true, min: 0, max: MAX_CODE_LEDGER_ENTRIES },
    baseline: list(codeFileSchema, 8) }), MAX_CODE_LEDGER_STEPS), minLength: 1 },
  entries: list(createSchema({ path: { ...text, maxLength: 512 }, baseHash: { ...text, maxLength: 64 },
    savedHash: { ...text, maxLength: 64 }, intendedHash: { ...text, maxLength: 64 },
    actorId: { ...text, maxLength: 128 }, at: { ...text, maxLength: 24 },
    saves: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER } }), MAX_CODE_LEDGER_ENTRIES)
});

function validateCodeLedger(value) {
  const ledger = validateContent(codeLedgerSchema, value, "Code authorship ledger");
  const baselines = ledger.steps.map(step => step.baseline);
  const tracked = new Set(baselines.flat().map(file => file.path));
  const hashes = [...baselines.flat().map(file => file.sha256),
    ...ledger.entries.flatMap(entry => [entry.baseHash, entry.savedHash, entry.intendedHash])];
  if (!uuidPattern.test(ledger.attemptId) || new Set(ledger.steps.map(step => step.stepId)).size !== ledger.steps.length ||
      ledger.steps.some(step => !idPattern.test(step.stepId) || step.entryStart > ledger.entries.length) ||
      hashes.some(hash => !sha256Pattern.test(hash)) || baselines.some(files => new Set(files.map(file => file.path)).size !== files.length) ||
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
  comment: { ...text, maxLength: 600 }, hint: { ...text, required: false, maxLength: 300 },
  points: { ...list(createSchema({ text: { ...text, maxLength: 120 }, met: { type: "boolean", required: true } }), 6), required: false }
});
const stepResultSchema = createSchema({
  stepId: { ...text, maxLength: 64 }, kind: { ...text, enum: ["auto", "choice", "review", "self", "read", "fact"] },
  outcome: { ...text, enum: ["passed", "not-yet-passed"] }, evidence: { type: "object", required: true },
  origin: { ...text, enum: ["learner", "check"] }, requestId: { ...text, maxLength: 64 },
  recordedAt: { ...text, maxLength: 24 }, reason: { ...text, required: false },
  review: { type: "object", required: false, schema: reviewFeedbackSchema }
});
// The latest learner-origin exercise interaction captured by the browser for a
// step; a later check run re-verifies it against the same App run identities.
const stepReceiptSchema = createSchema({
  stepId: { ...text, maxLength: 64 }, checkId: { ...text, maxLength: 64 }, observationId: { ...text, maxLength: 128 },
  instanceId: { ...text, maxLength: 36 }, interactionId: { ...text, maxLength: 36 }, requestId: { ...text, maxLength: 36 },
  sessionId: { ...text, maxLength: 128 }, observedAt: { ...text, maxLength: 24 }
});
const stepProgressSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [3] }, learnerId: { ...text, maxLength: 128 }, revision,
  attemptId: { ...text, maxLength: 36 }, lesson: { type: "object", required: true, schema: lessonKeySchema },
  results: list(stepResultSchema, MAX_STEP_RESULTS), receipts: list(stepReceiptSchema, MAX_STEP_RECEIPTS)
});
const readerSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, attemptId: { ...text, maxLength: 36 },
  stepId: { ...text, maxLength: 64 }, scroll: { type: "number", required: true, min: 0, max: 10_000_000 }
});
const notesText = { type: "string", required: true, noTrim: true, minLength: 0, maxLength: MAX_NOTES_CHARS };
const notesSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, revision, text: notesText,
  updatedAt: { ...text, maxLength: 24 }, updatedBy: { ...text, enum: ["colleague", "learner"] },
  // Recent writes for request-ID replay; the oldest identity leaves this window.
  requests: list(createSchema({ requestId: { ...text, maxLength: 64 }, textHash: { ...text, maxLength: 64 }, revision }), MAX_NOTES_REQUESTS)
});
const isoTime = value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const byteSize = value => Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`);

function validateStepEvidence(result) {
  const { kind, evidence } = result;
  const keys = Object.keys(evidence || {}).sort();
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (kind === "self" || kind === "read") return keys.length === 0 && result.origin === "learner";
  // A fact check's answer, read by its registered reader when the learner asked.
  if (kind === "fact") return result.origin === "check" && canonicalJson(keys) === canonicalJson(["fact"]) && idPattern.test(evidence.fact || "");
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

// The results and receipts of one lesson content; shared with the frozen
// practice-history reader, whose version 2 record keeps one entry per lesson.
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
        !requestPattern.test(receipt.observationId) || ![receipt.instanceId, receipt.interactionId, receipt.requestId].every(id => uuidAnyPattern.test(id)) ||
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

// Receipts bound only the session ID's format: the check runner compares it
// with the attempt's own prepared session at use.
function validSessionId(sessionId) {
  try { return assertValidVibe64SessionId(sessionId) === sessionId; } catch { return false; }
}

function lessonSteps(lesson) {
  return lessonHasSteps(lesson.lesson) && Array.isArray(lesson.lesson.steps) ? lesson.lesson.steps : null;
}

// The result kind a step's declared check records: a reading step (check
// "none") records the learner's own "read" mark.
const resultKind = step => step.check?.kind === "none" ? "read" : step.check?.kind;

// Saved step results must match the exact pinned version 2 lesson.
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
      !idPattern.test(pin.lesson.code) || !sha256Pattern.test(pin.lesson.hash)) {
    throw new Error("Reserve the exact course release, installed topic pin and published lesson hash.");
  }
  return { course: { ...pin.course }, topic: { ...pin.topic }, lesson: { ...pin.lesson } };
}

// The single session an attempt with a practice project prepares.
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
      !attempt.requestIds.length || attempt.requestIds.some(id => !requestPattern.test(id)) || new Set(attempt.requestIds).size !== attempt.requestIds.length) {
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

async function readRecord(filename, limit = MAX_RECORD_BYTES) {
  const stat = await inspectPath(filename, false);
  if (!stat) return null;
  const exceeded = `Learning state exceeds its ${limit / 1024} KiB record limit.`;
  if (stat.size > limit) throw new Error(exceeded);
  const bytes = await readFile(filename);
  if (bytes.length > limit) throw new Error(exceeded);
  const value = JSON.parse(bytes.toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Learning state must contain a versioned record object.");
  return value;
}

// Markdown text: line breaks and tabs, no other control characters.
function validNotesText(value) {
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner notes.
  return typeof value === "string" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

// The saved results of this attempt, or a fresh empty entry: a record left by
// an earlier attempt belongs to nobody now.
function attemptStepEntry(record, attempt) {
  return record?.attemptId === attempt.attemptId
    ? { lesson: record.lesson, results: record.results, receipts: record.receipts }
    : { lesson: { code: attempt.pin.lesson.code, hash: attempt.pin.lesson.hash }, results: [], receipts: [] };
}

// A step lesson completes when every required step available to the learner
// here (lessonAvailability.js) has passed in this attempt.
function lessonCompletion(lesson, entry, available) {
  const steps = lessonSteps(lesson);
  if (!steps) throw new Error(`Lesson ${lesson.lesson.code} uses an unsupported format.`);
  const required = steps.filter(value => value.required && available.has(value.id)).map(value => value.id);
  const passed = required.filter(id => entry.results.some(result => result.stepId === id && result.outcome === "passed"));
  return { lessonCode: lesson.lesson.code, lessonHash: lesson.hash, required: required.length, passed: passed.length,
    completed: passed.length === required.length };
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
      mode: path.join(userRoot, "learning-mode.json"),
      lock: path.join(userRoot, "state.lock"),
      preparationLock: path.join(userRoot, "preparation.lock"),
      codeLedgers: path.join(userRoot, "code-ledgers"),
      codeLedgerLock: path.join(userRoot, "code-ledger.lock"),
      stepProgress: path.join(userRoot, "step-progress.json"),
      stepProgressLock: path.join(userRoot, "step-progress.lock"),
      reader: path.join(userRoot, "reader.json"),
      readerLock: path.join(userRoot, "reader.lock"),
      notes: path.join(userRoot, "teacher-notes.json"),
      notesLock: path.join(userRoot, "teacher-notes.lock"),
      reviewHelper: path.join(userRoot, "review-helper.json"),
      reviewHelpers: path.join(userRoot, "review-helpers"),
      reviewLock: path.join(userRoot, "review.lock")
    };
  }

  async function readProgress(paths) {
    const value = await readRecord(paths.progress);
    if (!value) return { schemaVersion: 2, learnerId: paths.learner.id, revision: 0, activeAttemptId: null, completedLessons: [], attempts: [] };
    return validateProgress(value, paths.learner.id);
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
          if (active.preparation) validatePreparation(active.preparation, active.attemptId);
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
            if (predecessor) preparation = current;
          }
          const projected = { ...active, progressRevision: expectedRevision, ...(preparation ? { preparation } : {}) };
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

  // Preserve existing state/permissions. Create only this explicit operation's
  // private namespace.
  async function createNamespace(paths) {
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
  }

  async function acquire(paths) {
    // The persistent lock serializes cooperating writers.
    await createNamespace(paths);
    const release = await tryAcquireExclusiveFileLock(paths.lock);
    if (!release) {
      throw failure("VIBE64_TRAINING_STATE_BUSY", "Learning state is being updated. Retry the same request after that operation finishes.", 409);
    }
    return release;
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
  // attempts (every redo adds one) share it.
  async function verifyProgressLessons(progress) {
    const lessons = new Map();
    const verified = new Map();
    for (const attempt of progress.attempts) {
      const key = canonicalJson([attempt.pin.topic, attempt.pin.lesson]);
      if (!verified.has(key)) verified.set(key, await verifyInstalled(attempt.pin));
      const lesson = verified.get(key);
      if (Boolean(lesson.lesson.exercise) !== Boolean(attempt.preparation)) {
        throw new Error("An attempt names a practice project exactly when its lesson declares an exercise.");
      }
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

  async function writeProgress(paths, progress, message) {
    validateProgress(progress, paths.learner.id);
    try {
      await writeJsonFileAtomic(paths.progress, progress, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      throw failure("VIBE64_TRAINING_PROGRESS_SAVE_UNCONFIRMED", message, null, { cause });
    }
  }

  // completion is the in-progress attempt's; lessonCompletions lists every
  // completed lesson content and the one in progress. A completed lesson that
  // is not in progress reports no step counts (its results went with its attempt).
  async function readState({ actor, includeCompletion = false } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    if (includeCompletion !== true) return state;
    const lessons = await verifyProgressLessons(state.progress);
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const lesson = attempt ? lessons.get(attempt.attemptId) : null;
    const completion = attempt
      ? lessonCompletion(lesson, await readAttemptSteps(paths, attempt, lesson), availableStepIds(lesson, actor)) : null;
    const completed = new Set(state.progress.completedLessons.map(lesson => canonicalJson({ code: lesson.code, hash: lesson.hash })));
    const lessonCompletions = state.progress.completedLessons.map(lesson => ({ lessonCode: lesson.code, lessonHash: lesson.hash,
      required: 0, passed: 0, completed: true, open: false }));
    if (completion) {
      const open = { ...completion, completed: completion.completed || completed.has(canonicalJson(attempt.pin.lesson)), open: true };
      const index = lessonCompletions.findIndex(value => value.lessonCode === open.lessonCode && value.lessonHash === open.lessonHash);
      if (index < 0) lessonCompletions.push(open);
      else lessonCompletions[index] = open;
    }
    return { ...state, completion, lessonCompletions };
  }

  // The in-progress attempt with this ID when it has a practice project, else
  // null. Code saves and host store selection resolve their attempt here.
  async function activeAttemptForProject({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const { progress } = await loadState(paths);
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    return attempt?.attemptId === attemptId && attempt.projectSlug ? structuredClone(attempt) : null;
  }

  // One lesson is in progress at a time. The same request ID replays its
  // reservation; the same lesson pin returns the attempt in progress; another
  // lesson in progress is refused with its identity, so the caller can offer to
  // archive it first. At the attempt cap (or the record's byte bound) the oldest
  // ended attempts are pruned; completion stays in completedLessons.
  async function reserveAttempt({ actor, requestId, expectedRevision, pin: inputPin } = {}) {
    const paths = userPaths(actor);
    if (typeof requestId !== "string" || !requestPattern.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Reserve with a bounded stable request ID and the revision returned by readState.");
    }
    const pin = validatePin(inputPin);
    await loadState(paths);
    const lesson = await verifyInstalled(pin);
    if (!lessonSteps(lesson)) {
      throw failure("VIBE64_TRAINING_LESSON_VERSION", "This lesson uses an earlier format that can no longer be started.", 409);
    }
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
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
      let attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      if (attempt && canonicalJson(attempt.pin) !== canonicalJson(pin)) {
        const current = await verifyInstalled(attempt.pin).catch(() => null);
        throw failure("VIBE64_TRAINING_LESSON_IN_PROGRESS", "Another lesson is in progress. Archive it before starting this one.", 409,
          { details: { attemptId: attempt.attemptId, lessonCode: attempt.pin.lesson.code, lessonTitle: current?.lesson?.title || attempt.pin.lesson.code } });
      }
      if (expectedRevision !== state.revision) {
        throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read the current revision and resume or retry the same request.", 409);
      }
      if (state.revision === Number.MAX_SAFE_INTEGER) {
        throw new Error("Learning state reached its revision limit. Resume the saved attempt; no new reservation was written.");
      }
      let attempts = state.progress.attempts;
      if (attempt) {
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error("This attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed.");
        }
        attempt = { ...attempt, requestIds: [...attempt.requestIds, requestId] };
        attempts = attempts.map(value => value.attemptId === attempt.attemptId ? attempt : value);
      } else {
        const attemptId = randomUUID();
        attempt = { attemptId, requestIds: [requestId], createdAt: new Date().toISOString(), pin,
          ...(lesson.lesson.exercise ? { projectSlug: practiceSlug(attemptId), preparation: { phase: "reserved" } } : {}) };
        attempts = [...attempts, attempt];
      }
      let progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: attempt.attemptId, attempts };
      // Every attempt but the new last one has ended here.
      while (progress.attempts.length > MAX_ATTEMPTS || progress.attempts.length > 1 && byteSize(progress) > MAX_RECORD_BYTES) {
        progress = { ...progress, attempts: progress.attempts.slice(1) };
      }
      await verifyInstalled(pin);
      await writeProgress(paths, progress, "Reservation save was not confirmed. Retry the same request ID before provisioning; the atomic rename may already have saved it.");
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt, active, replayed: false };
    } finally {
      await release();
    }
  }

  // Finishing (finished), archiving (archived, also by restart) and deleting
  // (deleted) end the attempt in progress. Finished requires every required
  // step passed and records the lesson content in completedLessons. Its step
  // results and code ledger then go: the archive bundle already copied what it
  // keeps (readAttemptRecord). The admitted host runs this inside
  // runPreparationExclusive; no project or session effect happens here.
  async function endAttempt({ actor, attemptId, requestId, expectedRevision, reason } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !requestPattern.test(requestId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !END_REASONS.includes(reason)) {
      throw new Error("End the exact saved attempt with a stable request ID, current revision and an explicit finished, archived or deleted reason.");
    }
    await loadState(paths);
    const release = await acquire(paths);
    let ended;
    try {
      const state = await loadState(paths);
      const lessons = await verifyProgressLessons(state.progress);
      const replay = state.progress.attempts.find(value => value.ended?.requestId === requestId);
      if (replay) {
        if (replay.attemptId !== attemptId || replay.ended.reason !== reason) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This end request already retired a different attempt or reason.", 409);
        }
        const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
        ended = { revision: state.revision, attempt: replay, active, replayed: true };
      } else {
        if (state.progress.attempts.some(value => value.requestIds.includes(requestId))) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved an attempt; use a distinct stable end request.", 409);
        }
        if (state.progress.activeAttemptId !== attemptId) {
          throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Only this learner's exact lesson in progress can be ended; retained history is not reactivated.", 404);
        }
        if (expectedRevision !== state.revision) {
          throw failure("VIBE64_TRAINING_STATE_REVISION_CONFLICT", "Learning state changed. Read it before ending the same attempt.", 409);
        }
        if (state.revision === Number.MAX_SAFE_INTEGER) throw new Error("Learning state reached its revision limit. No attempt was ended.");
        const previous = state.progress.attempts.find(value => value.attemptId === attemptId);
        let { completedLessons } = state.progress;
        if (reason === "finished") {
          const lesson = lessons.get(attemptId);
          if (!lessonCompletion(lesson, await readAttemptSteps(paths, previous, lesson), availableStepIds(lesson, actor)).completed) {
            throw failure("VIBE64_TRAINING_LESSON_INCOMPLETE", "Pass every required step before finishing this lesson.", 409);
          }
          const key = canonicalJson(previous.pin.lesson);
          if (!completedLessons.some(value => canonicalJson({ code: value.code, hash: value.hash }) === key)) {
            // The bound keeps the record small; the oldest completion leaves first.
            completedLessons = [...completedLessons, { ...previous.pin.lesson, completedAt: new Date().toISOString() }].slice(-MAX_COMPLETED_LESSONS);
          }
        }
        const attempt = { ...previous, ended: { requestId, revision: state.revision + 1, reason } };
        const progress = { ...state.progress, revision: state.revision + 1, activeAttemptId: null, completedLessons,
          attempts: state.progress.attempts.map(value => value.attemptId === attemptId ? attempt : value) };
        await writeProgress(paths, progress, "Attempt end save was not confirmed; atomic rename may have succeeded. Read or retry this exact end request before a new reservation.");
        const active = await saveActive(paths, progress);
        ended = { revision: progress.revision, attempt, active, replayed: false };
      }
    } finally {
      await release();
    }
    // Disposable once the end is saved; a retry of the same end forgets them again.
    await forgetAttemptRecords(paths, attemptId).catch(() => {});
    return ended;
  }

  async function forgetAttemptRecords(paths, attemptId) {
    await withLedgerLock(paths, async () => {
      const filename = ledgerPath(paths, attemptId);
      await inspectPath(filename, false);
      await rm(filename, { force: true });
    });
    const release = await acquireRecordLock(paths.stepProgressLock, "VIBE64_TRAINING_STEP_PROGRESS_BUSY", "Step results are being saved.");
    try {
      if ((await readStepProgressRecord(paths))?.attemptId === attemptId) await rm(paths.stepProgress, { force: true });
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
      const completion = lessonCompletion(lesson, await readAttemptSteps(paths, attempt, lesson), availableStepIds(lesson, actor));
      const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
      return { revision: state.revision, attempt, active, completion };
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
    let release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    for (const deadline = Date.now() + PREPARATION_BUSY_WAIT_MS; !release && Date.now() < deadline;) {
      await new Promise(resolve => setTimeout(resolve, 100));
      release = await tryAcquireExclusiveFileLock(paths.preparationLock);
    }
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
    if ((operation !== "begin" || initialSessionId !== undefined) && initialSessionId !== attemptSessionId(attemptId)) {
      throw new Error("Observe preparation for the exact server-reserved initial session.");
    }
    const observedFailure = operation === "failure"
      ? structuredClone(validateContent(preparationFailureSchema, failureInput, "Preparation failure")) : null;
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
      if (!attempt.preparation) {
        throw failure("VIBE64_TRAINING_EXERCISE_MISSING", "This lesson has no practice project to prepare.", 409);
      }
      const sessionId = attemptSessionId(attemptId);
      if (observedFailure) validatePreparation({ phase: "preparing", initialSessionId: sessionId, failure: observedFailure }, attemptId);
      const current = attempt.preparation;
      // The start commit, once recorded, stays with every later phase.
      const start = current.startCommit ? { startCommit: current.startCommit } : {};
      let next;
      if (operation === "begin") {
        next = current.phase === "reserved" ? { phase: "preparing", initialSessionId: sessionId } : current;
      } else if (current.phase === "reserved") {
        throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "Begin and save this attempt's exact session identity before project or session effects.", 409);
      } else if (operation === "start") {
        // Recorded before the practice session exists; a retry before it
        // exists re-verifies the same exercise and may record again.
        if (current.phase === "ready") {
          throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "A prepared lesson keeps the start commit it recorded.", 409);
        }
        next = { ...current, startCommit: input.startCommit };
      } else if (operation === "ready") {
        next = current.phase === "ready" ? current : { phase: "ready", initialSessionId: sessionId, observedAt: new Date().toISOString(), ...start };
      } else {
        next = { phase: "preparing", initialSessionId: sessionId, failure: observedFailure, ...start };
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
      await writeProgress(paths, progress, "Preparation save was not confirmed; atomic rename may already have succeeded. Read or retry this same preparation operation before external effects.");
      const active = await saveActive(paths, progress);
      return { revision: progress.revision, attempt: progress.attempts.find(value => value.attemptId === attemptId), active, replayed: false };
    } finally {
      await release();
    }
  }

  // Code ledgers: one private record per attempt in progress, so autosaves
  // never advance the learning revision. Ending the attempt removes it.
  function ledgerPath(paths, attemptId) {
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    return path.join(paths.codeLedgers, `${attemptId}.json`);
  }

  async function readCodeLedgerRecord(paths, attemptId) {
    const value = await readRecord(ledgerPath(paths, attemptId), MAX_CODE_LEDGER_BYTES);
    if (!value) return null;
    const ledger = validateCodeLedger(value);
    if (ledger.learnerId !== paths.learner.id || ledger.attemptId !== attemptId) {
      throw new Error("The code authorship ledger belongs to another learner or attempt.");
    }
    return ledger;
  }

  async function readCodeLedger({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    ledgerPath(paths, attemptId);
    await loadState(paths);
    return readCodeLedgerRecord(paths, attemptId);
  }

  async function withLedgerLock(paths, operation) {
    await createNamespace(paths);
    await mkdir(paths.codeLedgers, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    await inspectPath(paths.codeLedgers, true);
    await inspectPath(paths.codeLedgerLock, false);
    const release = await tryAcquireExclusiveFileLock(paths.codeLedgerLock);
    if (!release) {
      throw failure("VIBE64_TRAINING_CODE_LEDGER_BUSY", "Another save of this lesson's code is being recorded. Save again in a moment.", 409);
    }
    try { return await operation(); } finally { await release(); }
  }

  async function updateCodeLedger({ actor, attemptId } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof operation !== "function") throw new Error("Update the code ledger of an exact attempt.");
    const attempt = await activeAttemptForProject({ actor, attemptId });
    if (!attempt) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this practice project's lesson before recording code work.", 404);
    }
    return withLedgerLock(paths, async () => {
      const current = await readCodeLedgerRecord(paths, attemptId);
      const result = await operation(current ? structuredClone(current) : null, { learnerId: paths.learner.id, attempt });
      if (!result?.ledger) return { ledger: current, value: result?.value };
      const ledger = validateCodeLedger({ ...result.ledger, schemaVersion: 2, learnerId: paths.learner.id, attemptId });
      await writeJsonFileAtomic(ledgerPath(paths, attemptId), ledger, { directoryMode: 0o700, fileMode: 0o600 });
      return { ledger, value: result.value };
    });
  }

  // Step progress and the reader position use their own short locks so they
  // never contend with progress.json writers or the preparation barrier.
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

  async function readStepProgressRecord(paths) {
    const value = await readRecord(paths.stepProgress, MAX_STEP_RECORD_BYTES);
    return value ? validateStepProgress(value, paths.learner.id) : null;
  }

  // The attempt's own step results, checked against its pinned lesson.
  async function readAttemptSteps(paths, attempt, lesson) {
    try {
      const record = await readStepProgressRecord(paths);
      const entry = attemptStepEntry(record, attempt);
      if (record?.attemptId === attempt.attemptId) {
        if (canonicalJson(record.lesson) !== canonicalJson(attempt.pin.lesson)) throw new Error("Step progress names another lesson than its attempt.");
        validateLessonStepResults(entry, lesson);
      }
      return { ...entry, revision: record?.attemptId === attempt.attemptId ? record.revision : 0 };
    } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID",
        `Learning step progress is invalid: ${cause.message} Keep the files and ask the owner to inspect them; no automatic conversion was performed.`, null, { cause });
    }
  }

  // Read-only: the saved step results of one retained attempt (the one in
  // progress unless attemptId names another). An ended attempt has none here.
  async function readStepProgress({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === (attemptId ?? state.progress.activeAttemptId));
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    const { revision: stepRevision, ...entry } = await readAttemptSteps(paths, attempt, lesson);
    return { revision: stepRevision, entry, attempt, progress: state.progress };
  }

  // The admitted step owner supplies the operation; it decides what may pass.
  // This store only serializes, validates against the pinned lesson and saves
  // the results of the attempt in progress.
  async function updateStepProgress({ actor, attemptId } = {}, operation) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || typeof operation !== "function") {
      throw new Error("Record step results for an exact saved attempt.");
    }
    const before = await loadState(paths);
    if (before.progress.activeAttemptId !== attemptId) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this lesson before recording step results.", 404);
    }
    const release = await acquireRecordLock(paths.stepProgressLock, "VIBE64_TRAINING_STEP_PROGRESS_BUSY",
      "Another step result for this learner is being saved. Retry the same request in a moment.");
    try {
      const state = await loadState(paths);
      const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
      if (state.progress.activeAttemptId !== attemptId || !attempt || attempt.ended) {
        throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "The saved learning attempt changed.", 404);
      }
      const lessons = await verifyProgressLessons(state.progress);
      const lesson = lessons.get(attemptId);
      if (!lessonSteps(lesson)) {
        throw failure("VIBE64_TRAINING_LESSON_VERSION", "This lesson uses assessments, not step results.", 409);
      }
      const { revision: stepRevision, ...entry } = await readAttemptSteps(paths, attempt, lesson);
      const result = await operation(structuredClone(entry), { lesson, attempt, revision: stepRevision, learnerId: paths.learner.id });
      if (!result?.entry) return { revision: stepRevision, entry, value: result?.value };
      if (stepRevision === Number.MAX_SAFE_INTEGER) throw new Error("Step progress reached its revision limit. No result was written.");
      const next = { schemaVersion: 3, learnerId: paths.learner.id, revision: stepRevision + 1, attemptId, lesson: entry.lesson,
        results: result.entry.results, receipts: result.entry.receipts || [] };
      validateStepProgress(next, paths.learner.id);
      validateLessonStepResults(next, lesson);
      try {
        await writeJsonFileAtomic(paths.stepProgress, next, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_STEP_PROGRESS_SAVE_UNCONFIRMED",
          "The step result save was not confirmed; the atomic rename may have succeeded. Read or retry the same request ID.", null, { cause });
      }
      return { revision: next.revision, entry: { lesson: next.lesson, results: next.results, receipts: next.receipts }, value: result.value };
    } finally {
      await release();
    }
  }

  // What an archive bundle keeps of the attempt in progress: its record, its
  // step results and its lesson's title.
  async function readAttemptRecord({ actor, attemptId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "")) throw new Error("Use an exact attempt ID.");
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    const { revision: _revision, ...stepProgress } = await readAttemptSteps(paths, attempt, lesson);
    return { attempt: structuredClone(attempt), stepProgress: structuredClone(stepProgress),
      lessonTitle: String(lesson.lesson?.title || "") || attempt.pin.lesson.code };
  }

  // A position in an attempt that was since pruned reads as no position.
  async function readReader({ actor } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    let value;
    try {
      value = await readRecord(paths.reader, MAX_READER_BYTES);
      if (!value) return null;
      const reader = validateContent(readerSchema, value, "Lesson reader position");
      if (reader.learnerId !== paths.learner.id || !uuidPattern.test(reader.attemptId) || !idPattern.test(reader.stepId)) {
        throw new Error("The reader position belongs to another learner or names an invalid attempt or step.");
      }
      if (!state.progress.attempts.some(attempt => attempt.attemptId === reader.attemptId)) return null;
      return { attemptId: reader.attemptId, stepId: reader.stepId, scroll: reader.scroll };
    } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID",
        `Lesson reader position is invalid: ${cause.message} Keep the file and ask the owner to inspect it.`, null, { cause });
    }
  }

  // Last write wins. Any retained attempt of this learner may be read again.
  async function saveReader({ actor, attemptId, stepId, scroll } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !idPattern.test(stepId || "") ||
        typeof scroll !== "number" || !Number.isFinite(scroll) || scroll < 0 || scroll > 10_000_000) {
      throw new Error("Save the reader position with an exact attempt, step and a bounded scroll offset.");
    }
    const state = await loadState(paths);
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no matching saved attempt.", 404);
    const lesson = await verifyInstalled(attempt.pin);
    if (!lessonSteps(lesson)?.some(step => step.id === stepId)) {
      throw failure("VIBE64_TRAINING_STEP_MISSING", "The step is not declared in this attempt's pinned lesson.", 404);
    }
    const release = await acquireRecordLock(paths.readerLock, "VIBE64_TRAINING_READER_BUSY", "The reader position is being saved. Retry in a moment.");
    try {
      const reader = { schemaVersion: 1, learnerId: paths.learner.id, attemptId, stepId, scroll };
      await writeJsonFileAtomic(paths.reader, validateContent(readerSchema, reader, "Lesson reader position"), { directoryMode: 0o700, fileMode: 0o600 });
      return { attemptId, stepId, scroll };
    } finally {
      await release();
    }
  }

  // Learner notes (contract C7): the teacher's private summary of this one
  // learner, in that learner's own Learning state with its own lock. The
  // authenticated actor alone selects the file, so no caller can name another
  // learner. Notes never take part in admission, step results or completion.
  async function readNotesRecord(paths) {
    await inspectDirectoryChain(systemRoot);
    for (const directory of paths.directories) await inspectPath(directory, true);
    const value = await readRecord(paths.notes, MAX_NOTES_BYTES);
    if (!value) return null;
    const record = validateContent(notesSchema, value, "Learner notes");
    const identities = new Set(record.requests.map(request => request.requestId));
    if (record.learnerId !== paths.learner.id || !isoTime(record.updatedAt) || !validNotesText(record.text) ||
        identities.size !== record.requests.length || record.requests.some(request => !requestPattern.test(request.requestId) ||
          !sha256Pattern.test(request.textHash) || request.revision > record.revision)) {
      throw new Error("The notes belong to another learner or contain an invalid time, text or request.");
    }
    return record;
  }

  const notesProjection = record => record
    ? { text: record.text, revision: record.revision, updatedAt: record.updatedAt, updatedBy: record.updatedBy }
    : { text: "", revision: 0, updatedAt: null, updatedBy: null };

  async function readTeacherNotes({ actor } = {}) {
    const paths = userPaths(actor);
    try {
      return notesProjection(await readNotesRecord(paths));
    } catch (cause) {
      throw failure("VIBE64_TRAINING_NOTES_STATE_INVALID",
        `Learner notes are invalid: ${cause.message} Keep the file and ask the owner to inspect it.`, null, { cause });
    }
  }

  // Replaces the whole summary (clearing is the empty text). The same request
  // ID with the same text replays the saved result; expectedRevision, when
  // given, refuses to overwrite a newer change by the learner or Colleague.
  async function saveTeacherNotes({ actor, text: value, requestId, updatedBy, expectedRevision } = {}) {
    const paths = userPaths(actor);
    if (typeof value !== "string" || value.length > MAX_NOTES_CHARS || !validNotesText(value) ||
        !requestPattern.test(requestId || "") || !["colleague", "learner"].includes(updatedBy) ||
        (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0))) {
      throw failure("VIBE64_TRAINING_NOTES_INVALID",
        `Save learner notes as text of at most ${MAX_NOTES_CHARS} characters without control characters, with an exact request ID.`, 400);
    }
    const textHash = createHash("sha256").update(value).digest("hex");
    await createNamespace(paths);
    const release = await acquireRecordLock(paths.notesLock, "VIBE64_TRAINING_NOTES_BUSY", "The learner notes are being saved. Retry the same request in a moment.");
    try {
      let record;
      try {
        record = await readNotesRecord(paths);
      } catch (cause) {
        throw failure("VIBE64_TRAINING_NOTES_STATE_INVALID",
          `Learner notes are invalid: ${cause.message} Keep the file and ask the owner to inspect it; nothing was saved.`, null, { cause });
      }
      const replay = record?.requests.find(request => request.requestId === requestId);
      if (replay) {
        if (replay.textHash !== textHash) {
          throw failure("VIBE64_TRAINING_NOTES_REQUEST_REUSED", "This request ID already saved different notes. Use a new request ID.", 409);
        }
        return { notes: notesProjection(record), replayed: true, changed: false };
      }
      const current = record?.revision || 0;
      if (expectedRevision !== undefined && expectedRevision !== current) {
        throw failure("VIBE64_TRAINING_NOTES_CHANGED",
          "The notes changed since they were read. Read them again and save the combined summary; nothing was saved.", 409);
      }
      if (current === Number.MAX_SAFE_INTEGER) throw failure("VIBE64_TRAINING_NOTES_REVISION_LIMIT", "Learner notes reached their revision limit. Nothing was saved.", null);
      const next = { schemaVersion: 1, learnerId: paths.learner.id, revision: current + 1, text: value,
        updatedAt: new Date().toISOString(), updatedBy,
        requests: [...record?.requests || [], { requestId, textHash, revision: current + 1 }].slice(-MAX_NOTES_REQUESTS) };
      const validated = validateContent(notesSchema, next, "Learner notes");
      if (Buffer.byteLength(JSON.stringify(validated)) > MAX_NOTES_BYTES) {
        throw failure("VIBE64_TRAINING_NOTES_INVALID", "The learner notes exceed their storage bound. Shorten them; nothing was saved.", 400);
      }
      try {
        await writeJsonFileAtomic(paths.notes, validated, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_NOTES_SAVE_UNCONFIRMED",
          "The notes save was not confirmed; the atomic rename may have succeeded. Read the notes or retry the same request ID.", null, { cause });
      }
      return { notes: notesProjection(validated), replayed: false, changed: true };
    } finally {
      await release();
    }
  }

  // Learn mode (Rev 4 H1): a saved per-learner flag, independent of any
  // lesson; absent means Develop. The current lesson is the attempt in
  // progress, which may stay paused while Learn mode is off. practiceSlug
  // names its practice project once preparation began. includeTitle adds the
  // lesson's title for the shell (admission needs no content read).
  async function readMode(paths) {
    const value = await readRecord(paths.mode, MAX_MODE_BYTES);
    if (!value) return false;
    const mode = validateContent(modeSchema, value, "Learning mode");
    if (mode.learnerId !== paths.learner.id) throw new Error("Learning mode belongs to another learner.");
    return mode.on;
  }

  async function learningModeView(paths, { includeTitle }) {
    const { progress } = await loadState(paths);
    let on;
    try { on = await readMode(paths); } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID", `Learning mode is invalid: ${cause.message} Keep the file and ask the owner to inspect it.`, null, { cause });
    }
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    // lessonStage: where the lesson runs (format 3), read with its title; ""
    // for a retired format, which has none.
    const mode = { on, currentAttemptId: attempt?.attemptId || "", lessonCode: attempt?.pin.lesson.code || "", lessonTitle: "",
      lessonStage: "", practiceSlug: attempt?.preparation && attempt.preparation.phase !== "reserved" ? attempt.projectSlug : "" };
    if (attempt && includeTitle) {
      try {
        const { lesson } = await verifyInstalled(attempt.pin);
        mode.lessonTitle = String(lesson?.title || "");
        mode.lessonStage = lesson?.schemaVersion === 3 ? lesson.stage : "";
      } catch { /* The code names it. */ }
      mode.lessonTitle ||= mode.lessonCode;
    }
    return Object.freeze(mode);
  }

  async function readLearningMode({ actor, includeTitle = false } = {}) {
    return learningModeView(userPaths(actor), { includeTitle });
  }

  // Last write wins: switching mode never touches a lesson.
  async function setLearningMode({ actor, on } = {}) {
    const paths = userPaths(actor);
    if (typeof on !== "boolean") throw failure("VIBE64_TRAINING_MODE_INVALID", "Set Learn mode on or off.", 400);
    await createNamespace(paths);
    await writeJsonFileAtomic(paths.mode, { schemaVersion: 2, learnerId: paths.learner.id, on }, { directoryMode: 0o700, fileMode: 0o600 });
    return learningModeView(paths, { includeTitle: true });
  }

  async function beginPreparation({ actor, attemptId, expectedRevision, initialSessionId } = {}) {
    return writePreparation({ actor, attemptId, expectedRevision, initialSessionId }, "begin");
  }

  async function recordPreparationReady({ actor, attemptId, initialSessionId, expectedRevision } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "ready");
  }

  async function recordPreparationFailure({ actor, attemptId, initialSessionId, expectedRevision, stage, code, message } = {}) {
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision }, "failure", { stage, code, message });
  }

  // The verified exercise commit, recorded just before the practice session
  // is created from it.
  async function recordPreparationStart({ actor, attemptId, initialSessionId, expectedRevision, startCommit } = {}) {
    if (typeof startCommit !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(startCommit)) {
      throw new Error("Record the practice session's start commit as an exact Git object ID.");
    }
    return writePreparation({ actor, attemptId, initialSessionId, expectedRevision, startCommit }, "start");
  }

  // One AI review at a time per learner. The review owner keeps its retained
  // Helper below its own root, and the Helper's receipt in this learner's
  // record, so a review that stopped part-way is cleaned before the next.
  async function readReviewHelperRecord(paths) {
    const value = await readRecord(paths.reviewHelper, MAX_REVIEW_HELPER_BYTES);
    if (!value) return null;
    if (value.schemaVersion !== 1 || value.learnerId !== paths.learner.id || Object.keys(value).sort().join() !== "helper,learnerId,schemaVersion" ||
        value.helper !== null && (typeof value.helper !== "object" || Array.isArray(value.helper))) {
      throw new Error("The review Helper receipt is invalid or belongs to another learner.");
    }
    return value.helper;
  }

  async function runReviewExclusive({ actor } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof operation !== "function") throw new Error("Run a review with an admitted server operation.");
    await createNamespace(paths);
    const lock = await inspectPath(paths.reviewLock, false);
    if (lock && lock.size !== 0) throw new Error("Learning state lock contains unexplained data; inspect it before retrying.");
    const release = await tryAcquireExclusiveFileLock(paths.reviewLock);
    if (!release) {
      throw failure("VIBE64_TRAINING_REVIEW_BUSY", "A review of your work is already running. Wait for it to finish, then check again.", 409);
    }
    try {
      const receipt = {
        read: () => readReviewHelperRecord(paths),
        async write(helper) {
          const record = { schemaVersion: 1, learnerId: paths.learner.id, helper: helper ?? null };
          if (byteSize(record) > MAX_REVIEW_HELPER_BYTES) throw new Error("The review Helper receipt exceeds its record limit.");
          await writeJsonFileAtomic(paths.reviewHelper, record, { directoryMode: 0o700, fileMode: 0o600 });
        }
      };
      return await operation({ root: paths.reviewHelpers, receipt });
    } finally {
      await release();
    }
  }

  return { readState, activeAttemptForProject, readAttemptRecord, reserveAttempt, endAttempt, resumeAttempt, runPreparationExclusive,
    beginPreparation, recordPreparationReady, recordPreparationFailure, recordPreparationStart, runReviewExclusive,
    readCodeLedger, updateCodeLedger, readStepProgress, updateStepProgress, readReader, saveReader,
    readTeacherNotes, saveTeacherNotes, readLearningMode, setLearningMode };
}

export {
  createTrainingLearnerState, failure, inspectDirectoryChain, inspectPath, learnerIdentity, lessonSteps, MAX_NOTES_CHARS, MAX_STEP_RESULTS,
  readRecord, stepReceiptSchema, stepResultSchema, validatePin, validateLessonStepResults, validateStepEntry
};
