import { availableStepIds } from "./lessonAvailability.js";
import { boundedTrainingResult, conflictFailure } from "./errors.js";
import { pinnedLessonKey } from "./installedContent.js";
import { attemptSummary, pick, practiceSlug, signedInLearner, toTrainingOperationError } from "./trainingResults.js";

/** @typedef {import("./types.js").TrainingContent} TrainingContent */
/** @typedef {import("./types.js").TrainingExercises} TrainingExercises */
/** @typedef {import("./types.js").TrainingLearners} TrainingLearners */
/** @typedef {import("./types.js").TrainingLearningSpace} TrainingLearningSpace */
/** @typedef {import("./types.js").TrainingPublishLearnerChanged} TrainingPublishLearnerChanged */
/** @typedef {import("./types.js").TrainingStepChecks} TrainingStepChecks */

const MAX_PAGE_BODY_BYTES = 64 * 1024;

/**
 * A lesson result, returned whole or refused.
 * @param {object} result
 */
function boundedLessonResult(result) {
  return boundedTrainingResult(result, {
    statusCode: 413,
    message: "The lesson result exceeds 128 KiB. Ask the owner to inspect the content; nothing was silently omitted."
  });
}

function refusalText(reason, fallback) {
  return typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 512) : fallback;
}

/**
 * Never the choice answer: only fields the reader and Colleague may see.
 */
function stepProjection(step) {
  const check = step.check || { kind: "none" };
  return {
    ...pick(step, ["id", "title", "required"]),
    ...(step.visual ? {
      visual: {
        id: step.visual.id,
        play: (step.visual.play || []).map(entry => pick(entry, ["name", "parameters"]))
      }
    } : {}),
    ...(step.guide ? { guide: pick(step.guide, ["target", "navigate", "filePath", "caption"]) } : {}),
    ...(step.beats ? { beats: step.beats.map(beat => pick(beat, ["kind", "target", "path", "prompt", "text"])) } : {}),
    check: {
      kind: check.kind,
      ...(check.kind === "auto" ? pick(check, ["check", "files"]) : {}),
      ...(check.kind === "fact" ? pick(check, ["fact"]) : {}),
      ...(check.kind === "choice" ? pick(check, ["question", "options"]) : {}),
      ...(check.kind === "review" ? { rubric: check.rubric, evidence: check.evidence || ["changes"] } : {})
    }
  };
}

function visualProjection(visual) {
  return {
    ...pick(visual.visual, ["title", "description", "initialState", "states"]),
    id: visual.id,
    commands: (visual.visual.commands || []).map(command => ({
      ...pick(command, ["name", "completionState", "description"]),
      parameters: (command.parameters || []).map(parameter => pick(parameter, ["name", "required", "maxLength"]))
    }))
  };
}

function resultProjection(result) {
  return pick(result, ["stepId", "kind", "outcome", "origin", "recordedAt", "reason", "evidence", "review"]);
}

/**
 * Bodies are paged when they exceed 64 KiB together. Steps outside the
 * requested page keep their metadata and name the page that carries their body.
 */
function pageBodies(steps, notesText) {
  const bytes = value => Buffer.byteLength(value || "");
  let index = 0;
  let used = bytes(notesText);
  for (const step of steps) {
    const size = bytes(step.bodyText);
    if (used && used + size > MAX_PAGE_BODY_BYTES) {
      index += 1;
      used = 0;
    }
    used += size;
    step.bodyPage = index;
  }
  return index + 1;
}

/**
 * Runs one learner-scoped Training operation: the learner is always the
 * authenticated actor, and the result is bounded. A refusal the learner can act
 * on reports its own message; any other failure reports the operation error.
 * @param {(input: object, actor: object, context: object) => Promise<object>} operation
 * @param {object} input
 * @param {object} context
 */
async function runLessonOperation(operation, input, context) {
  const actor = signedInLearner(context);
  try {
    return boundedLessonResult(await operation(input, actor, context));
  } catch (cause) {
    if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE" || cause.statusCode && cause.statusCode < 500 &&
        /^(VIBE64_TRAINING_|ACTION_VALIDATION_FAILED|vibe64_)/u.test(cause.code || "")) throw cause;
    throw toTrainingOperationError(cause);
  }
}

/**
 * What each step action does for the signed-in learner: reading the lesson,
 * observing, checking, answering and reviewing its steps, saving the reader's
 * place, and listing or removing practice. Each change is announced to the
 * learner's tabs. Each operation reads the signed-in learner from its context
 * and bounds its result.
 * @param {object} dependencies
 * @param {TrainingLearners} dependencies.learners
 * @param {TrainingLearners} dependencies.attemptLearners the learners whose attempts the operations read
 * @param {TrainingContent} dependencies.content
 * @param {TrainingStepChecks} dependencies.steps
 * @param {TrainingExercises} dependencies.exercises
 * @param {TrainingLearningSpace} dependencies.learningSpace
 * @param {TrainingPublishLearnerChanged} dependencies.publishLearnerChanged
 */
function createTrainingStepOperations({
  learners,
  attemptLearners,
  content,
  steps,
  exercises,
  learningSpace,
  publishLearnerChanged
}) {
  const notify = async (actor, attempt, reason) => {
    await publishLearnerChanged({ actor, attemptId: attempt, reason });
  };
  const deletingUnavailable = Object.freeze({
    ok: false,
    available: false,
    error: "Deleting lessons is unavailable in this installation. Nothing was changed."
  });

  async function readAttempt(actor, attempt) {
    const state = await attemptLearners.readState({ actor, attemptId: attempt });
    const saved = state.progress.attempts.find(value => value.attemptId === attempt);
    if (!saved) throw conflictFailure("This learner has no matching saved attempt.", "VIBE64_TRAINING_ATTEMPT_MISSING", 404);
    return { state, attempt: saved };
  }
  /**
   * Inner actions (session inspect, App run outputs) are re-admitted with the
   * learner's own request authority against the practice project's ordinary
   * project route: practice sessions are ordinary sessions, so no
   * learning-scoped input remains.
   */
  function stepContext(context) {
    const { vibe64Action: _admitted, ...inner } = context;
    void _admitted;
    return inner;
  }
  const recorded = async (result, actor, attempt, reason) => {
    if (result?.recorded === true && result.replayed !== true) await notify(actor, attempt, reason);
    return pick(result, ["ok", "stepId", "outcome", "recorded", "replayed", "alreadyPassed", "reason", "diagnostic", "review"]);
  };

  async function readLessonForLearner(input, actor) {
    let attempt;
    if (input.attemptId) attempt = (await readAttempt(actor, input.attemptId)).attempt;
    else attempt = (await learners.readState({ actor })).active;
    if (!attempt) return { ok: true, available: true, attempt: null, lesson: null };
    const slug = await practiceSlug({ attempt, actor, learningSpace });
    const lesson = await content.readLesson(pinnedLessonKey(attempt.pin));
    const summary = attemptSummary(attempt, slug);
    // Steps this learner cannot take here (a place this installation does not
    // have, or one only the owner sees) are simply absent.
    const available = availableStepIds(lesson, actor);
    const projected = lesson.steps.filter(step => available.has(step.id)).map(step => ({
      ...stepProjection(step),
      bodyText: step.bodyText
    }));
    const count = pageBodies(projected, lesson.notesText);
    const index = input.page ?? 0;
    if (index >= count) throw conflictFailure(`This lesson has ${count} page(s).`, "ACTION_VALIDATION_FAILED", 400);
    for (const step of projected) if (step.bodyPage !== index) delete step.bodyText;
    const progress = await steps.read({ actor, attemptId: attempt.attemptId });
    // readable-check: allow method-probe - optional operation: a learner store without reader positions reads none
    const reader = typeof attemptLearners.readReader === "function"
      ? await attemptLearners.readReader({ actor, attemptId: attempt.attemptId }) : null;
    return {
      ok: true, available: true, attempt: summary,
      lesson: {
        schemaVersion: lesson.lesson.schemaVersion, code: lesson.lesson.code, hash: lesson.hash, title: lesson.lesson.title,
        ...pick(lesson.lesson, ["estimatedMinutes"]), exercise: Boolean(lesson.lesson.exercise),
        // Where the lesson runs (format 3): studio or project; null for a retired format.
        stage: lesson.lesson.schemaVersion === 3 ? lesson.lesson.stage : null,
        ...(lesson.notesText !== undefined && index === 0 ? { notesText: lesson.notesText } : {}),
        visuals: lesson.visuals.map(visualProjection), steps: projected
      },
      results: progress.results.map(resultProjection), passedStepIds: progress.passedStepIds,
      completion: pick(progress.completion, ["lessonCode", "lessonHash", "required", "passed", "completed"]),
      reader: reader?.attemptId === attempt.attemptId ? pick(reader, ["attemptId", "stepId", "scroll"]) : null,
      page: { index, count }
    };
  }

  async function observeStepForLearner(input, actor, context) {
    await readAttempt(actor, input.attemptId);
    const result = await steps.observe({
      actor,
      attemptId: input.attemptId,
      stepId: input.stepId,
      observation: input.observation,
      context: stepContext(context)
    });
    return recorded(result, actor, input.attemptId, "steps");
  }

  async function runStepCheckForLearner(input, actor, context) {
    await readAttempt(actor, input.attemptId);
    const result = await steps.runCheck({
      actor,
      attemptId: input.attemptId,
      stepId: input.stepId,
      requestId: input.requestId,
      context: stepContext(context)
    });
    return recorded(result, actor, input.attemptId, "steps");
  }

  async function answerStepForLearner(input, actor, context) {
    return recorded(await steps.answer({
      actor,
      context,
      ...pick(input, ["attemptId", "stepId", "selected", "requestId"])
    }), actor, input.attemptId, "steps");
  }

  async function markStepDoneForLearner(input, actor, context) {
    return recorded(await steps.done({
      actor,
      context,
      ...pick(input, ["attemptId", "stepId", "requestId"])
    }), actor, input.attemptId, "steps");
  }

  async function runStepReviewForLearner(input, actor, context) {
    return recorded(await steps.review({
      actor,
      context: stepContext(context),
      ...pick(input, ["attemptId", "stepId", "requestId"])
    }), actor, input.attemptId, "steps");
  }

  async function readStepEvidenceForLearner(input, actor, context) {
    await readAttempt(actor, input.attemptId);
    return steps.readEvidence({ actor, context: stepContext(context), ...pick(input, ["attemptId", "stepId"]) });
  }

  async function saveReaderForLearner(input, actor) {
    const { reader, baseline } = await steps.saveReader({ actor, ...pick(input, ["attemptId", "stepId", "scroll"]) });
    await notify(actor, input.attemptId, "steps");
    return {
      ok: true,
      reader: pick(reader, ["attemptId", "stepId", "scroll"]),
      ...(baseline ? { baseline: pick(baseline, ["recorded", "code", "reason"]) } : {})
    };
  }

  async function listPracticeForLearner(_input, actor) {
    return { ok: true, available: true, ...await learningSpace.list(actor) };
  }

  /**
   * A removal the learner asked for. Colleague needs the person's
   * confirmation; the learner's own one-click browser action does not. A
   * refusal (pinned session, not this learner's) is reported with nothing
   * changed; a removal that stopped part-way is reported and resumes on retry.
   */
  async function removePractice(run, reason, input, actor, context) {
    if (context.channel !== "api" && input.confirmed !== true) {
      throw conflictFailure("Ask the person to confirm this deletion, then repeat with confirmed: true.",
        "VIBE64_TRAINING_PRACTICE_UNCONFIRMED");
    }
    let result;
    try { result = await run(input, actor); }
    catch (cause) {
      if (!(cause.statusCode < 500 && /^(VIBE64_TRAINING_(PRACTICE_|ATTEMPT_MISSING)|vibe64_project_pinned)/u.test(cause.code || ""))) {
        // A removal that stopped part-way changed the lesson (its project deleting).
        await notify(actor, input.attemptId, reason).catch(() => {});
        throw cause;
      }
      return { ok: false, available: true, attemptId: input.attemptId, error: refusalText(cause.message, "Nothing was changed.") };
    }
    if (result === null) return { ...deletingUnavailable };
    await notify(actor, input.attemptId, reason);
    return {
      ok: true,
      available: true,
      attemptId: input.attemptId,
      ...pick(result, ["removed"]),
      ...(Object.hasOwn(result, "closed") ? { changed: result.closed } : {})
    };
  }

  async function deleteLessonForLearner(input, actor, context) {
    return removePractice((removal) => exercises.deleteLesson({ actor, attemptId: removal.attemptId }), "lesson", input, actor, context);
  }

  async function deleteArchivedLessonForLearner(input, actor, context) {
    return removePractice((removal) => learningSpace.deleteArchive({ actor, attemptId: removal.attemptId }), "practice", input, actor,
      context);
  }

  /**
   * The lesson of an attempt (the active one when none is named), one page of its step bodies at a time.
   * @param {object} input
   * @param {object} context
   */
  function readLesson(input, context) {
    return runLessonOperation(readLessonForLearner, input, context);
  }

  /**
   * Records what the learner's browser observed for a step.
   * @param {object} input
   * @param {object} context
   */
  function observeStep(input, context) {
    return runLessonOperation(observeStepForLearner, input, context);
  }

  /**
   * Runs a step's declared check.
   * @param {object} input
   * @param {object} context
   */
  function runStepCheck(input, context) {
    return runLessonOperation(runStepCheckForLearner, input, context);
  }

  /**
   * Records the learner's answer to a choice step.
   * @param {object} input
   * @param {object} context
   */
  function answerStep(input, context) {
    return runLessonOperation(answerStepForLearner, input, context);
  }

  /**
   * Marks a step without a check done.
   * @param {object} input
   * @param {object} context
   */
  function markStepDone(input, context) {
    return runLessonOperation(markStepDoneForLearner, input, context);
  }

  /**
   * Runs the review of a review step.
   * @param {object} input
   * @param {object} context
   */
  function runStepReview(input, context) {
    return runLessonOperation(runStepReviewForLearner, input, context);
  }

  /**
   * The evidence a review step would be reviewed on.
   * @param {object} input
   * @param {object} context
   */
  function readStepEvidence(input, context) {
    return runLessonOperation(readStepEvidenceForLearner, input, context);
  }

  /**
   * Saves the reader's place in the lesson.
   * @param {object} input
   * @param {object} context
   */
  function saveReader(input, context) {
    return runLessonOperation(saveReaderForLearner, input, context);
  }

  /**
   * The learner's current and archived lessons.
   * @param {object} input
   * @param {object} context
   */
  function listPractice(input, context) {
    return runLessonOperation(listPracticeForLearner, input, context);
  }

  /**
   * Deletes the lesson in progress, with its practice project and teacher conversation.
   * @param {object} input
   * @param {object} context
   */
  function deleteLesson(input, context) {
    return runLessonOperation(deleteLessonForLearner, input, context);
  }

  /**
   * Deletes an archived lesson.
   * @param {object} input
   * @param {object} context
   */
  function deleteArchivedLesson(input, context) {
    return runLessonOperation(deleteArchivedLessonForLearner, input, context);
  }

  return Object.freeze({
    readLesson,
    observeStep,
    runStepCheck,
    answerStep,
    markStepDone,
    runStepReview,
    readStepEvidence,
    saveReader,
    listPractice,
    deleteLesson,
    deleteArchivedLesson
  });
}

export { createTrainingStepOperations, runLessonOperation };
