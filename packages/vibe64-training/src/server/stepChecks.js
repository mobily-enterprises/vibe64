import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "./content.js";
import { validateContent } from "./contentSchemas.js";
import { lessonSteps, MAX_STEP_RESULTS } from "./learnerState.js";
import { trainingStepObservationSchema } from "../shared/practicalSchemas.js";

const idPattern = /^[a-zA-Z][a-zA-Z0-9-]{0,63}$/u;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const requestPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function stepFailure(message, code = "VIBE64_TRAINING_STEP_INVALID", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireResult(result, failure) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
  return result;
}

// Moved from practicalObservations.js: invoke the declared exercise response
// check for one learner-origin App interaction in the exact ready App run.
// v1 calls omit stepId; v2 names the step whose check the lesson declares.
async function runExerciseResponseCheck({ actions, checks, context, failure, actor, target, targetInput,
  attemptId, observationId, exercise, checkId, stepId }) {
  if (typeof checks?.runOrientationCheck !== "function") {
    throw failure("The installed exercise response check is unavailable in this host.");
  }
  const outputs = requireResult(await actions.execute({ actionId: "vibe64.terminals.outputs.read",
    input: targetInput || target, context }), failure);
  const terminalId = outputs?.activeTerminal?.id;
  if (!terminalId) throw failure("Use the exact ready App run for this exercise before repeating the interaction.");
  const checked = await checks.runOrientationCheck({ actor, signal: context.signal,
    attemptId, sessionId: target.sessionId, terminalId, observationId,
    instanceId: exercise.instanceId, interactionId: exercise.interactionId, requestId: exercise.requestId,
    ...(stepId ? { stepId } : {}) });
  if (checked?.checkResult?.check !== checkId || checked.checkResult.observationId !== observationId ||
      !["passed", "not-yet-passed"].includes(checked.checkResult.outcome)) {
    throw failure("The declared check did not confirm this exact native observation.");
  }
  return checked;
}

// Moved from practicalObservations.js: invoke the declared code check and
// accept only its bounded authorship-qualified result.
async function runCodeCheckObservation({ checks, context, failure, actor, attemptId, sessionId, observationId, checkId, stepId }) {
  if (typeof checks?.runCodeCheck !== "function") {
    throw failure("The installed code check is unavailable in this host.");
  }
  const checked = await checks.runCodeCheck({ actor, signal: context.signal,
    attemptId, sessionId, observationId, ...(stepId ? { stepId } : {}) });
  if (checked?.checkResult?.check !== checkId || checked.checkResult.observationId !== observationId ||
      !["passed", "not-yet-passed"].includes(checked.checkResult.outcome) || !["learner", "other"].includes(checked.authorship) ||
      checked.authorship === "other" && checked.checkResult.outcome !== "not-yet-passed") {
    throw failure("The declared code check did not confirm this exact native observation.");
  }
  return checked;
}

// Version 2 step results. Passes come only from: the automatic check runner
// with learner-origin evidence (a browser-captured exercise interaction, or
// learner-authored code per the authorship ledger) when the learner triggered
// it, the choice comparator, or the learner's own self-check. A check the
// assistant triggers records not-yet-passed or returns diagnostics only.
// Verdicts are final: there is no rubric and no AI grader.
function createTrainingStepChecks({ learners, content, checks, authorship, actions } = {}) {
  if (!learners?.readState || !learners?.readStepProgress || !learners?.updateStepProgress || !learners?.saveReader ||
      !content?.readLesson) {
    throw new TypeError("Step checks require the original learner state and installed content owners.");
  }

  async function openStep({ actor, attemptId, stepId, active = true }) {
    if (!uuidPattern.test(attemptId || "") || !idPattern.test(stepId || "")) {
      throw stepFailure("Use an exact saved attempt ID and a declared step ID.", "ACTION_VALIDATION_FAILED", 400);
    }
    const state = await learners.readState({ actor });
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw stepFailure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    if (active && (state.progress.activeAttemptId !== attemptId || attempt.ended)) {
      throw stepFailure("Continue this lesson before recording its steps; an ended attempt keeps its results read-only.", "VIBE64_TRAINING_ATTEMPT_INACTIVE");
    }
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const steps = lessonSteps(lesson);
    if (!steps) throw stepFailure("This lesson uses assessments, not steps.", "VIBE64_TRAINING_LESSON_VERSION");
    const step = steps.find(value => value.id === stepId);
    if (!step) throw stepFailure("The step is not declared in this attempt's pinned lesson.", "VIBE64_TRAINING_STEP_MISSING", 404);
    return { state, attempt, lesson, step };
  }

  function declaredCheck(lesson, step) {
    const check = step.check?.kind === "auto" ? lesson.lesson.checks?.find(value => value.id === step.check.check) : null;
    if (!check) throw stepFailure("This step has no automatic check.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    return check;
  }

  function practiceTarget(attempt) {
    if (attempt.preparation.phase !== "ready") {
      throw stepFailure("Wait until this lesson's practice project is ready, then try again.", "VIBE64_TRAINING_PRACTICE_NOT_READY");
    }
    return { projectSlug: attempt.projectSlug, sessionId: attempt.preparation.initialSessionId };
  }

  async function savedEntry(actor, attemptId) {
    const { attempts } = await learners.readStepProgress({ actor });
    return attempts.find(value => value.attemptId === attemptId) || { attemptId, results: [] };
  }

  function replayed(result, stepId, same = () => true) {
    if (result.stepId !== stepId || !same(result)) {
      throw stepFailure("This request ID already recorded a different step result.", "VIBE64_TRAINING_REQUEST_CONFLICT");
    }
    return { ok: true, stepId, outcome: result.outcome, recorded: true, replayed: true, ...(result.reason ? { reason: result.reason } : {}) };
  }

  // Append-only. A request ID replays its original result; a step that already
  // passed in this attempt keeps that pass and records nothing further.
  async function record({ actor, attemptId, requestId, result, receipt, same }) {
    const { value } = await learners.updateStepProgress({ actor, attemptId }, async entry => {
      const existing = entry.results.find(saved => saved.requestId === requestId);
      if (existing) return { value: replayed(existing, result.stepId, same) };
      const passed = entry.results.find(saved => saved.stepId === result.stepId && saved.outcome === "passed");
      if (passed) return { value: { ok: true, stepId: result.stepId, outcome: "passed", recorded: false, replayed: false, alreadyPassed: true } };
      if (entry.results.length >= MAX_STEP_RESULTS) {
        throw stepFailure(`This attempt reached its ${MAX_STEP_RESULTS} saved step results. Its history is kept; ask the owner to review it.`,
          "VIBE64_TRAINING_STEP_RESULTS_FULL");
      }
      const saved = { ...result, requestId, recordedAt: new Date().toISOString() };
      const receipts = receipt ? [...(entry.receipts || []).filter(value => value.stepId !== receipt.stepId), receipt] : entry.receipts;
      return { entry: { attemptId, results: [...entry.results, saved], ...(receipts?.length ? { receipts } : {}) },
        value: { ok: true, stepId: result.stepId, outcome: saved.outcome, recorded: true, replayed: false,
          ...(saved.reason ? { reason: saved.reason } : {}) } };
    });
    return value;
  }

  // A saved reason is one bounded line; check output never adds control characters.
  // eslint-disable-next-line no-control-regex -- Deliberately replace control characters in check output.
  const boundedReason = reason => String(reason ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ").trim().slice(0, 256) || undefined;

  // Browser only: the learner pressed the App's own control in visible Preview.
  // The receipt is learner-origin evidence; its declared check decides at once.
  async function observe({ actor, attemptId, stepId, observation, context = {}, targetInput } = {}) {
    if (!actions?.execute) throw stepFailure("Native lesson observations are unavailable in this host.");
    const input = validateContent(trainingStepObservationSchema, observation, "Step observation");
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    const check = declaredCheck(lesson, step);
    if (check.kind === "code") throw stepFailure("This step checks code; use Check instead of an App interaction.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    const target = practiceTarget(attempt);
    if (!input.workspace.ready || !isDeepStrictEqual({ projectSlug: input.workspace.projectSlug, sessionId: input.workspace.sessionId }, target)) {
      throw stepFailure("Use the ready exercise project and session reserved for this exact lesson.");
    }
    if (!input.workspace.projectVisible || input.workspace.pane !== "preview") {
      throw stepFailure("Press the App's control in the visible Preview of this lesson's practice project.");
    }
    requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: targetInput || target, context }), stepFailure);
    const requestId = input.exercise.requestId;
    const previous = (await savedEntry(actor, attemptId)).results.find(value => value.requestId === requestId);
    if (previous) return replayed(previous, stepId);
    const observationId = randomUUID();
    const checked = await runExerciseResponseCheck({ actions, checks, context, failure: stepFailure, actor, target, targetInput,
      attemptId, observationId, exercise: input.exercise, checkId: check.id, stepId });
    const reason = boundedReason(checked.reason);
    return record({ actor, attemptId, requestId,
      result: { stepId, kind: "auto", outcome: checked.checkResult.outcome, evidence: { checkId: check.id, observationId },
        origin: "check", ...(reason ? { reason } : {}) },
      receipt: { stepId, checkId: check.id, observationId, ...input.exercise, sessionId: target.sessionId, observedAt: new Date().toISOString() } });
  }

  // Runs the step's declared check. trigger is the admitted caller channel:
  // "learner" for the learner's own browser press, "assistant" for Colleague.
  async function runCheck({ actor, attemptId, stepId, requestId, trigger, context = {}, targetInput } = {}) {
    if (!["learner", "assistant"].includes(trigger) || !requestPattern.test(requestId || "")) {
      throw stepFailure("Run a step check with a stable request ID and its admitted trigger.", "ACTION_VALIDATION_FAILED", 400);
    }
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    const check = declaredCheck(lesson, step);
    const entry = await savedEntry(actor, attemptId);
    const previous = entry.results.find(value => value.requestId === requestId);
    if (previous) return replayed(previous, stepId);
    const target = practiceTarget(attempt);
    const observationId = randomUUID();
    let checked;
    let evidence;
    if (check.kind === "code") {
      checked = await runCodeCheckObservation({ checks, context, failure: stepFailure, actor, attemptId,
        sessionId: target.sessionId, observationId, checkId: check.id, stepId });
      evidence = { checkId: check.id, observationId,
        ...(Array.isArray(checked.files) && checked.files.length ? { filesHash: sha256(canonicalJson(checked.files)) } : {}) };
    } else {
      if (!actions?.execute) throw stepFailure("Native lesson observations are unavailable in this host.");
      const receipt = entry.receipts?.find(value => value.stepId === stepId && value.checkId === check.id);
      if (!receipt || receipt.sessionId !== target.sessionId) {
        return { ok: true, stepId, outcome: "not-yet-passed", recorded: false, replayed: false,
          reason: "No App interaction has been captured for this step yet. Press the App's control in this lesson's Preview first." };
      }
      checked = await runExerciseResponseCheck({ actions, checks, context, failure: stepFailure, actor, target, targetInput,
        attemptId, observationId, exercise: receipt, checkId: check.id, stepId });
      evidence = { checkId: check.id, observationId };
    }
    const outcome = checked.checkResult.outcome;
    const reason = boundedReason(checked.reason);
    if (outcome === "passed" && trigger !== "learner") {
      return { ok: true, stepId, outcome, recorded: false, replayed: false,
        diagnostic: "The check verified this work. Only the learner's own Check in the lesson records the pass." };
    }
    return record({ actor, attemptId, requestId,
      result: { stepId, kind: "auto", outcome, evidence, origin: "check", ...(reason ? { reason } : {}) } });
  }

  // The server comparator: the only reader of a choice step's answer.
  async function answer({ actor, attemptId, stepId, selected, requestId } = {}) {
    if (!requestPattern.test(requestId || "")) throw stepFailure("Answer with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    const { step } = await openStep({ actor, attemptId, stepId });
    if (step.check?.kind !== "choice") throw stepFailure("This step is not a choice question.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    const options = step.check.options?.length || 0;
    if (!Array.isArray(selected) || !selected.length || selected.length > options || new Set(selected).size !== selected.length ||
        selected.some(value => !Number.isSafeInteger(value) || value < 0 || value >= options)) {
      throw stepFailure("Choose one or more of this question's options.", "ACTION_VALIDATION_FAILED", 400);
    }
    const expected = step.check.answer;
    if (!Array.isArray(expected) || !expected.length) {
      throw stepFailure("This installation cannot compare the answer for this step.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    }
    const chosen = [...selected].sort((left, right) => left - right);
    const outcome = canonicalJson(chosen) === canonicalJson([...expected].sort((left, right) => left - right)) ? "passed" : "not-yet-passed";
    return record({ actor, attemptId, requestId, same: saved => canonicalJson(saved.evidence) === canonicalJson({ selected: chosen }),
      result: { stepId, kind: "choice", outcome, evidence: { selected: chosen }, origin: "learner" } });
  }

  // The learner's own self-check.
  async function done({ actor, attemptId, stepId, requestId } = {}) {
    if (!requestPattern.test(requestId || "")) throw stepFailure("Mark a step done with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    const { step } = await openStep({ actor, attemptId, stepId });
    if (step.check?.kind !== "self") throw stepFailure("Only a self-check step can be marked done.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    return record({ actor, attemptId, requestId, result: { stepId, kind: "self", outcome: "passed", evidence: {}, origin: "learner" } });
  }

  // Results of one attempt, plus the steps passed in any attempt pinned to the
  // same lesson content (which is what completion counts).
  async function read({ actor, attemptId } = {}) {
    if (!uuidPattern.test(attemptId || "")) throw stepFailure("Use an exact saved attempt ID.", "ACTION_VALIDATION_FAILED", 400);
    const { attempts, revision, progress } = await learners.readStepProgress({ actor });
    const attempt = progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt) throw stepFailure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const steps = lessonSteps(lesson);
    if (!steps) throw stepFailure("This lesson uses assessments, not steps.", "VIBE64_TRAINING_LESSON_VERSION");
    const sameLesson = new Set(progress.attempts.filter(value => canonicalJson(value.pin.lesson) === canonicalJson(attempt.pin.lesson))
      .map(value => value.attemptId));
    const passed = new Set(attempts.filter(entry => sameLesson.has(entry.attemptId))
      .flatMap(entry => entry.results.filter(result => result.outcome === "passed").map(result => result.stepId)));
    const required = steps.filter(step => step.required).map(step => step.id);
    const results = (attempts.find(entry => entry.attemptId === attemptId)?.results || []).map(result => structuredClone(result));
    return { attemptId, revision, results, passedStepIds: steps.map(step => step.id).filter(id => passed.has(id)),
      completion: { lessonCode: lesson.lesson.code, lessonHash: lesson.hash, required: required.length,
        passed: required.filter(id => passed.has(id)).length, completed: required.every(id => passed.has(id)) } };
  }

  // Entering a code step records its authorship baseline; re-entering the same
  // step keeps it. Other steps, ended attempts and absent practice record none.
  async function enterStep({ actor, attemptId, stepId } = {}) {
    if (typeof authorship?.recordStepBaseline !== "function") return { recorded: false };
    return authorship.recordStepBaseline({ actor, attemptId, stepId });
  }

  // Last write wins. The baseline is attempted after the position is saved; a
  // baseline failure is reported without losing the position.
  async function saveReader({ actor, attemptId, stepId, scroll } = {}) {
    const reader = await learners.saveReader({ actor, attemptId, stepId, scroll });
    let baseline;
    try {
      baseline = await enterStep({ actor, attemptId, stepId });
    } catch (error) {
      baseline = { recorded: false, code: error?.code || "VIBE64_TRAINING_CODE_BASELINE_FAILED",
        reason: String(error?.message || "The step's starting files could not be recorded.").slice(0, 256) };
    }
    return { reader, baseline };
  }

  return Object.freeze({ observe, runCheck, answer, done, read, enterStep, saveReader });
}

export { createTrainingStepChecks, runCodeCheckObservation, runExerciseResponseCheck };
