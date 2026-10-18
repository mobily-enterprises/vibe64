import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { canonicalJson } from "./content.js";

const MAX_FILE_BYTES = 1024 * 1024;
// One slot stays free so a save that cannot extend the previous entry still fits.
const MAX_SEPARATE_ENTRIES = 127;
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
// question's baseline arrived through this learner's own lesson editor saves.
function verifyAuthorship(ledger, question, files) {
  if (!ledger || canonicalJson(ledger.question) !== canonicalJson(questionKey(question))) {
    return { intact: false, files: files.map(file => file.path), missingBaseline: true };
  }
  const broken = [];
  for (const file of files) {
    const baseline = ledger.baseline.find(value => value.path === file.path);
    let current = baseline?.sha256;
    let intact = Boolean(baseline);
    for (const entry of ledger.entries.filter(value => value.path === file.path)) {
      if (entry.baseHash !== current || entry.savedHash !== entry.intendedHash) intact = false;
      current = entry.savedHash;
    }
    if (!intact || current !== file.sha256) broken.push(file.path);
  }
  return { intact: broken.length === 0, files: broken };
}

// Training owns the authorship baseline and the save ledger for code questions.
// The generic source editor still performs every save; this wrapper only records it.
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

  // Called after a code question is saved. Replays keep the original baseline:
  // a later read could otherwise adopt another writer's edits as the start.
  async function recordBaseline({ actor, attemptId, question } = {}) {
    const open = await openCodeQuestion(actor, attemptId);
    if (!open || canonicalJson(questionKey(open.question)) !== canonicalJson(questionKey(question || {}))) {
      throw failure("VIBE64_TRAINING_CODE_QUESTION_STALE", "The saved code question changed before its starting files were recorded.");
    }
    const { ledger } = await learners.updateCodeLedger({ actor, attemptId }, async current => {
      if (current && canonicalJson(current.question) === canonicalJson(questionKey(open.question))) return null;
      const files = await liveFiles(open.attempt, open.assessment.evidence.files);
      return { ledger: { question: questionKey(open.question),
        baseline: files.map(file => ({ path: file.path, sha256: file.sha256 })), entries: [] } };
    });
    return { baseline: structuredClone(ledger.baseline) };
  }

  // The admitted learning save. `save` is the generic editor save already bound
  // to this learner's exact practice session; it enforces baseHash itself.
  async function saveLearnerFile({ actor, attemptId, input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    const result = await learners.updateCodeLedger({ actor, attemptId }, async (current, { learnerId }) => {
      const open = await openCodeQuestion(actor, attemptId);
      const tracking = Boolean(open && current && canonicalJson(current.question) === canonicalJson(questionKey(open.question)));
      if (tracking && current.entries.length >= MAX_SEPARATE_ENTRIES) {
        throw failure("VIBE64_TRAINING_CODE_LEDGER_FULL", "This code question recorded too many separate edits. Ask your teacher for a new question.");
      }
      const saved = await save();
      const savedPath = saved?.file?.path;
      if (saved?.ok === false || !tracking || !current.baseline.some(file => file.path === savedPath)) return { value: saved };
      const entry = { path: savedPath, baseHash: String(input.baseHash || ""), savedHash: String(saved.file.hash || ""),
        intendedHash: sha256(Buffer.from(String(input.text ?? ""), "utf8")), actorId: learnerId,
        at: new Date().toISOString(), saves: 1 };
      const entries = current.entries;
      const last = entries.at(-1);
      // Consecutive clean saves of one file collapse into one link of the chain.
      if (last && last.path === entry.path && last.actorId === entry.actorId && last.savedHash === last.intendedHash &&
          entry.baseHash === last.savedHash && entry.savedHash === entry.intendedHash) {
        Object.assign(last, { savedHash: entry.savedHash, intendedHash: entry.intendedHash, at: entry.at, saves: last.saves + 1 });
      } else {
        entries.push(entry);
      }
      return { ledger: { ...current, entries }, value: saved };
    });
    return result.value;
  }

  return Object.freeze({ recordBaseline, saveLearnerFile, openCodeQuestion });
}

export { createTrainingCodeAuthorship, readDeclaredFiles, verifyAuthorship };
