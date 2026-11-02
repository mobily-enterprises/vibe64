import { lessonAvailableTo } from "./lessonAvailability.js";
import {
  attemptProjection,
  attemptSummary,
  boundedResult,
  completionProjection,
  pick,
  practiceSlug,
  preparedAttemptId,
  preparedResult,
  signedInLearner,
  toCourseInstallError,
  toTrainingOperationError
} from "./trainingResults.js";
import { text } from "./actionSchemas.js";
import { conflictFailure } from "./errors.js";

/** @typedef {import("./types.js").InstalledTrainingCatalogue} InstalledTrainingCatalogue */
/** @typedef {import("./types.js").TrainingContent} TrainingContent */
/** @typedef {import("./types.js").TrainingCourseInstaller} TrainingCourseInstaller */
/** @typedef {import("./types.js").TrainingExercises} TrainingExercises */
/** @typedef {import("./types.js").TrainingLearners} TrainingLearners */
/** @typedef {import("./types.js").TrainingLearningSpace} TrainingLearningSpace */
/** @typedef {import("./types.js").TrainingPublishLearnerChanged} TrainingPublishLearnerChanged */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Course creation reports the catalogue owner's own corrective message.
 * @param {Error & { code?: string }} cause
 */
function toCourseCreationError(cause) {
  if (/^VIBE64_TRAINING_(COURSE|CATALOGUE)_/u.test(cause.code || "")) return cause;
  return toTrainingOperationError(cause);
}

/**
 * Lesson refusals (a preview course, another lesson in progress with its
 * details, an incomplete lesson, the archive limit or a pinned session) report
 * their own message; nothing was changed.
 * @param {Error & { code?: string, statusCode?: number }} cause
 */
function toLessonError(cause) {
  if (cause.statusCode < 500 &&
      /^(VIBE64_TRAINING_(COURSE_PREVIEW|LESSON_|PRACTICE_|ATTEMPT_MISSING|STATE_REVISION)|vibe64_project_pinned)/u.test(
        cause.code || ""
      )) return cause;
  return toTrainingOperationError(cause);
}

/**
 * Runs one Training operation for the signed-in learner, with its result bounded.
 * @param {(input: object, actor: object, context: object) => Promise<object>} operation
 * @param {object} input
 * @param {object} context
 * @param {(cause: Error) => Error} toError the error a failure reports
 */
async function runForLearner(operation, input, context, toError) {
  const actor = signedInLearner(context);
  try {
    return boundedResult(await operation(input, actor, context));
  } catch (cause) {
    if (cause.code === "VIBE64_TRAINING_ACTION_RESULT_TOO_LARGE") throw cause;
    throw toError(cause);
  }
}

/**
 * What each Training action does for the signed-in learner: course reads and
 * installs, the learner's state and Learn mode, and starting, resuming,
 * restarting or finishing a lesson. Each operation reads the signed-in learner
 * from its context and bounds its result; a refusal the person can act on
 * reports its owner's own message, and any other failure the attempt-preserving
 * operation error.
 * @param {object} dependencies
 * @param {InstalledTrainingCatalogue} dependencies.catalogue
 * @param {TrainingLearners} dependencies.learners
 * @param {TrainingContent} dependencies.content
 * @param {TrainingExercises} dependencies.exercises
 * @param {TrainingCourseInstaller} dependencies.courseInstaller
 * @param {TrainingLearningSpace} dependencies.learningSpace
 * @param {TrainingPublishLearnerChanged} dependencies.publishLearnerChanged
 * @param {RuntimeLogger} dependencies.logger
 */
function createTrainingOperations({
  catalogue,
  learners,
  content,
  exercises,
  courseInstaller,
  learningSpace,
  publishLearnerChanged,
  logger
}) {
  // A pinned lesson's steps never change, so each is read once; who may take
  // them is decided per read (lessonAvailability.js).
  const pinnedSteps = new Map();
  async function lessonListedFor(actor, topic, lesson) {
    const key = JSON.stringify([topic.topicId, topic.commit, topic.manifestHash, lesson.code, lesson.hash]);
    if (!pinnedSteps.has(key)) {
      pinnedSteps.set(key, content.readLesson({
        topicId: topic.topicId,
        commit: topic.commit,
        topicHash: topic.manifestHash,
        lessonCode: lesson.code,
        lessonHash: lesson.hash
      }).then(
        read => read.steps || [],
        error => error?.code === "VIBE64_TRAINING_LESSON_UNUSABLE" ? "unusable" : null
      ));
    }
    const steps = await pinnedSteps.get(key);
    // One this Vibe64 cannot teach is left out and named on its course.
    if (steps === "unusable") return "unusable";
    // A lesson that cannot be read here (a draft, a retired format) stays listed; starting it explains.
    return steps === null || lessonAvailableTo({ steps }, actor);
  }
  // Learn mode: a saved per-learner flag, separate from any
  // lesson; the current lesson is the one in progress. The shell and
  // Colleague read it; every tab of this learner rereads it on
  // vibe64.training.learner.changed.
  // readable-check: allow method-probe - optional operation: a learner store without Learn mode answers that it is unavailable
  const modeAvailable = typeof learners.readLearningMode === "function";
  const learningModeView = mode =>
    mode ? pick(mode, ["on", "currentAttemptId", "lessonCode", "lessonTitle", "lessonStage", "practiceSlug"]) : { on: false };
  const notifyLearner = async (actor, lessonAttemptId, reason = "lesson") => {
    await publishLearnerChanged({ actor, attemptId: lessonAttemptId, reason });
  };
  /**
   * Starting, restarting, resuming or finishing a lesson changes the current
   * lesson. A failure may already have changed it (the mode set, the old
   * attempt archived), so every tab rereads either way: about lessonAttemptId after a failure, and about the attempt
   * changedAttemptId reads from the result after a success.
   */
  const announced = async (actor, operation, lessonAttemptId, changedAttemptId) => {
    let result;
    try {
      result = await operation();
    } catch (error) {
      await notifyLearner(actor, lessonAttemptId).catch(notifyError => logger.warn(
        { error: notifyError, attemptId: lessonAttemptId },
        "The learner's tabs were not told about a failed lesson change; the failure is still reported."
      ));
      throw error;
    }
    await notifyLearner(actor, changedAttemptId(result));
    return result;
  };

  async function listCoursesForLearner(_input, actor) {
    const result = await catalogue.readCatalogue({ includeLessonTitles: true });
    const courses = [];
    for (const entry of result.courses) {
      // A lesson this person cannot take here (its places are not this
      // installation's, or not open to them) is left out, as is a topic left empty.
      const lessons = [];
      const unusable = [];
      for (const topic of entry.lock.topics) {
        for (const lesson of topic.lessons) {
          const listed = await lessonListedFor(actor, topic, lesson);
          if (listed === "unusable") unusable.push({ topic, lesson });
          else if (listed) lessons.push({ topic, lesson });
        }
      }
      const topics = entry.lock.topics.filter(topic => lessons.some(item => item.topic === topic));
      courses.push({ entry, topics, lessons, unusable });
    }
    return {
      ok: true,
      available: true,
      revision: result.revision,
      // readable-check: allow method-probe - optional operation: a catalogue without custom courses does not offer them
      canCreateCourses: actor.role === "owner" && typeof catalogue.createCourse === "function",
      canTryPreviews: actor.role === "owner",
      courses: courses.map(({ entry, topics, lessons, unusable }) => ({
        ...pick(entry.course, ["courseId", "release", "title", "status", "orientation"]),
        enabled: entry.enabled,
        topics: topics.map(topic => ({
          topicId: topic.topicId,
          release: topic.release,
          title: (entry.topicTitles || []).find(value => value.topicId === topic.topicId && value.release === topic.release)?.title ||
            topic.topicId
        })),
        lessons: lessons.map(({ topic, lesson }) => {
          const matches = (entry.lessonTitles || []).filter(value => value.topicId === topic.topicId &&
            value.topicRelease === topic.release && value.code === lesson.code && value.hash === lesson.hash);
          const title = matches[0]?.title;
          if (matches.length !== 1 || typeof title !== "string" || title.length < text.minLength || title.length > text.maxLength) {
            throw new Error("The installed catalogue did not return one bounded title for this exact lesson pin.");
          }
          return {
            ...pick(lesson, ["code", "hash", "status", "required"]),
            title,
            topicId: topic.topicId,
            topicRelease: topic.release
          };
        }),
        // Installed lessons this version of Vibe64 cannot teach, by title.
        unusableLessons: unusable.map(({ topic, lesson }) => ({
          code: lesson.code,
          title: (entry.lessonTitles || []).find(value => value.topicId === topic.topicId && value.topicRelease === topic.release &&
            value.code === lesson.code && value.hash === lesson.hash)?.title || lesson.code
        }))
      }))
    };
  }

  async function listAvailableCoursesForLearner() {
    const result = await courseInstaller.listAvailable();
    return {
      ok: true,
      available: true,
      repository: result.repository,
      catalogueCommit: result.commit,
      domains: result.domains,
      courses: result.courses
    };
  }

  async function installCourseForLearner(input) {
    const result = await courseInstaller.installCourse(pick(input, ["courseId", "release"]));
    return {
      ok: true,
      available: true,
      changed: result.changed === true,
      catalogueCommit: result.catalogueCommit,
      retired: Array.isArray(result.retired) ? result.retired : [],
      ...(Number.isSafeInteger(result.revision) ? { revision: result.revision } : {}),
      course: { ...pick(result.course, ["courseId", "release", "title", "status"]), enabled: true }
    };
  }

  async function readLearningForLearner(_input, actor) {
    const result = await learners.readState({ actor, includeCompletion: true });
    const attempts = [];
    for (const attempt of result.progress.attempts) {
      attempts.push(attemptSummary(attempt, await practiceSlug({ attempt, actor, learningSpace })));
    }
    return {
      ok: true,
      available: true,
      learnerId: result.progress.learnerId,
      revision: result.revision,
      activeSummaryCurrent: result.activeSummaryCurrent,
      active: attemptProjection(result.active),
      completion: completionProjection(result.completion),
      lessonProgress: (result.lessonCompletions || []).map(value =>
        pick(value, ["lessonCode", "lessonHash", "required", "passed", "completed", "open"])),
      history: result.progress.attempts.filter(value => value.ended).map(attemptProjection),
      attempts,
      // An unreadable mode record must not hide the learner's progress.
      ...(modeAvailable ? await learners.readLearningMode({ actor, includeTitle: true })
        .then(mode => ({ learningMode: learningModeView(mode) }), () => ({})) : {})
    };
  }

  async function readLearningModeForLearner(_input, actor) {
    if (!modeAvailable) return { ok: false, available: false, error: "Learn mode is unavailable in this installation." };
    return { ok: true, available: true, learningMode: learningModeView(await learners.readLearningMode({ actor, includeTitle: true })) };
  }

  async function setLearningModeForLearner(input, actor) {
    // readable-check: allow method-probe - optional operation: a learner store without Learn mode answers that it is unavailable
    if (typeof learners.setLearningMode !== "function") return { ok: false, available: false, error: "Learn mode is unavailable in this installation." };
    const changed = (await learners.readLearningMode({ actor })).on !== input.on;
    if (changed) {
      await learners.setLearningMode({ actor, on: input.on });
      await notifyLearner(actor, "", "learning-mode");
    }
    return {
      ok: true,
      available: true,
      changed,
      learningMode: learningModeView(await learners.readLearningMode({ actor, includeTitle: true }))
    };
  }

  async function createCourseForLearner(input) {
    // readable-check: allow method-probe - optional operation: a catalogue without custom courses answers that they are unavailable
    if (typeof catalogue.createCourse !== "function") {
      return { ok: false, available: false, error: "Custom courses are unavailable in this installation. No course was created." };
    }
    const result = await catalogue.createCourse(pick(input, ["title", "topics", "expectedRevision"]));
    return {
      ok: true,
      available: true,
      revision: result.revision,
      course: { ...pick(result.entry.course, ["courseId", "release", "title", "status"]), enabled: result.entry.enabled }
    };
  }

  async function startLessonForLearner(input, actor) {
    return announced(actor, async () => preparedResult(await exercises.startLesson({
      actor,
      ...pick(input, ["courseId", "release", "lessonCode", "requestId", "expectedRevision", "archiveCurrent"])
    })), "", preparedAttemptId);
  }

  async function resumeLessonForLearner(input, actor) {
    return announced(
      actor,
      async () => preparedResult(await exercises.prepareLesson({ actor, attemptId: input.attemptId })),
      input.attemptId,
      preparedAttemptId
    );
  }

  async function restartLessonForLearner(input, actor, context) {
    // The learner's own Restart button (the api channel) is its confirmation.
    if (context.channel !== "api" && input.confirmed !== true) {
      throw conflictFailure(
        "Ask the person to confirm restarting this exact lesson, then repeat with confirmed: true. Nothing was changed.",
        "VIBE64_TRAINING_LESSON_UNCONFIRMED"
      );
    }
    return announced(actor, async () => preparedResult(await exercises.restartLesson({
      actor,
      ...pick(input, ["attemptId", "requestId", "expectedRevision"])
    })), input.attemptId, preparedAttemptId);
  }

  async function finishLessonForLearner(input, actor) {
    const result = await announced(
      actor,
      () => exercises.finishLesson({ actor, ...pick(input, ["attemptId", "expectedRevision"]) }),
      input.attemptId,
      () => input.attemptId
    );
    return { ok: true, available: true, changed: result.closed === true };
  }

  /**
   * The installed courses and lessons this learner may take here.
   * @param {object} input
   * @param {object} context
   */
  function listCourses(input, context) {
    return runForLearner(listCoursesForLearner, input, context, toTrainingOperationError);
  }

  /**
   * The official catalogue's courses this server can install.
   * @param {object} input
   * @param {object} context
   */
  function listAvailableCourses(input, context) {
    return runForLearner(listAvailableCoursesForLearner, input, context, toCourseInstallError);
  }

  /**
   * Installs and enables one exact catalogue course release.
   * @param {object} input
   * @param {object} context
   */
  function installCourse(input, context) {
    return runForLearner(installCourseForLearner, input, context, toCourseInstallError);
  }

  /**
   * This learner's saved lessons, verified progress and Learn mode.
   * @param {object} input
   * @param {object} context
   */
  function readLearning(input, context) {
    return runForLearner(readLearningForLearner, input, context, toTrainingOperationError);
  }

  /**
   * Whether this learner is in Learn mode, and the lesson in progress.
   * @param {object} input
   * @param {object} context
   */
  function readLearningMode(input, context) {
    return runForLearner(readLearningModeForLearner, input, context, toTrainingOperationError);
  }

  /**
   * Switches this learner between Learn and Develop mode.
   * @param {object} input
   * @param {object} context
   */
  function setLearningMode(input, context) {
    return runForLearner(setLearningModeForLearner, input, context, toTrainingOperationError);
  }

  /**
   * Creates a custom course from whole installed topics.
   * @param {object} input
   * @param {object} context
   */
  function createCourse(input, context) {
    return runForLearner(createCourseForLearner, input, context, toCourseCreationError);
  }

  /**
   * Starts a lesson, or returns the one already in progress.
   * @param {object} input
   * @param {object} context
   */
  function startLesson(input, context) {
    return runForLearner(startLessonForLearner, input, context, toLessonError);
  }

  /**
   * Rechecks an attempt's practice preparation.
   * @param {object} input
   * @param {object} context
   */
  function resumeLesson(input, context) {
    return runForLearner(resumeLessonForLearner, input, context, toLessonError);
  }

  /**
   * Archives the lesson in progress and starts it again.
   * @param {object} input
   * @param {object} context
   */
  function restartLesson(input, context) {
    return runForLearner(restartLessonForLearner, input, context, toLessonError);
  }

  /**
   * Finishes the lesson in progress once every required step has passed.
   * @param {object} input
   * @param {object} context
   */
  function finishLesson(input, context) {
    return runForLearner(finishLessonForLearner, input, context, toLessonError);
  }

  return Object.freeze({
    listCourses,
    listAvailableCourses,
    installCourse,
    readLearning,
    readLearningMode,
    // readable-check: allow setter-seam - not a slot: setLearningMode switches one learner's Learn mode
    setLearningMode,
    createCourse,
    startLesson,
    resumeLesson,
    restartLesson,
    finishLesson
  });
}

export { createTrainingOperations };
