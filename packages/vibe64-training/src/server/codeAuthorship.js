import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { canonicalJson } from "./content.js";
import { assessmentLesson } from "./learnerState.js";

const MAX_FILE_BYTES = 1024 * 1024;
// One slot stays free so a save that cannot extend the previous entry still fits.
const MAX_SEPARATE_ENTRIES = 127;
// v2 code steps share one save log per attempt (the ledger holds 256).
const MAX_SEPARATE_STEP_ENTRIES = 255;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function failure(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function questionKey(question) {
  return { id: question.id, assessmentId: question.assessmentId, issuedRevision: question.issuedRevision };
}

// Reads the bytes of declared exercise-relative files from the live session
// source. Paths come from the pinned lesson, never from a request.
async function readDeclaredFiles(source, files) {
  if (!path.isAbsolute(source || "") || await realpath(source) !== source) {
    throw failure("VIBE64_TRAINING_CODE_SOURCE_UNSAFE", "The lesson session source is not its original canonical directory.");
  }
  const result = [];
  for (const file of files) {
    const filename = path.join(source, ...file.split("/"));
    let stat;
    try { stat = await lstat(filename); } catch (error) {
      if (error.code === "ENOENT") throw failure("VIBE64_TRAINING_CODE_FILE_MISSING", `The lesson file ${file} is missing from your practice project.`);
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(filename) !== filename || stat.size > MAX_FILE_BYTES) {
      throw failure("VIBE64_TRAINING_CODE_FILE_UNSAFE", `The lesson file ${file} is not an ordinary file of at most 1 MiB.`);
    }
    const bytes = await readFile(filename);
    result.push({ path: file, sha256: sha256(bytes), bytes });
  }
  return result;
}

// A declared file counts as the learner's only when every byte change since the
// question's (v1) or entered step's (v2) baseline arrived through this learner's
// own lesson editor saves.
function verifyAuthorship(ledger, question, files) {
  const matches = Boolean(ledger?.question) && canonicalJson(ledger.question) === canonicalJson(questionKey(question));
  return verifyLedgerChain(matches ? ledger.baseline : null, ledger?.entries, files);
}

// v2 additionally requires that the learner's own saves changed every declared
// file after the step was first entered: code already present at entry (from
// the coding agent, Colleague, Git or an earlier step) is the starting point,
// never the learner's work for this step.
function verifyStepAuthorship(ledger, stepId, files) {
  const step = ledger?.steps?.find(value => value.stepId === stepId);
  const verified = verifyLedgerChain(step?.baseline, ledger?.entries.slice(step?.entryStart), files);
  if (!verified.intact) return verified;
  const unchanged = files.filter(file => step.baseline.find(value => value.path === file.path).sha256 === file.sha256).map(file => file.path);
  return unchanged.length ? { intact: false, files: unchanged, unchanged: true } : verified;
}

function verifyLedgerChain(baselineFiles, entries, files) {
  if (!baselineFiles) {
    return { intact: false, files: files.map(file => file.path), missingBaseline: true };
  }
  const broken = [];
  for (const file of files) {
    const baseline = baselineFiles.find(value => value.path === file.path);
    let current = baseline?.sha256;
    let intact = Boolean(baseline);
    for (const entry of entries.filter(value => value.path === file.path)) {
      if (entry.baseHash !== current || entry.savedHash !== entry.intendedHash) intact = false;
      current = entry.savedHash;
    }
    if (!intact || current !== file.sha256) broken.push(file.path);
  }
  return { intact: broken.length === 0, files: broken };
}

// Paths whose saves the ledger records: the v1 question's files, or the files
// of every v2 code step entered so far in this attempt.
function trackedPaths(ledger) {
  return new Set((ledger.question ? ledger.baseline : ledger.steps.flatMap(step => step.baseline)).map(file => file.path));
}

// The code step of a v2 lesson: an automatic step whose declared check is a
// code check. Its files are the step's declared exercise-relative files.
function codeStepOf(lesson, stepId) {
  if (lesson?.lesson?.schemaVersion !== 2) return null;
  const step = lesson.lesson.steps?.find(value => value.id === stepId);
  const check = step?.check?.kind === "auto" ? lesson.lesson.checks?.find(value => value.id === step.check.check) : null;
  if (check?.kind !== "code" || !step.check.files?.length) return null;
  return { step, check, files: step.check.files };
}

// Training owns the authorship baseline and the save ledger for code questions
// and code steps. The generic source editor still performs every save; this
// owner only records it.
function createTrainingCodeAuthorship({ learners, content, project } = {}) {
  if (!learners?.readState || !learners?.updateCodeLedger || !content?.readLesson || !project?.runInProjectContext || !project?.createRuntime) {
    throw new TypeError("Code authorship requires the original learner, installed content and Project owners.");
  }

  async function openCodeQuestion(actor, attemptId) {
    const state = await learners.readState({ actor, includeCompletion: true });
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const question = attempt?.learning?.resume?.pendingQuestion;
    if (!attempt || attempt.attemptId !== attemptId || attempt.preparation.phase !== "ready" ||
        !question?.assistance || !question.issuedRevision) return null;
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    if (!assessmentLesson(lesson)) return null;
    const assessment = lesson.lesson.assessments.find(value => value.id === question.assessmentId);
    if (assessment?.kind !== "practical" || assessment.evidence?.producer !== "code") return null;
    return { attempt, question, assessment, lesson };
  }

  async function liveFiles(attempt, files) {
    return project.runInProjectContext(attempt.projectSlug, async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(attempt.preparation.initialSessionId, { inspectSource: false });
      if (!session || session.sessionId !== attempt.preparation.initialSessionId) {
        throw failure("VIBE64_TRAINING_CODE_SESSION_STALE", "The prepared lesson session is unavailable.");
      }
      return readDeclaredFiles(sessionSourcePath(session), files);
    });
  }

  async function openCodeStep(actor, attemptId, stepId) {
    const state = await learners.readState({ actor });
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    if (!attempt || attempt.attemptId !== attemptId || attempt.preparation.phase !== "ready") return null;
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const code = codeStepOf(lesson, stepId);
    return code ? { attempt, lesson, ...code } : null;
  }

  // Called when the learner enters a v2 code step. Each code step keeps the
  // baseline of its first entry for the whole attempt: returning to it, or
  // moving between code steps, never adopts intervening edits as its start.
  async function recordStepBaseline({ actor, attemptId, stepId } = {}) {
    const open = await openCodeStep(actor, attemptId, stepId);
    if (!open) return { recorded: false };
    const { revision } = await learners.readStepProgress({ actor });
    const { ledger } = await learners.updateCodeLedger({ actor, attemptId }, async current => {
      if (current?.question) throw failure("VIBE64_TRAINING_CODE_QUESTION_STALE", "This attempt records code questions, not code steps.");
      if (current?.steps.some(step => step.stepId === stepId)) return null;
      const files = await liveFiles(open.attempt, open.files);
      const entries = current?.entries || [];
      return { ledger: { steps: [...(current?.steps || []), { stepId, enteredRevision: revision, entryStart: entries.length,
        baseline: files.map(file => ({ path: file.path, sha256: file.sha256 })) }], entries } };
    });
    const step = ledger.steps.find(value => value.stepId === stepId);
    return { recorded: true, step: { stepId, enteredRevision: step.enteredRevision }, baseline: structuredClone(step.baseline) };
  }

  async function tracksLedger(actor, attemptId, current) {
    if (!current) return false;
    if (current.steps) return Boolean(await openCodeStep(actor, attemptId, current.steps[0].stepId));
    const open = await openCodeQuestion(actor, attemptId);
    return Boolean(open && canonicalJson(current.question) === canonicalJson(questionKey(open.question)));
  }

  // The admitted learning save. `save` is the generic editor save already bound
  // to this learner's exact practice session; it enforces baseHash itself.
  async function saveLearnerFile({ actor, attemptId, input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const result = await learners.updateCodeLedger({ actor, attemptId }, async (current, { learnerId }) => {
      const tracking = await tracksLedger(actor, attemptId, current);
      if (tracking && current.entries.length >= (current.steps ? MAX_SEPARATE_STEP_ENTRIES : MAX_SEPARATE_ENTRIES)) {
        throw failure("VIBE64_TRAINING_CODE_LEDGER_FULL", current.steps
          ? "This code step recorded too many separate edits. Ask the lesson owner to review it."
          : "This code question recorded too many separate edits. Ask your teacher for a new question.");
      }
      const saved = await save();
      const savedPath = saved?.file?.path;
      if (saved?.ok === false || !tracking || !trackedPaths(current).has(savedPath)) return { value: saved };
      const entry = { path: savedPath, baseHash: String(input.baseHash || ""), savedHash: String(saved.file.hash || ""),
        intendedHash: sha256(Buffer.from(String(input.text ?? ""), "utf8")), actorId: learnerId,
        at: new Date().toISOString(), saves: 1 };
      const entries = current.entries;
      const last = entries.at(-1);
      // Consecutive clean saves of one file collapse into one link of the
      // chain, never across a later step entry (which starts at the next save).
      const sealed = Math.max(0, ...(current.steps || []).map(step => step.entryStart));
      if (last && entries.length > sealed && last.path === entry.path && last.actorId === entry.actorId && last.savedHash === last.intendedHash &&
          entry.baseHash === last.savedHash && entry.savedHash === entry.intendedHash) {
        Object.assign(last, { savedHash: entry.savedHash, intendedHash: entry.intendedHash, at: entry.at, saves: last.saves + 1 });
      } else {
        entries.push(entry);
      }
      return { ledger: { ...current, entries }, value: saved };
    });
    return result.value;
  }

  return Object.freeze({ recordStepBaseline, saveLearnerFile });
}

export { codeStepOf, createTrainingCodeAuthorship, readDeclaredFiles, verifyAuthorship, verifyStepAuthorship };
