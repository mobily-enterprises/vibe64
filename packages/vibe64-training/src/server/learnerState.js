import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
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
// Step results live outside progress.json (kept per lesson content), so a new
// attempt past 32 retained attempts prunes an ended one no practice project
// still needs (pruneAttempts).
const MAX_ATTEMPTS = 32;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_STEP_RESULTS = 64;
const MAX_STEP_RECEIPTS = 32;
const MAX_STEP_LESSONS = 128;
const MAX_STEP_RECORD_BYTES = 1024 * 1024;
const MAX_READER_BYTES = 4096;
// Learner notes (contract C7): one short teacher summary, never a transcript.
const MAX_NOTES_CHARS = 4000;
const MAX_NOTES_BYTES = 32 * 1024;
const MAX_NOTES_REQUESTS = 32;
const STEP_LOCK_WAIT_MS = 2000;
// Browser receipts and Preview output starts hold the preparation barrier only
// briefly. Wait this long before reporting a genuinely long operation as busy.
const PREPARATION_BUSY_WAIT_MS = 5000;
const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const uuidAnyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
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
// "restart" is read only: the published 20261008-learning-practice-history
// upgrade runs before the 20261022 reset and reads vibe64 0.1.35 progress,
// whose attempts ended with it. Drop it only when no published upgrade before
// the reset reads learner progress.
const END_REASONS = ["left", "finished", "discard"];
const endedSchema = createSchema({
  requestId: { ...text, maxLength: 64 }, revision,
  reason: { ...text, enum: [...END_REASONS, "restart"] }
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

const MAX_CODE_LEDGER_ENTRIES = 256;
const MAX_CODE_LEDGER_STEPS = 32;
const MAX_CODE_LEDGER_BYTES = 256 * 1024;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const codeFileSchema = createSchema({ path: { ...text, maxLength: 512 }, sha256: { ...text, maxLength: 64 } });
// One ledger per practice project (code-ledgers/<practiceId>.json), so code
// written before Continue lesson still counts in the continued attempt. Each
// code step keeps its own baseline, keyed on the step and the step-progress
// revision at which the learner first entered it, and the index of the first
// save made after that entry; all saves share one log.
const codeLedgerSchema = createSchema({
  schemaVersion: version, learnerId: { ...text, maxLength: 128 }, practiceId: { ...text, maxLength: 36 },
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
  if (!uuidPattern.test(ledger.practiceId) || new Set(ledger.steps.map(step => step.stepId)).size !== ledger.steps.length ||
      ledger.steps.some(step => !idPattern.test(step.stepId) || step.entryStart > ledger.entries.length) ||
      hashes.some(hash => !sha256Pattern.test(hash)) || baselines.some(files => new Set(files.map(file => file.path)).size !== files.length) ||
      ledger.entries.some(entry => !tracked.has(entry.path) || !isoTime(entry.at))) {
    throw new Error("The code authorship ledger has an invalid identity, hash, file or record time.");
  }
  return ledger;
}

// Version 2 step results: a separate append-only per-learner record with its
// own lock, so frequent step writes never advance the progress revision. They
// are kept per lesson content (code and hash), so every attempt of the same
// lesson content shares them and pruning an attempt never loses a pass.
const stepResultSchema = createSchema({
  stepId: { ...text, maxLength: 64 }, kind: { ...text, enum: ["auto", "choice", "self"] },
  outcome: { ...text, enum: ["passed", "not-yet-passed"] }, evidence: { type: "object", required: true },
  origin: { ...text, enum: ["learner", "check"] }, requestId: { ...text, maxLength: 64 },
  recordedAt: { ...text, maxLength: 24 }, reason: { ...text, required: false }
});
// The latest learner-origin exercise interaction captured by the browser for a
// step; a later check run re-verifies it against the same App run identities.
const stepReceiptSchema = createSchema({
  stepId: { ...text, maxLength: 64 }, checkId: { ...text, maxLength: 64 }, observationId: { ...text, maxLength: 128 },
  instanceId: { ...text, maxLength: 36 }, interactionId: { ...text, maxLength: 36 }, requestId: { ...text, maxLength: 36 },
  sessionId: { ...text, maxLength: 128 }, observedAt: { ...text, maxLength: 24 }
});
const stepProgressSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [2] }, learnerId: { ...text, maxLength: 128 }, revision,
  lessons: list(createSchema({ lesson: { type: "object", required: true, schema: lessonKeySchema },
    results: list(stepResultSchema, MAX_STEP_RESULTS),
    receipts: { ...list(stepReceiptSchema, MAX_STEP_RECEIPTS), required: false } }), MAX_STEP_LESSONS)
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

function validateStepEvidence(result) {
  const { kind, evidence } = result;
  const keys = Object.keys(evidence || {}).sort();
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  if (kind === "self") return keys.length === 0 && result.origin === "learner";
  if (kind === "choice") {
    return result.origin === "learner" && canonicalJson(keys) === canonicalJson(["selected"]) && Array.isArray(evidence.selected) &&
      evidence.selected.length <= 8 && new Set(evidence.selected).size === evidence.selected.length &&
      evidence.selected.every(value => Number.isSafeInteger(value) && value >= 0 && value < 8);
  }
  return result.origin === "check" && keys.every(key => ["checkId", "observationId", "filesHash"].includes(key)) &&
    idPattern.test(evidence.checkId || "") && (evidence.observationId === undefined || requestPattern.test(evidence.observationId)) &&
    (evidence.filesHash === undefined || sha256Pattern.test(evidence.filesHash));
}

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
    const requestIds = new Set();
    for (const result of entry.results) {
      if (!idPattern.test(result.stepId) || !requestPattern.test(result.requestId) || requestIds.has(result.requestId) ||
          !isoTime(result.recordedAt) || !validateStepEvidence(result) ||
          // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in saved reasons.
          result.reason !== undefined && /[\u0000-\u001f\u007f]/u.test(result.reason)) {
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
  if (Buffer.byteLength(`${JSON.stringify(record, null, 2)}\n`) > MAX_STEP_RECORD_BYTES) {
    throw new Error("Step progress exceeds its 1 MiB record limit. No result was removed or written.");
  }
  return record;
}

// Entries are kept least recently written first. Past the lesson or byte
// bound, the oldest entries of lesson content that no retained attempt pins
// go first: those results are disposable once no attempt can read them.
function retainStepLessons(lessons, progress) {
  const pinned = new Set(progress.attempts.map(attempt => canonicalJson(attempt.pin.lesson)));
  const kept = [...lessons];
  const over = () => kept.length > MAX_STEP_LESSONS ||
    Buffer.byteLength(`${JSON.stringify({ schemaVersion: 2, learnerId: progress.learnerId, revision: Number.MAX_SAFE_INTEGER, lessons: kept }, null, 2)}\n`) > MAX_STEP_RECORD_BYTES;
  while (over()) {
    const index = kept.findIndex(entry => !pinned.has(canonicalJson(entry.lesson)));
    if (index < 0) break;
    kept.splice(index, 1);
  }
  return kept;
}

// The saved step results of one lesson content, or an empty entry.
function lessonStepEntry(lessons, lesson) {
  const key = canonicalJson({ code: lesson.code, hash: lesson.hash });
  return lessons.find(entry => canonicalJson(entry.lesson) === key) || { lesson: { code: lesson.code, hash: lesson.hash }, results: [] };
}

// Receipts bound only the session ID's format: the check runner compares it
// with the attempt's own prepared session at use, so a later change in how
// practice sessions are named never makes saved step progress unreadable.
function validSessionId(sessionId) {
  try { return assertValidVibe64SessionId(sessionId) === sessionId; } catch { return false; }
}

function lessonSteps(lesson) {
  return lesson.lesson.schemaVersion === 2 && Array.isArray(lesson.lesson.steps) ? lesson.lesson.steps : null;
}

// Only a version 1 lesson has assessments, rubrics and a teaching document.
// Every reader of that data checks this first, so a version 2 lesson never
// reaches an assessment path.
function assessmentLesson(lesson) {
  return lesson?.lesson?.schemaVersion === 1;
}

// Saved step results must match the exact pinned version 2 lesson.
function validateLessonStepResults(entry, lesson) {
  const steps = lessonSteps(lesson);
  if (!steps) throw new Error("Step results belong only to a version 2 lesson.");
  for (const result of entry.results) {
    const step = steps.find(value => value.id === result.stepId);
    if (!step || step.check?.kind !== result.kind || result.kind === "auto" && result.evidence.checkId !== step.check.check) {
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
      !idPattern.test(pin.lesson.code) || !/^[a-f0-9]{64}$/u.test(pin.lesson.hash)) {
    throw new Error("Reserve the exact course release, installed topic pin and published lesson hash.");
  }
  return { course: { ...pin.course }, topic: { ...pin.topic }, lesson: { ...pin.lesson } };
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

// Callers supply content-validated progress and the exact installed lesson.
// Version 2 lessons have steps, not assessments; their passes are step results.
// Markdown text: line breaks and tabs, no other control characters.
function validNotesText(value) {
  // eslint-disable-next-line no-control-regex -- Deliberately reject control characters in learner notes.
  return typeof value === "string" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function passedAssessmentIds(attempt, lesson, attempts = [attempt]) {
  if (!assessmentLesson(lesson)) return [];
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
      preparationLock: path.join(userRoot, "preparation.lock"),
      codeLedgers: path.join(userRoot, "code-ledgers"),
      codeLedgerLock: path.join(userRoot, "code-ledger.lock"),
      stepProgress: path.join(userRoot, "step-progress.json"),
      stepProgressLock: path.join(userRoot, "step-progress.lock"),
      reader: path.join(userRoot, "reader.json"),
      readerLock: path.join(userRoot, "reader.lock"),
      notes: path.join(userRoot, "teacher-notes.json"),
      notesLock: path.join(userRoot, "teacher-notes.lock")
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

  async function verifyProgressLessons(progress) {
    const lessons = new Map();
    for (const attempt of progress.attempts) {
      const lesson = await verifyInstalled(attempt.pin);
      validateLessonPractice(attempt, lesson);
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

  // The active attempt working in this practice project, or null. Every
  // practice-keyed path (code saves, ledgers) resolves its attempt here.
  async function activeAttemptForPractice({ actor, practiceId } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(practiceId || "")) throw new Error("Use an exact practice project ID.");
    const { progress } = await loadState(paths);
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    return attempt && attemptPracticeId(attempt) === practiceId ? structuredClone(attempt) : null;
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

  // Frozen for the published 20261008-learning-practice-history upgrade, which
  // compares the result with a version 1 project marker: one attempt, its own
  // project and the version 1 marker. Learning-space work reads
  // readPracticeProjectScope instead.
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

  // The saved exercise identity of one practice project (the version 2 marker),
  // keyed on the project, never on an attempt: the active attempt working in
  // it, otherwise its latest retained attempt. A continued attempt therefore
  // admits work in the project an earlier attempt created. Pruning keeps the
  // latest attempt of every practice project still in the learning space.
  async function readPracticeProjectScope({ actor, practiceId, access = "observe" } = {}) {
    if (!["observe", "control", "write", "create"].includes(access)) {
      throw new TypeError("Use an explicit practice operation scope.");
    }
    const paths = userPaths(actor);
    if (typeof practiceId !== "string" || !uuidPattern.test(practiceId)) {
      throw new Error("Use the exact practice project ID.");
    }
    const state = await loadState(paths);
    const attempts = state.progress.attempts.filter(value => attemptPracticeId(value) === practiceId);
    const attempt = attempts.find(value => value.attemptId === state.progress.activeAttemptId) || attempts.at(-1);
    if (!attempt) throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "This learner has no saved attempt in this practice project.", 404);
    const { active, sourcePath } = await readAttemptExercise(state, attempt, access);
    return { ...exerciseScope(paths, state, attempt, { active, training: { schemaVersion: 2, learnerKey: paths.learner.key,
      practiceId, pin: structuredClone(attempt.pin), exercise: { kind: "bundled", sourcePath } } }), practiceId };
  }

  // practiceId continues an existing practice project of this same lesson pin
  // (Continue lesson); the host has verified that the project still exists.
  // livePracticeIds, when the host supplies it, lists every practice project
  // of this learner still in the learning space; pruning then also drops the
  // last attempt of a deleted or archived one.
  async function reserveAttempt({ actor, requestId, expectedRevision, pin: inputPin, practiceId, livePracticeIds } = {}) {
    const paths = userPaths(actor);
    if (typeof requestId !== "string" || !requestPattern.test(requestId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error("Reserve with a bounded stable request ID and the revision returned by readState.");
    }
    if (practiceId !== undefined && !uuidPattern.test(practiceId || "")) throw new Error("Continue an exact practice project ID.");
    if (livePracticeIds !== undefined && (!Array.isArray(livePracticeIds) || livePracticeIds.some(id => !uuidPattern.test(id || "")))) {
      throw new Error("List the learning space's practice projects by their exact IDs.");
    }
    const pin = validatePin(inputPin);
    const samePractice = attempt => practiceId === undefined ? !attempt.practiceId : attemptPracticeId(attempt) === practiceId;
    await loadState(paths);
    const exercise = Boolean((await verifyInstalled(pin)).lesson.exercise);
    const release = await acquire(paths);
    try {
      const state = await loadState(paths);
      const lessons = await verifyProgressLessons(state.progress);
      if (state.progress.attempts.some(attempt => attempt.ended?.requestId === requestId)) {
        throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already ended an attempt; use its original end operation.", 409);
      }
      const replay = state.progress.attempts.find(attempt => attempt.requestIds.includes(requestId));
      if (replay) {
        if (canonicalJson(replay.pin) !== canonicalJson(pin) || !samePractice(replay)) {
          throw failure("VIBE64_TRAINING_REQUEST_CONFLICT", "This request ID already reserved another exact lesson pin or practice project. Resume its saved attempt.", 409);
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
      if (practiceId && state.progress.attempts.some(value => attemptPracticeId(value) === practiceId &&
          canonicalJson(value.pin) !== canonicalJson(pin))) {
        throw failure("VIBE64_TRAINING_ATTEMPT_CONFLICT", "This practice project belongs to another lesson.", 409);
      }
      let attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      let attempts = state.progress.attempts;
      let pruned = [];
      if (attempt) {
        if (canonicalJson(attempt.pin) !== canonicalJson(pin) || practiceId !== undefined && !samePractice(attempt)) {
          throw failure("VIBE64_TRAINING_ATTEMPT_CONFLICT", "Another lesson or practice project is already active. Continue it; this operation does not restart attempts.", 409);
        }
        if (attempt.requestIds.length >= MAX_REQUEST_IDS) {
          throw new Error("This pilot attempt reached its 64 distinct reservation-request limit. Resume the saved attempt; no retry identity was removed.");
        }
        attempt.requestIds.push(requestId);
      } else {
        ({ attempts, pruned } = pruneAttempts(attempts, lessons, { practiceId, livePracticeIds }));
        const attemptId = randomUUID();
        attempt = {
          attemptId,
          ...(practiceId ? { practiceId } : {}),
          requestIds: [requestId],
          createdAt: new Date().toISOString(),
          pin,
          ...(exercise ? { projectSlug: practiceSlugFor(practiceId ?? attemptId), preparation: { phase: "reserved" } } : {})
        };
      }
      await verifyInstalled(pin);
      const progress = {
        schemaVersion: 1,
        learnerId: paths.learner.id,
        revision: state.revision + 1,
        activeAttemptId: attempt.attemptId,
        attempts: state.active ? attempts.map(value => value.attemptId === attempt.attemptId ? attempt : value)
          : [...attempts, attempt]
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
      await forgetPrunedLedgers(paths, pruned, progress.attempts, livePracticeIds);
      return { revision: progress.revision, attempt, active, replayed: false };
    } finally {
      await release();
    }
  }

  // At the cap every retained attempt is ended. The oldest one no practice
  // project still needs makes room: one that never had a project (a lesson
  // without an exercise, or an own attempt still only reserved), one a later
  // attempt in the same practice project supersedes (including the attempt
  // being continued now), or one whose practice project the host reports gone.
  // The latest attempt of a practice project still in the learning space is
  // never pruned, so the project stays readable by its practice ID. Step
  // results stay with the lesson content and ledgers with practice projects.
  function pruneAttempts(attempts, lessons, { practiceId, livePracticeIds }) {
    const kept = [...attempts];
    const pruned = [];
    const live = livePracticeIds && new Set(livePracticeIds);
    while (kept.length >= MAX_ATTEMPTS) {
      const index = kept.findIndex((attempt, position) => {
        const id = attemptPracticeId(attempt);
        return !lessons.get(attempt.attemptId)?.lesson?.exercise || !attempt.practiceId && attempt.preparation.phase === "reserved" ||
          id === practiceId || kept.slice(position + 1).some(later => attemptPracticeId(later) === id) || live && !live.has(id);
      });
      if (index < 0) {
        throw failure("VIBE64_TRAINING_ATTEMPTS_FULL", `You have ${MAX_ATTEMPTS} practice projects with saved lessons. Archive or delete one in Practice, then start the lesson again.`, 409);
      }
      pruned.push(...kept.splice(index, 1));
    }
    return { attempts: kept, pruned };
  }

  // A pruned attempt's code ledger goes with it once no retained attempt and
  // no live practice project refers to it. The reservation is already saved,
  // so a failure here only leaves a ledger that deleting the project forgets.
  async function forgetPrunedLedgers(paths, pruned, retained, livePracticeIds) {
    if (!livePracticeIds) return;
    const needed = new Set([...livePracticeIds, ...retained.map(attemptPracticeId)]);
    for (const practiceId of new Set(pruned.map(attemptPracticeId))) {
      if (needed.has(practiceId)) continue;
      try { await forgetLedger(paths, practiceId); } catch { /* Disposable; deleting the project forgets it. */ }
    }
  }

  // Leave lesson (left), Lesson finished (finished) and archiving or deleting
  // the practice project (discard) end the attempt; its step results and its
  // practice project are kept. The admitted host runs this inside
  // runPreparationExclusive; no project or session effect happens here.
  async function endAttempt({ actor, attemptId, requestId, expectedRevision, reason } = {}) {
    const paths = userPaths(actor);
    if (!uuidPattern.test(attemptId || "") || !requestPattern.test(requestId || "") ||
        !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !END_REASONS.includes(reason)) {
      throw new Error("End the exact saved attempt with a stable request ID, current revision and an explicit left, finished or discard reason.");
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
      const { lessons: stepLessons } = await readLessonStepProgress(paths, state.progress, lessons);
      const active = state.activeSummaryCurrent ? state.active : await saveActive(paths, state.progress);
      return { revision: state.revision, attempt, active, completion: lessonCompletion(attempt, lesson, state.progress.attempts, stepLessons) };
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
    if ((operation !== "begin" || initialSessionId !== undefined) && !uuidPattern.test(/^training-(.*)$/u.exec(initialSessionId || "")?.[1] || "")) {
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
      if (initialSessionId !== undefined && !preparationSessionIds(attempt).has(initialSessionId)) {
        throw new Error("Observe preparation for the exact server-reserved initial session.");
      }
      if (observedFailure) validatePreparation({ phase: "preparing", initialSessionId, failure: observedFailure }, attempt);
      const current = attempt.preparation;
      let next;
      if (operation === "begin") {
        // A continued attempt names the session it reuses or creates.
        const sessionId = initialSessionId ?? `training-${attemptPracticeId(attempt)}`;
        if (current.phase !== "reserved" && current.initialSessionId !== sessionId) {
          throw failure("VIBE64_TRAINING_PREPARATION_CONFLICT", "This attempt already saved another initial session.", 409);
        }
        next = current.phase === "reserved" ? { phase: "preparing", initialSessionId: assertValidVibe64SessionId(sessionId) } : current;
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
      validatePreparation(next, attempt);
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

  // Code ledgers: one private record per practice project, written only while
  // an attempt is active in it, so autosaves never advance the learning
  // revision. Deleting or archiving the practice project forgets its ledger
  // (forgetPracticeLedger), as does pruning the last attempt of a practice
  // project the host reports gone.
  function ledgerPath(paths, practiceId) {
    if (!uuidPattern.test(practiceId || "")) throw new Error("Use an exact practice project ID.");
    return path.join(paths.codeLedgers, `${practiceId}.json`);
  }

  async function readCodeLedgerRecord(paths, practiceId) {
    const value = await readRecord(ledgerPath(paths, practiceId), MAX_CODE_LEDGER_BYTES);
    if (!value) return null;
    const ledger = validateCodeLedger(value);
    if (ledger.learnerId !== paths.learner.id || ledger.practiceId !== practiceId) {
      throw new Error("The code authorship ledger belongs to another learner or practice project.");
    }
    return ledger;
  }

  async function readCodeLedger({ actor, practiceId } = {}) {
    const paths = userPaths(actor);
    ledgerPath(paths, practiceId);
    await loadState(paths);
    return readCodeLedgerRecord(paths, practiceId);
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

  async function updateCodeLedger({ actor, practiceId } = {}, operation) {
    const paths = userPaths(actor);
    if (typeof operation !== "function") throw new Error("Update the code ledger of an exact practice project.");
    const attempt = await activeAttemptForPractice({ actor, practiceId });
    if (!attempt) {
      throw failure("VIBE64_TRAINING_ATTEMPT_MISSING", "Continue this practice project's lesson before recording code work.", 404);
    }
    return withLedgerLock(paths, async () => {
      const current = await readCodeLedgerRecord(paths, practiceId);
      const result = await operation(current ? structuredClone(current) : null, { learnerId: paths.learner.id, attempt });
      if (!result?.ledger) return { ledger: current, value: result?.value };
      const ledger = validateCodeLedger({ ...result.ledger, schemaVersion: 1, learnerId: paths.learner.id, practiceId });
      await writeJsonFileAtomic(ledgerPath(paths, practiceId), ledger, { directoryMode: 0o700, fileMode: 0o600 });
      return { ledger, value: result.value };
    });
  }

  async function forgetLedger(paths, practiceId) {
    const filename = ledgerPath(paths, practiceId);
    await withLedgerLock(paths, async () => {
      await inspectPath(filename, false);
      await rm(filename, { force: true });
    });
  }

  // The learning-space owner calls this when it deletes or archives the
  // practice project (a resumable step: forgetting twice is a no-op).
  async function forgetPracticeLedger({ actor, practiceId } = {}) {
    return forgetLedger(userPaths(actor), practiceId);
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

  // Read-only: every saved step result of this learner, per lesson content.
  async function readStepProgress({ actor } = {}) {
    const paths = userPaths(actor);
    const state = await loadState(paths);
    const lessons = await verifyProgressLessons(state.progress);
    return { ...await readLessonStepProgress(paths, state.progress, lessons), progress: state.progress };
  }

  // The admitted step owner supplies the operation; it decides what may pass.
  // This store only serializes, validates against the pinned lesson and saves
  // the entry of the active attempt's lesson content.
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
      await readLessonStepProgress(paths, state.progress, lessons);
      const record = await readStepProgressRecord(paths) ||
        { schemaVersion: 2, learnerId: paths.learner.id, revision: 0, lessons: [] };
      const entry = lessonStepEntry(record.lessons, attempt.pin.lesson);
      const result = await operation(structuredClone(entry), { lesson, attempt, revision: record.revision, learnerId: paths.learner.id });
      if (!result?.entry) return { revision: record.revision, entry, value: result?.value };
      if (record.revision === Number.MAX_SAFE_INTEGER) throw new Error("Step progress reached its revision limit. No result was written.");
      const updated = { ...result.entry, lesson: entry.lesson };
      const key = canonicalJson(entry.lesson);
      const next = { ...record, revision: record.revision + 1,
        lessons: retainStepLessons([...record.lessons.filter(value => canonicalJson(value.lesson) !== key), updated], state.progress) };
      validateStepProgress(next, paths.learner.id);
      validateLessonStepResults(updated, lesson);
      try {
        await writeJsonFileAtomic(paths.stepProgress, next, { directoryMode: 0o700, fileMode: 0o600 });
      } catch (cause) {
        throw failure("VIBE64_TRAINING_STEP_PROGRESS_SAVE_UNCONFIRMED",
          "The step result save was not confirmed; the atomic rename may have succeeded. Read or retry the same request ID.", null, { cause });
      }
      return { revision: next.revision, entry: updated, value: result.value };
    } finally {
      await release();
    }
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

  // Learning mode (product decision 8): a lesson is in progress (the active
  // attempt) or not. In progress, the learner works only in its practice
  // project, which practiceSlug names once preparation began; a lesson without
  // a practice project has none. includeTitle adds the lesson's title for the
  // shell (the installed lesson is read only then; admission needs no read).
  async function readLearningMode({ actor, includeTitle = false } = {}) {
    const { progress } = await loadState(userPaths(actor));
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    if (!attempt) return Object.freeze({ on: false });
    const practiceSlug = attempt.preparation && attempt.preparation.phase !== "reserved" ? attempt.projectSlug : "";
    const mode = { on: true, attemptId: attempt.attemptId, lessonCode: attempt.pin.lesson.code, practiceSlug,
      projectSlugs: Object.freeze(practiceSlug ? [practiceSlug] : []) };
    if (!includeTitle) return Object.freeze(mode);
    let lessonTitle = "";
    try { lessonTitle = String((await verifyInstalled(attempt.pin)).lesson?.title || ""); } catch { /* The code names it. */ }
    return Object.freeze({ ...mode, lessonTitle: lessonTitle || mode.lessonCode });
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

  return { readState, activeAttemptForPractice, readExerciseProjectScope, readPracticeProjectScope, reserveAttempt, endAttempt, resumeAttempt, runPreparationExclusive,
    beginPreparation, recordPreparationReady, recordPreparationFailure,
    readCodeLedger, updateCodeLedger, forgetPracticeLedger, readStepProgress, updateStepProgress, readReader, saveReader,
    readTeacherNotes, saveTeacherNotes, readLearningMode };
}

export { attemptPracticeId, createTrainingLearnerState, learnerIdentity, lessonStepEntry, lessonSteps, MAX_NOTES_CHARS, MAX_STEP_RESULTS };
