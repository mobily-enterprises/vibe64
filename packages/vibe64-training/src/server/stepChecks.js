import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "./content.js";
import { compareChoiceAnswer } from "./installedContent.js";
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

// Invoke the step's declared exercise response check for one learner-origin
// App interaction in the exact ready App run.
async function runExerciseResponseCheck({ actions, checks, context, actor, target,
  attemptId, observationId, exercise, checkId, stepId }) {
  if (typeof checks?.runOrientationCheck !== "function") {
    throw stepFailure("The installed exercise response check is unavailable in this host.");
  }
  const outputs = requireResult(await actions.execute({ actionId: "vibe64.terminals.outputs.read",
    input: target, context }), stepFailure);
  const terminalId = outputs?.activeTerminal?.id;
  if (!terminalId) throw stepFailure("Use the exact ready App run for this exercise before repeating the interaction.");
  const checked = await checks.runOrientationCheck({ actor, signal: context.signal,
    attemptId, sessionId: target.sessionId, terminalId, observationId,
    instanceId: exercise.instanceId, interactionId: exercise.interactionId, requestId: exercise.requestId, stepId });
  if (checked?.checkResult?.check !== checkId || checked.checkResult.observationId !== observationId ||
      !["passed", "not-yet-passed"].includes(checked.checkResult.outcome)) {
    throw stepFailure("The declared check did not confirm this exact native observation.");
  }
  return checked;
}

// Invoke the step's declared code check and accept only its bounded
// authorship-qualified result.
async function runCodeCheckObservation({ checks, context, actor, attemptId, sessionId, observationId, checkId, stepId }) {
  if (typeof checks?.runCodeCheck !== "function") {
    throw stepFailure("The installed code check is unavailable in this host.");
  }
  const checked = await checks.runCodeCheck({ actor, signal: context.signal, attemptId, sessionId, observationId, stepId });
  if (checked?.checkResult?.check !== checkId || checked.checkResult.observationId !== observationId ||
      !["passed", "not-yet-passed"].includes(checked.checkResult.outcome) || !["learner", "other"].includes(checked.authorship) ||
      checked.authorship === "other" && checked.checkResult.outcome !== "not-yet-passed") {
    throw stepFailure("The declared code check did not confirm this exact native observation.");
  }
  return checked;
}

// The learner's own browser reaches Learning only through the api channel;
// Colleague's tools run on the automation channel and every server-side
// re-entry on internal. The origin is derived here from the admitted action
// context, never from caller input.
function stepCheckTrigger(context) {
  return context?.channel === "api" ? "learner" : "assistant";
}

function requireLearnerChannel(context, what) {
  if (stepCheckTrigger(context) !== "learner") {
    throw stepFailure(`Only the learner can ${what} in the lesson.`, "VIBE64_TRAINING_LEARNER_ONLY", 403);
  }
}

// Version 2 step results. Passes come only from: the automatic check runner
// with learner-origin evidence (a browser-captured exercise interaction, or
// learner-authored code per the authorship ledger) when the learner triggered
// it, the choice comparator, a review check the learner pressed (their own AI
// judging their practice work against the author's rubric), or the learner's
// own Done on a self-check or reading step. Results belong to the attempt in
// progress; a new attempt (Redo, Restart) starts with none. A check the
// assistant triggers returns diagnostics only and records nothing, so
// Colleague can never use up the attempt's result budget, and Colleague can
// never run a review. Verdicts are final: a pass is never replaced.
function createTrainingStepChecks({ learners, content, checks, authorship, actions, evidence = null, reviewer = null } = {}) {
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
    if (attempt.preparation?.phase !== "ready") {
      throw stepFailure("Wait until this lesson's practice project is ready, then try again.", "VIBE64_TRAINING_PRACTICE_NOT_READY");
    }
    return { projectSlug: attempt.projectSlug, sessionId: attempt.preparation.initialSessionId };
  }

  async function savedEntry(actor, attempt) {
    return (await learners.readStepProgress({ actor, attemptId: attempt.attemptId })).entry;
  }

  function replayed(result, stepId, same = () => true) {
    if (result.stepId !== stepId || !same(result)) {
      throw stepFailure("This request ID already recorded a different step result.", "VIBE64_TRAINING_REQUEST_CONFLICT");
    }
    return { ok: true, stepId, outcome: result.outcome, recorded: true, replayed: true, ...(result.reason ? { reason: result.reason } : {}),
      ...(result.review ? { review: structuredClone(result.review) } : {}) };
  }

  // Append-only. A request ID replays its original result; a step that already
  // passed in this attempt keeps that pass and records nothing further.
  // Capacity for one pass of every step not yet passed is always
  // reserved: a not-yet-passed result that would eat into it is returned but
  // not saved, so retries never block the learner's real pass.
  async function record({ actor, attemptId, requestId, result, receipt, same, lesson }) {
    const checkable = (lessonSteps(lesson) || []).map(step => step.id);
    const { value } = await learners.updateStepProgress({ actor, attemptId }, async entry => {
      const existing = entry.results.find(saved => saved.requestId === requestId);
      if (existing) return { value: replayed(existing, result.stepId, same) };
      const passedIds = new Set(entry.results.filter(saved => saved.outcome === "passed").map(saved => saved.stepId));
      if (passedIds.has(result.stepId)) return { value: { ok: true, stepId: result.stepId, outcome: "passed", recorded: false, replayed: false, alreadyPassed: true } };
      const outstanding = checkable.filter(id => !passedIds.has(id)).length;
      if (result.outcome !== "passed" && entry.results.length + outstanding >= MAX_STEP_RESULTS) {
        return { value: { ok: true, stepId: result.stepId, outcome: result.outcome, recorded: false, replayed: false,
          ...(result.reason ? { reason: result.reason } : {}),
          diagnostic: "Not saved: this lesson keeps its remaining history for passes. Try again when your work is ready." } };
      }
      if (entry.results.length >= MAX_STEP_RESULTS) {
        throw stepFailure(`This lesson reached its ${MAX_STEP_RESULTS} saved step results. Its history is kept; ask the owner to review it.`,
          "VIBE64_TRAINING_STEP_RESULTS_FULL");
      }
      const saved = { ...result, requestId, recordedAt: new Date().toISOString() };
      const receipts = receipt ? [...entry.receipts.filter(value => value.stepId !== receipt.stepId), receipt] : entry.receipts;
      return { entry: { results: [...entry.results, saved], receipts },
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
  async function observe({ actor, attemptId, stepId, observation, context = {} } = {}) {
    requireLearnerChannel(context, "record an App interaction");
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
    requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: target, context }), stepFailure);
    const requestId = input.exercise.requestId;
    const previous = (await savedEntry(actor, attempt)).results.find(value => value.requestId === requestId);
    if (previous) return replayed(previous, stepId);
    const observationId = randomUUID();
    const checked = await runExerciseResponseCheck({ actions, checks, context, actor, target,
      attemptId, observationId, exercise: input.exercise, checkId: check.id, stepId });
    const reason = boundedReason(checked.reason);
    return record({ actor, attemptId, requestId, lesson,
      result: { stepId, kind: "auto", outcome: checked.checkResult.outcome, evidence: { checkId: check.id, observationId },
        origin: "check", ...(reason ? { reason } : {}) },
      receipt: { stepId, checkId: check.id, observationId, ...input.exercise, sessionId: target.sessionId, observedAt: new Date().toISOString() } });
  }

  // Runs the step's declared check. The trigger is derived from the admitted
  // action channel: the learner's own browser press, or anything else
  // (Colleague included), which only ever gets a diagnostic.
  async function runCheck({ actor, attemptId, stepId, requestId, context = {} } = {}) {
    const trigger = stepCheckTrigger(context);
    if (!requestPattern.test(requestId || "")) {
      throw stepFailure("Run a step check with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    }
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    const check = declaredCheck(lesson, step);
    const entry = await savedEntry(actor, attempt);
    const previous = entry.results.find(value => value.requestId === requestId);
    if (previous) return replayed(previous, stepId);
    const target = practiceTarget(attempt);
    const observationId = randomUUID();
    let checked;
    let evidence;
    if (check.kind === "code") {
      checked = await runCodeCheckObservation({ checks, context, actor, attemptId,
        sessionId: target.sessionId, observationId, checkId: check.id, stepId });
      evidence = { checkId: check.id, observationId,
        ...(Array.isArray(checked.files) && checked.files.length ? { filesHash: sha256(canonicalJson(checked.files)) } : {}) };
    } else {
      if (!actions?.execute) throw stepFailure("Native lesson observations are unavailable in this host.");
      const receipt = entry.receipts.find(value => value.stepId === stepId && value.checkId === check.id);
      if (!receipt || receipt.sessionId !== target.sessionId) {
        return { ok: true, stepId, outcome: "not-yet-passed", recorded: false, replayed: false,
          reason: "No App interaction has been captured for this step yet. Press the App's control in this lesson's Preview first." };
      }
      checked = await runExerciseResponseCheck({ actions, checks, context, actor, target,
        attemptId, observationId, exercise: receipt, checkId: check.id, stepId });
      evidence = { checkId: check.id, observationId };
    }
    const outcome = checked.checkResult.outcome;
    const reason = boundedReason(checked.reason);
    if (trigger !== "learner") {
      return { ok: true, stepId, outcome, recorded: false, replayed: false, ...(reason ? { reason } : {}),
        diagnostic: outcome === "passed"
          ? "The check verified this work. Only the learner's own Check in the lesson records the pass."
          : "Diagnostic only: a check Colleague runs is never saved in the learner's results." };
    }
    return record({ actor, attemptId, requestId, lesson,
      result: { stepId, kind: "auto", outcome, evidence, origin: "check", ...(reason ? { reason } : {}) } });
  }

  // The server comparator: the only reader of a choice step's answer, which
  // never appears in readLesson (contract C1).
  async function answer({ actor, attemptId, stepId, selected, requestId, context = {} } = {}) {
    requireLearnerChannel(context, "answer a question");
    if (!requestPattern.test(requestId || "")) throw stepFailure("Answer with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    if (step.check?.kind !== "choice") throw stepFailure("This step is not a choice question.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    const options = step.check.options?.length || 0;
    if (!Array.isArray(selected) || !selected.length || selected.length > options || new Set(selected).size !== selected.length ||
        selected.some(value => !Number.isSafeInteger(value) || value < 0 || value >= options)) {
      throw stepFailure("Choose one or more of this question's options.", "ACTION_VALIDATION_FAILED", 400);
    }
    if (typeof content.readChoiceAnswer !== "function") {
      throw stepFailure("This installation cannot compare the answer for this step.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    }
    const { answer: expected } = await content.readChoiceAnswer({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code,
      lessonHash: attempt.pin.lesson.hash, stepId });
    const chosen = [...selected].sort((left, right) => left - right);
    // The content owner's comparator: exactly the authored answer indexes, in any order.
    const outcome = compareChoiceAnswer(expected, chosen) ? "passed" : "not-yet-passed";
    return record({ actor, attemptId, requestId, lesson, same: saved => canonicalJson(saved.evidence) === canonicalJson({ selected: chosen }),
      result: { stepId, kind: "choice", outcome, evidence: { selected: chosen }, origin: "learner" } });
  }

  // The learner's own self-check, or their "read" mark on a reading step
  // (check "none"): a learner-origin pass. Automatic and choice steps are
  // proven only by their checks.
  async function done({ actor, attemptId, stepId, requestId, context = {} } = {}) {
    requireLearnerChannel(context, "mark a step done");
    if (!requestPattern.test(requestId || "")) throw stepFailure("Mark a step done with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    const { lesson, step } = await openStep({ actor, attemptId, stepId });
    if (!["self", "none"].includes(step.check?.kind)) {
      throw stepFailure("Only a self-check or reading step can be marked done.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    }
    return record({ actor, attemptId, requestId, lesson, result: { stepId, kind: step.check.kind === "none" ? "read" : "self", outcome: "passed", evidence: {}, origin: "learner" } });
  }

  function requireEvidence() {
    if (typeof evidence?.read !== "function") {
      throw stepFailure("Reading practice work is unavailable in this installation.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    }
    return evidence;
  }

  // The step's review evidence: changes always, the coding conversation only
  // when the step's review declares it.
  const reviewsConversation = step => step.check?.kind === "review" && (step.check.evidence || []).includes("conversation");

  // Browser only: the learner's "Check my work". Their own AI reviews the
  // practice work against the step's rubric. Nothing runs while the coding
  // agent works or when there is nothing to review; the same evidence returns
  // its saved review without asking again; a failed review records nothing.
  async function review({ actor, attemptId, stepId, requestId, context = {} } = {}) {
    requireLearnerChannel(context, "ask for a review of your work");
    if (!requestPattern.test(requestId || "")) throw stepFailure("Ask for a review with a stable request ID.", "ACTION_VALIDATION_FAILED", 400);
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    if (step.check?.kind !== "review") throw stepFailure("This step has no review check.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    if (typeof reviewer?.review !== "function") throw stepFailure("Reviews are unavailable in this installation.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    const entry = await savedEntry(actor, attempt);
    const previous = entry.results.find(value => value.requestId === requestId);
    if (previous) return replayed(previous, stepId);
    if (entry.results.some(value => value.stepId === stepId && value.outcome === "passed")) {
      return { ok: true, stepId, outcome: "passed", recorded: false, replayed: false, alreadyPassed: true };
    }
    practiceTarget(attempt);
    const read = await requireEvidence().read({ attempt, conversation: reviewsConversation(step), context });
    if (read.session.agentWorking) {
      throw stepFailure("Wait until the agent finishes, then check your work again.", "VIBE64_TRAINING_REVIEW_AGENT_WORKING");
    }
    if (read.empty) {
      return { ok: true, stepId, outcome: "not-yet-passed", recorded: false, replayed: false,
        reason: "No changes yet. Change your practice project first, then check your work again." };
    }
    const evidenceHash = sha256(canonicalJson({ lessonHash: lesson.hash, stepId, rubric: step.check.rubric, evidence: read.evidence }));
    const same = entry.results.findLast(value => value.stepId === stepId && value.kind === "review" && value.evidence.evidenceHash === evidenceHash);
    if (same) return replayed(same, stepId);
    const verdict = await reviewer.review({ actor, lesson, step, evidence: read.evidence,
      workflowEngineId: read.session.workflowEngineId, context });
    const { passed, ...feedback } = verdict;
    const saved = await record({ actor, attemptId, requestId, lesson,
      result: { stepId, kind: "review", outcome: passed ? "passed" : "not-yet-passed", origin: "check",
        evidence: { reviewId: randomUUID(), evidenceHash }, review: feedback } });
    return saved.alreadyPassed ? saved : { ...saved, review: structuredClone(feedback) };
  }

  // Read-only, for Colleague's "I'm stuck" help: the same bounded evidence a
  // review reads, and the step's last saved review. It never passes a step.
  async function readEvidence({ actor, attemptId, stepId, context = {} } = {}) {
    const { attempt, lesson, step } = await openStep({ actor, attemptId, stepId });
    if (!lesson.lesson.exercise) throw stepFailure("This lesson has no practice project to read.", "VIBE64_TRAINING_CHECK_UNDECLARED");
    practiceTarget(attempt);
    const read = await requireEvidence().read({ attempt, conversation: reviewsConversation(step), context });
    const last = (await savedEntry(actor, attempt)).results.findLast(value => value.stepId === stepId && value.kind === "review");
    return { ok: true, stepId, agentWorking: read.session.agentWorking, empty: read.empty, evidence: read.evidence,
      ...(step.check?.kind === "review" ? { rubric: step.check.rubric } : {}),
      lastReview: last ? { outcome: last.outcome, recordedAt: last.recordedAt, ...structuredClone(last.review) } : null };
  }

  // The saved step results of this attempt and the steps passed in them (which
  // is what completion counts). An ended attempt's results went with it.
  async function read({ actor, attemptId } = {}) {
    if (!uuidPattern.test(attemptId || "")) throw stepFailure("Use an exact saved attempt ID.", "ACTION_VALIDATION_FAILED", 400);
    const { entry, revision, attempt } = await learners.readStepProgress({ actor, attemptId });
    const lesson = await content.readLesson({ ...attempt.pin.topic, lessonCode: attempt.pin.lesson.code, lessonHash: attempt.pin.lesson.hash });
    const steps = lessonSteps(lesson);
    if (!steps) throw stepFailure("This lesson uses assessments, not steps.", "VIBE64_TRAINING_LESSON_VERSION");
    const results = entry.results.map(result => structuredClone(result));
    const passed = new Set(results.filter(result => result.outcome === "passed").map(result => result.stepId));
    const required = steps.filter(step => step.required).map(step => step.id);
    return { attemptId, revision, results, passedStepIds: steps.map(step => step.id).filter(id => passed.has(id)),
      completion: { lessonCode: lesson.lesson.code, lessonHash: lesson.hash, required: required.length,
        passed: required.filter(id => passed.has(id)).length, completed: required.every(id => passed.has(id)) } };
  }

  // Entering a code step records its authorship baseline once; every later
  // entry keeps it. Other steps, ended attempts and absent practice record none.
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

  return Object.freeze({ observe, runCheck, answer, done, review, readEvidence, read, enterStep, saveReader });
}

export { createTrainingStepChecks };
