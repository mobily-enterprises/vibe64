import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { createHash } from "node:crypto";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { codeStepOf, readDeclaredFiles, verifyAuthorship, verifyStepAuthorship } from "./codeAuthorship.js";
import { assessmentLesson } from "./learnerState.js";

const identity = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$" };
const uuid = { ...identity, maxLength: 36,
  pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" };
// A version 2 lesson names the step whose automatic check runs; version 1
// lessons keep their original assessment-declared checks.
const stepId = { ...identity, required: false, maxLength: 64, pattern: "^[a-zA-Z][a-zA-Z0-9-]{0,63}$" };
const inputSchema = createSchema({
  attemptId: { ...uuid, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
  sessionId: identity, terminalId: identity, observationId: identity,
  instanceId: uuid, interactionId: uuid, requestId: uuid, stepId
});
const codeInputSchema = createSchema({
  attemptId: { ...uuid, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
  sessionId: identity, observationId: identity, stepId
});
const orientationCheckId = "orientation-response";
const DEFAULT_CODE_TIMEOUT_SECONDS = 15;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, statusCode: 409, ...extra });
}

async function canonicalDirectory(directory) {
  if (!path.isAbsolute(directory || "") || !(await lstat(directory)).isDirectory() ||
      await realpath(directory) !== directory) {
    throw failure("VIBE64_TRAINING_CHECK_DIRECTORY_UNSAFE", "The check requires the original canonical session artifact directory.");
  }
}

function activeRun(status, session, input) {
  const terminal = status?.activeTerminal;
  const metadata = terminal?.metadata;
  const source = sessionSourcePath(session);
  if (!source || terminal?.id !== input.terminalId || terminal.status !== "running" || terminal.running !== true ||
      status.output?.state !== "ready" || status.output.targetId !== "app" || status.output.presentationKind !== "web" ||
      metadata?.sessionId !== input.sessionId || metadata.outputTargetId !== "app" ||
      metadata.sessionRoot !== session.sessionRoot || metadata.sessionSourceRoot !== source) {
    throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "Use the exact ready App run belonging to this prepared lesson session.");
  }
  const target = new URL(metadata.targetUrl);
  if (target.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(target.hostname) ||
      target.username || target.password || target.search || target.hash || !target.port ||
      Number(target.port) !== metadata.port) {
    throw failure("VIBE64_TRAINING_CHECK_ORIGIN_INVALID", "The App run has no valid allocated private loopback origin.");
  }
  const relative = path.relative(source, metadata.runRoot || "");
  if (!path.isAbsolute(metadata.runRoot || "") || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The App run no longer belongs to this lesson source.");
  }
  return { terminalId: terminal.id, origin: target.origin, source, sessionRoot: session.sessionRoot,
    runRoot: metadata.runRoot, port: metadata.port };
}

// The authenticated native observation owner supplies these identities. This
// facility confirms a server observation, never learner origin or assessment pass.
function createTrainingDeclaredCheckOwner({ learners, content, project, terminals, runCommand = runVibe64Command } = {}) {
  if (!learners?.readState || !content?.readLesson || !content?.readCheck ||
      !project?.runInProjectContext || !project?.createRuntime || !terminals?.outputTargetStatus) {
    throw new TypeError("Declared checks require the original learner, installed content, project and App output facilities.");
  }

  async function readAttempt(actor, input) {
    const state = await learners.readState({ actor, includeCompletion: true });
    const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    if (!attempt || attempt.attemptId !== input.attemptId || attempt.preparation.phase !== "ready" ||
        attempt.preparation.initialSessionId !== input.sessionId) {
      throw failure("VIBE64_TRAINING_CHECK_ATTEMPT_STALE", "Use this learner's exact active prepared lesson attempt.");
    }
    return attempt;
  }

  async function runOrientationCheck({ actor, signal, ...submitted } = {}) {
    const input = validateContent(inputSchema, submitted, "Native orientation check identities");
    signal?.throwIfAborted();
    const attempt = await readAttempt(actor, input);
    const pin = { ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash };
    const lesson = await content.readLesson(pin);
    const checkId = input.stepId ? responseStepCheck(lesson, input.stepId) : orientationCheckId;
    if (!input.stepId && (!assessmentLesson(lesson) || !lesson.lesson.assessments.some(value => value.kind === "practical" &&
        value.evidence?.producer === "exercise" && value.evidence.operation === "try-the-application" && value.evidence.check === checkId))) {
      throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "This installed lesson does not declare the orientation response practical.");
    }
    const declared = await content.readCheck({ ...pin, checkId });
    return project.runInProjectContext(attempt.projectSlug, async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(input.sessionId, { inspectSource: false });
      if (!session || session.sessionId !== input.sessionId) throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The exact prepared lesson session is unavailable.");
      const run = activeRun(await terminals.outputTargetStatus(input.sessionId), session, input);
      const paths = runtime.store.paths(input.sessionId);
      if (paths.sessionRoot !== session.sessionRoot) throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson session artifact identity changed.");
      await canonicalDirectory(paths.sessionRoot);
      await mkdir(paths.artifactsRoot, { recursive: true, mode: 0o700 });
      await canonicalDirectory(paths.artifactsRoot);
      const scratch = await mkdtemp(path.join(paths.artifactsRoot, "training-check-"));
      let cleanupSafe = true;
      try {
        for (const file of [declared.file, ...declared.assets]) {
          const relative = file.path.split("/");
          if (relative.some(part => !part || part === "." || part === ".." || part.includes("\\")) || path.isAbsolute(file.path)) {
            throw failure("VIBE64_TRAINING_CHECK_DIRECTORY_UNSAFE", "The installed check has an unsafe file path.");
          }
          const destination = path.join(scratch, ...relative);
          await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, file.bytes, { flag: "wx", mode: 0o400 });
        }
        signal?.throwIfAborted();
        const before = await readAttempt(actor, input);
        const beforeSession = await runtime.getSession(input.sessionId, { inspectSource: false });
        const beforeRun = activeRun(await terminals.outputTargetStatus(input.sessionId), beforeSession || {}, input);
        if (canonicalJson(before.pin) !== canonicalJson(attempt.pin) || before.projectSlug !== attempt.projectSlug || canonicalJson(beforeRun) !== canonicalJson(run)) {
          throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson or App run changed before check execution.");
        }
        cleanupSafe = false;
        const result = await runCommand({ actor: "daemon", command: "node", args: [path.join(scratch, declared.file.path)],
          cwd: scratch, allowedRoots: [scratch], project: { slug: attempt.projectSlug }, session,
          inheritProcessEnv: false, baseEnv: {}, envPolicy: "project", purpose: "output", runtimes: ["node26"],
          mode: "capture", execution: { kind: "job", lifecycle: "finite", operationId: "training-check",
            ownerId: input.observationId, projectSlug: attempt.projectSlug, sessionId: input.sessionId },
          input: JSON.stringify({ origin: run.origin, instanceId: input.instanceId, interactionId: input.interactionId, requestId: input.requestId }),
          timeout: 5000, maxBuffer: 4096, signal });
        cleanupSafe = Boolean(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(result?.execution?.id || "") &&
          ["finished", "rejected"].includes(result.execution.state) &&
          !["vibe64_execution_drain_failed", "vibe64_execution_cleanup_required"].includes(result.code));
        if (!cleanupSafe) throw failure("VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED", "The check execution scope could not be proven empty. Its private files are retained for the original execution cleanup owner.",
          { execution: result?.execution, scratch });
        signal?.throwIfAborted();
        const current = await readAttempt(actor, input);
        const freshSession = await runtime.getSession(input.sessionId, { inspectSource: false });
        const freshRun = activeRun(await terminals.outputTargetStatus(input.sessionId), freshSession || {}, input);
        if (canonicalJson(current.pin) !== canonicalJson(attempt.pin) || current.projectSlug !== attempt.projectSlug || canonicalJson(freshRun) !== canonicalJson(run)) {
          throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson or App run changed while its check was executing. Repeat the actual application interaction.");
        }
        const stdout = String(result.stdout ?? "");
        if (result.timedOut || result.signal || result.code || Buffer.byteLength(stdout) > 4096 || String(result.stderr || "").trim()) {
          throw failure(result.code || "VIBE64_TRAINING_CHECK_FAILED", "The declared check did not return a bounded successful execution result.");
        }
        const row = JSON.parse(stdout.trim());
        if (result.exitCode === 1 && result.ok === false && canonicalJson(Object.keys(row).sort()) === canonicalJson(["check", "outcome", "reason"]) &&
            row.check === checkId && row.outcome === "incomplete" && typeof row.reason === "string" && row.reason.length <= 256) {
          return { checkResult: { check: checkId, observationId: input.observationId, outcome: "not-yet-passed" }, reason: row.reason };
        }
        if (result.exitCode !== 0 || result.ok !== true || canonicalJson(Object.keys(row).sort()) !== canonicalJson(["check", "instanceId", "interactionId", "message", "outcome", "requestId"]) ||
            row.check !== checkId || row.outcome !== "verified" || row.instanceId !== input.instanceId || row.interactionId !== input.interactionId ||
            row.requestId !== input.requestId || (checkId === orientationCheckId ? row.message !== "Hello from the server!"
              : typeof row.message !== "string" || !row.message || row.message.length > 256)) {
          throw failure("VIBE64_TRAINING_CHECK_RESULT_INVALID", "The check result does not match this exact server interaction.");
        }
        return { checkResult: { check: checkId, observationId: input.observationId, outcome: "passed" } };
      } catch (error) {
        if (!cleanupSafe && error.code !== "VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED") {
          throw failure("VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED", "The check execution did not return scope-empty proof. Its private files are retained for the original execution cleanup owner.", { cause: error, scratch });
        }
        throw error;
      } finally {
        if (cleanupSafe) await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  // A version 2 step's automatic response check: an exercise interaction check
  // (not a code check) declared by the exact pinned lesson.
  function responseStepCheck(lesson, id) {
    const step = lesson.lesson.schemaVersion === 2 ? lesson.lesson.steps?.find(value => value.id === id) : null;
    const check = step?.check?.kind === "auto" ? lesson.lesson.checks?.find(value => value.id === step.check.check) : null;
    if (!check || check.kind === "code") {
      throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "This lesson step does not declare an exercise response check.");
    }
    return check.id;
  }

  function safeRelative(file) {
    const relative = file.split("/");
    if (relative.some(part => !part || part === "." || part === ".." || part.includes("\\")) || path.isAbsolute(file)) {
      throw failure("VIBE64_TRAINING_CHECK_DIRECTORY_UNSAFE", "The installed code check has an unsafe file path.");
    }
    return relative;
  }

  function openCodeQuestion(attempt, lesson) {
    if (!assessmentLesson(lesson)) {
      throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "Choose the lesson step whose code check should run.");
    }
    const question = attempt.learning?.resume?.pendingQuestion;
    const assessment = lesson.lesson.assessments.find(value => value.id === question?.assessmentId);
    const check = lesson.lesson.checks?.find(value => value.id === assessment?.evidence?.check);
    if (!question?.assistance || !question.issuedRevision || assessment?.kind !== "practical" ||
        assessment.evidence?.producer !== "code" || check?.kind !== "code" || !assessment.evidence.files?.length) {
      throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "The open question in this lesson does not declare a code check.");
    }
    return { question, check, files: assessment.evidence.files,
      authorship: (ledger, files) => verifyAuthorship(ledger, question, files),
      same: current => canonicalJson(current.learning?.resume?.pendingQuestion) === canonicalJson(question),
      missingBaseline: "needs an independent attempt: this question has no recorded starting files. Ask for the question again." };
  }

  // v2: the step's own declared files; the ledger baseline is the entered step.
  function openCodeStep(lesson, id) {
    const code = codeStepOf(lesson, id);
    if (!code) throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "This lesson step does not declare a code check.");
    return { check: code.check, files: code.files,
      authorship: (ledger, files) => verifyStepAuthorship(ledger, id, files), same: () => true,
      missingBaseline: "needs an independent attempt: this step has no recorded starting files. Open the step again, then make your change." };
  }

  // A code check runs the pinned check on a private copy: the pinned exercise
  // bytes, overlaid only by the learner's current bytes of the declared files.
  // Agent edits elsewhere cannot change the result; a broken authorship chain
  // in a declared file never runs and is an automatic not-yet-passed.
  async function runCodeCheck({ actor, signal, ...submitted } = {}) {
    const input = validateContent(codeInputSchema, submitted, "Native code check identities");
    signal?.throwIfAborted();
    const attempt = await readAttempt(actor, input);
    const pin = { ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash };
    const lesson = await content.readLesson(pin);
    const { check, files: declaredFiles, authorship: verifyFiles, same, missingBaseline } = input.stepId
      ? openCodeStep(lesson, input.stepId) : openCodeQuestion(attempt, lesson);
    if (typeof learners.readCodeLedger !== "function" || typeof content.readExercise !== "function") {
      throw failure("VIBE64_TRAINING_CHECK_UNDECLARED", "This installation cannot verify code questions.");
    }
    const declared = await content.readCheck({ ...pin, checkId: check.id });
    const exercise = await content.readExercise(pin);
    const result = (outcome, extra = {}) => ({ checkResult: { check: check.id, observationId: input.observationId, outcome }, ...extra });
    const sameQuestion = current => canonicalJson(current.pin) === canonicalJson(attempt.pin) && current.projectSlug === attempt.projectSlug &&
      same(current);
    return project.runInProjectContext(attempt.projectSlug, async () => {
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(input.sessionId, { inspectSource: false });
      if (!session || session.sessionId !== input.sessionId) throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The exact prepared lesson session is unavailable.");
      const paths = runtime.store.paths(input.sessionId);
      if (paths.sessionRoot !== session.sessionRoot) throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson session artifact identity changed.");
      const files = await readDeclaredFiles(sessionSourcePath(session), declaredFiles);
      const checked = files.map(file => ({ path: file.path, sha256: file.sha256 }));
      const authorship = verifyFiles(await learners.readCodeLedger({ actor, attemptId: input.attemptId }), files);
      if (!authorship.intact) {
        return result("not-yet-passed", { authorship: "other", files: checked,
          reason: authorship.missingBaseline
            ? missingBaseline
            : authorship.unchanged
              ? `needs your own change: edit ${authorship.files.join(", ")} in this lesson's Code editor during this step, then Check again`
              : `needs an independent attempt: other edits detected in ${authorship.files.join(", ")}` });
      }
      const filesHash = sha256(canonicalJson(checked));
      await canonicalDirectory(paths.sessionRoot);
      await mkdir(paths.artifactsRoot, { recursive: true, mode: 0o700 });
      await canonicalDirectory(paths.artifactsRoot);
      const scratch = await mkdtemp(path.join(paths.artifactsRoot, "training-code-check-"));
      const exerciseRoot = exercise.sourcePath === "." ? "" : exercise.sourcePath;
      const exerciseRelative = file => exerciseRoot ? `${exerciseRoot}/${file}` : file;
      let cleanupSafe = true;
      try {
        const learnerBytes = new Map(files.map(file => [file.path, file.bytes]));
        const inputs = [...exercise.files.map(file => ({ path: exerciseRelative(file.path), bytes: learnerBytes.get(file.path) ?? file.bytes })),
          declared.file, ...declared.assets];
        for (const file of inputs) {
          const destination = path.join(scratch, ...safeRelative(file.path));
          await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
          await writeFile(destination, file.bytes, { flag: "wx", mode: 0o600 });
        }
        signal?.throwIfAborted();
        if (!sameQuestion(await readAttempt(actor, input))) {
          throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson question changed before its code check ran.");
        }
        const timeoutSeconds = check.timeoutSeconds || DEFAULT_CODE_TIMEOUT_SECONDS;
        const cwd = path.join(scratch, ...(exerciseRoot ? exerciseRoot.split("/") : []));
        cleanupSafe = false;
        const run = await runCommand({ actor: "daemon", command: "node", args: [path.join(scratch, ...safeRelative(declared.file.path))],
          cwd, allowedRoots: [scratch], project: { slug: attempt.projectSlug }, session,
          inheritProcessEnv: false, baseEnv: {}, envPolicy: "project", purpose: "output", runtimes: ["node26"],
          mode: "capture", execution: { kind: "job", lifecycle: "finite", operationId: "training-code-check",
            ownerId: input.observationId, projectSlug: attempt.projectSlug, sessionId: input.sessionId },
          input: JSON.stringify({ check: check.id, filesHash, files: checked }),
          timeout: timeoutSeconds * 1000, maxBuffer: 4096, signal });
        cleanupSafe = Boolean(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(run?.execution?.id || "") &&
          ["finished", "rejected"].includes(run.execution.state) &&
          !["vibe64_execution_drain_failed", "vibe64_execution_cleanup_required"].includes(run.code));
        if (!cleanupSafe) throw failure("VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED", "The check execution scope could not be proven empty. Its private files are retained for the original execution cleanup owner.",
          { execution: run?.execution, scratch });
        signal?.throwIfAborted();
        if (!sameQuestion(await readAttempt(actor, input))) {
          throw failure("VIBE64_TRAINING_CHECK_RUN_STALE", "The lesson question changed while its code check was running. Check your code again.");
        }
        if (run.timedOut) {
          return result("not-yet-passed", { authorship: "learner", files: checked,
            reason: `The check stopped after ${timeoutSeconds} seconds. Your code may never finish, for example because of an endless loop.` });
        }
        const stdout = String(run.stdout ?? "");
        if (run.signal || run.code || Buffer.byteLength(stdout) > 4096) {
          throw failure(run.code || "VIBE64_TRAINING_CHECK_FAILED", "The declared code check did not return a bounded execution result.");
        }
        let row = null;
        try { row = JSON.parse(stdout.trim()); } catch { /* Learner code may crash the check before it reports. */ }
        const keys = row && typeof row === "object" && !Array.isArray(row) ? canonicalJson(Object.keys(row).sort()) : "";
        if (row && Object.hasOwn(row, "filesHash") && row.filesHash !== filesHash) {
          throw failure("VIBE64_TRAINING_CHECK_RESULT_INVALID", "The code check result does not belong to the files it was given.");
        }
        if (run.exitCode === 0 && run.ok === true && keys === canonicalJson(["check", "filesHash", "outcome"]) &&
            row.check === check.id && row.outcome === "verified") {
          return result("passed", { authorship: "learner", files: checked });
        }
        if (run.exitCode === 1 && keys === canonicalJson(["check", "filesHash", "outcome", "reason"]) && row.check === check.id &&
            row.outcome === "incomplete" && typeof row.reason === "string" && row.reason.trim() && row.reason.length <= 256) {
          return result("not-yet-passed", { authorship: "learner", files: checked, reason: row.reason });
        }
        if (run.exitCode !== 0 && !row) {
          return result("not-yet-passed", { authorship: "learner", files: checked,
            reason: "The check could not finish with your code: it stopped with an error before reporting a result." });
        }
        throw failure("VIBE64_TRAINING_CHECK_RESULT_INVALID", "The code check returned an unexpected result.");
      } catch (error) {
        if (!cleanupSafe && error.code !== "VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED") {
          throw failure("VIBE64_TRAINING_CHECK_CLEANUP_REQUIRED", "The check execution did not return scope-empty proof. Its private files are retained for the original execution cleanup owner.", { cause: error, scratch });
        }
        throw error;
      } finally {
        if (cleanupSafe) await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  return { runOrientationCheck, runCodeCheck };
}

export { createTrainingDeclaredCheckOwner };
