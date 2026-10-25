import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { declaredStepCheck, lessonHasSteps } from "./contentSchemas.js";
import { trainingFailure } from "./errors.js";
import { pinnedLessonKey } from "./installedContent.js";

const MAX_FILE_BYTES = 1024 * 1024;
// Code steps share one save log per attempt (the ledger holds 256);
// one slot stays free so a save that cannot extend the previous entry fits.
const MAX_SEPARATE_ENTRIES = 255;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function failure(code, message, statusCode = 409) {
  return trainingFailure(code, message, { statusCode });
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
// entered step's baseline arrived through this learner's own editor saves, and
// those saves changed every declared file after the step was first entered:
// code already present at entry (from the coding agent, Colleague, Git or an
// earlier step) is the starting point, never the learner's work for this step.
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

// Paths whose saves the ledger records: the files of every code step entered
// so far in this attempt.
function trackedPaths(ledger) {
  return new Set(ledger.steps.flatMap(step => step.baseline).map(file => file.path));
}

// The code step of a step lesson: an automatic step whose declared check is a
// code check. Its files are the step's declared exercise-relative files.
function codeStepOf(lesson, stepId) {
  if (!lessonHasSteps(lesson?.lesson)) return null;
  const step = lesson.lesson.steps?.find(value => value.id === stepId);
  const check = declaredStepCheck(lesson.lesson, step);
  if (check?.kind !== "code" || !step.check.files?.length) return null;
  return { step, check, files: step.check.files };
}

// Training owns the authorship baseline and the save ledger for code steps.
// The generic source editor still performs every save; this owner only
// records it. The ledger belongs to the attempt in progress, whose practice
// project is training-<attemptId>.
function createTrainingCodeAuthorship({ learners, content, project } = {}) {
  if (!learners?.readState || !learners?.activeAttemptForProject || !learners?.updateCodeLedger || !content?.readLesson ||
      !project?.runInProjectContext || !project?.createRuntime) {
    throw new TypeError("Code authorship requires the original learner, installed content and Project owners.");
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

  async function openCodeStep(attempt, stepId) {
    if (attempt?.preparation?.phase !== "ready") return null;
    const lesson = await content.readLesson(pinnedLessonKey(attempt.pin));
    const code = codeStepOf(lesson, stepId);
    return code ? { attempt, lesson, ...code } : null;
  }

  // Called when the learner enters a code step. Each code step keeps the
  // baseline of its first entry in this attempt: returning to it or moving
  // between code steps never adopts intervening edits as its start.
  async function recordStepBaseline({ actor, attemptId, stepId } = {}) {
    const { progress } = await learners.readState({ actor });
    const active = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    const open = active?.attemptId === attemptId ? await openCodeStep(active, stepId) : null;
    if (!open) return { recorded: false };
    const { revision } = await learners.readStepProgress({ actor, attemptId });
    const { ledger } = await learners.updateCodeLedger({ actor, attemptId }, async current => {
      if (current?.steps.some(step => step.stepId === stepId)) return null;
      const files = await liveFiles(open.attempt, open.files);
      const entries = current?.entries || [];
      return { ledger: { steps: [...(current?.steps || []), { stepId, enteredRevision: revision, entryStart: entries.length,
        baseline: files.map(file => ({ path: file.path, sha256: file.sha256 })) }], entries } };
    });
    const step = ledger.steps.find(value => value.stepId === stepId);
    return { recorded: true, step: { stepId, enteredRevision: step.enteredRevision }, baseline: structuredClone(step.baseline) };
  }

  // The admitted learning save in an attempt's practice project. `save` is the
  // generic editor save already bound to this learner's practice session; it
  // enforces baseHash itself. Unless that attempt is in progress, it is a plain save.
  async function saveLearnerFile({ actor, attemptId, input, save } = {}) {
    if (typeof save !== "function") throw new TypeError("A learner code save requires the original editor save.");
    if (!await learners.activeAttemptForProject({ actor, attemptId })) return save();
    const result = await learners.updateCodeLedger({ actor, attemptId }, async (current, { learnerId, attempt }) => {
      const tracking = Boolean(current && await openCodeStep(attempt, current.steps[0].stepId));
      if (tracking && current.entries.length >= MAX_SEPARATE_ENTRIES) {
        throw failure("VIBE64_TRAINING_CODE_LEDGER_FULL", "This code step recorded too many separate edits. Ask the lesson owner to review it.");
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
      const sealed = Math.max(0, ...current.steps.map(step => step.entryStart));
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

export { codeStepOf, createTrainingCodeAuthorship, readDeclaredFiles, verifyStepAuthorship };
