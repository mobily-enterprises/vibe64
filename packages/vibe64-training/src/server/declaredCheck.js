import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";

const identity = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128,
  pattern: "^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$" };
const uuid = { ...identity, maxLength: 36,
  pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" };
const inputSchema = createSchema({
  attemptId: { ...uuid, pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" },
  sessionId: identity, terminalId: identity, observationId: identity,
  instanceId: uuid, interactionId: uuid, requestId: uuid
});
const checkId = "orientation-response";

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
    if (!lesson.lesson.assessments.some(value => value.kind === "practical" &&
        value.evidence?.producer === "exercise" && value.evidence.operation === "try-the-application" && value.evidence.check === checkId)) {
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
            row.requestId !== input.requestId || row.message !== "Hello from the server!") {
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

  return { runOrientationCheck };
}

export { createTrainingDeclaredCheckOwner };
