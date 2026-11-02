import { shallowRef } from "vue";
import { EMPTY_PRACTICE, VIBE64_LEARNING_ROUTES, VIBE64_LESSON_IN_PROGRESS_CODE, normalizePractice } from "@/lib/vibe64LearningModel.js";

// The learner's attempts: the In progress / Archived list (Courses), and the
// changes to them: start, resume, restart, finish and delete. Every change is
// one Training action, followed by fresh reads.

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {import("./vibe64LearningModel.js").LearningPendingRequestIds} LearningPendingRequestIds */
/** @typedef {import("./vibe64LearningModes.js").LearningModes} LearningModes */
/** @typedef {ReturnType<typeof createLearningPracticeList>} LearningPracticeList */

/**
 * The lesson in progress and the archived attempts, and the error the
 * Attempts and Finished surfaces show.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 */
function createLearningPracticeList({ state, request }) {
  const practice = shallowRef(EMPTY_PRACTICE);
  let practiceReads = 0;
  // Whether attemptsError came from a failed readPractice, which a later
  // successful read clears; an action's failure stays until an action starts.
  let attemptsErrorFromRead = false;

  /**
   * The lesson in progress and the archived attempts; the latest read wins.
   */
  async function readPractice() {
    if (!state.actorKey) return null;
    const expected = ++practiceReads;
    try {
      const value = normalizePractice(await request(VIBE64_LEARNING_ROUTES.practice, { method: "GET" }));
      if (expected === practiceReads) {
        practice.value = value;
        if (attemptsErrorFromRead) {
          state.attemptsError = "";
          attemptsErrorFromRead = false;
        }
      }
    } catch (cause) {
      // A read failure never replaces a shown action failure.
      if (expected === practiceReads && (!state.attemptsError || attemptsErrorFromRead)) {
        state.attemptsError = String(cause?.message || "Your lessons could not be read. Try again.");
        attemptsErrorFromRead = true;
      }
    }
    return practice.value;
  }

  /**
   * An attempt action's error ("" as the action starts); no read clears it.
   */
  function showActionError(message) {
    state.attemptsError = message;
    attemptsErrorFromRead = false;
  }

  /**
   * Another signed-in viewer: no list, and no read of the previous one lands.
   */
  function reset() {
    practiceReads += 1;
    attemptsErrorFromRead = false;
    practice.value = EMPTY_PRACTICE;
  }

  return Object.freeze({
    practice,
    readPractice,
    showActionError,
    reset
  });
}

/**
 * Starting, resuming, restarting, finishing and deleting attempts, and the
 * confirmation a start needs while another lesson is in progress.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 * @param {LearningPendingRequestIds} dependencies.pending
 * @param {LearningModes} dependencies.modes
 * @param {LearningPracticeList} dependencies.practiceList
 */
function createLearningAttempts({ state, request, pending, modes, practiceList }) {
  // A different lesson in progress refused a start: { current, next } until confirmed or cancelled.
  const confirmArchive = shallowRef(null);
  // viewer fences everything of one signed-in person.
  let viewer = 0;
  // The one finish in flight or confirmed for an attempt.
  let finishRun = null;

  /**
   * After a confirmed start, resume or restart: Learn mode is on and the
   * attempt is the current lesson; show it in its Lesson pane. A resumed
   * lesson that is not the mode's attempt in progress stays this tab's
   * current lesson.
   */
  async function opened(outcome) {
    if (!outcome?.attemptId || outcome.current === false) return outcome;
    const value = await modes.modeWith(outcome.attemptId);
    state.trialAttemptId = value && value.currentAttemptId !== outcome.attemptId ? outcome.attemptId : "";
    await modes.openLesson({ attemptId: outcome.attemptId });
    void practiceList.readPractice();
    return outcome;
  }

  /**
   * The server confirmed a start or resume: Courses closes at once, before
   * the progress reread that opened() waits for. When this tab reads that
   * attempt as the lesson in progress (a start's realtime change rereads the
   * mode), its Lesson pane shows as soon as that read is in.
   */
  function admitted(attemptId) {
    modes.minimise();
    void (async () => {
      await modes.settledMode();
      if (modes.mode.value?.on && modes.mode.value.currentAttemptId === attemptId) await modes.openLesson({ attemptId });
    })().catch(() => {});
  }

  /**
   * Start a lesson through Courses' start (useVibe64LearningCourses.startLesson).
   * A different lesson in progress is refused once: the learner then confirms
   * archiving it (confirmArchiveAndStart) or keeps it (cancelArchive).
   */
  async function startLesson(selection, start) {
    confirmArchive.value = null;
    try {
      return await opened(await start(selection, { onAdmitted: admitted }));
    } catch (cause) {
      if (cause?.code !== VIBE64_LESSON_IN_PROGRESS_CODE) throw cause;
      confirmArchive.value = Object.freeze({ next: selection, start, current: Object.freeze({
        attemptId: String(cause.details?.attemptId || modes.mode.value?.currentAttemptId || ""),
        lessonTitle: String(cause.details?.lessonTitle || modes.mode.value?.lessonTitle || modes.mode.value?.lessonCode || "") }) });
      return null;
    }
  }

  /**
   * Take the tour (the account menu, the end of AI setup): the mounted Courses
   * overlay answers the request by starting its course's orientation lesson
   * through startLesson, the ordinary start (the lesson already in progress
   * simply opens; another one asks to be archived first).
   */
  function openOrientation() {
    if (state.actorKey) state.orientationRequested = true;
  }
  function orientationAnswered() { state.orientationRequested = false; }

  async function confirmArchiveAndStart() {
    const value = confirmArchive.value;
    if (!value) return null;
    confirmArchive.value = null;
    return opened(await value.start({ ...value.next, archiveCurrent: true }, { onAdmitted: admitted }));
  }

  function cancelArchive() { confirmArchive.value = null; }

  /**
   * The saved progress revision that restart and finish are fenced by.
   */
  async function readRevision() {
    const result = await request(VIBE64_LEARNING_ROUTES.learning, { method: "GET" });
    if (result?.ok !== true || !Number.isSafeInteger(result.revision)) throw new Error(result?.error || "Your saved lessons could not be read. Try again.");
    return result.revision;
  }

  /**
   * One change to the lesson in progress or an archive; then the mode, the
   * current lesson and the In progress / Archived lists are reread.
   */
  async function attemptAction(kind, url, body = () => ({}), fallback = "The change was not confirmed. Try again.") {
    if (!state.actorKey || state.busy) return null;
    const expected = viewer;
    state.busy = kind;
    practiceList.showActionError("");
    try {
      const result = await request(url, { method: "POST", body: await body() });
      if (result?.ok !== true) throw new Error(result?.error || fallback);
      if (expected === viewer) await Promise.all([modes.readLearningMode(), practiceList.readPractice()]);
      return result;
    } catch (cause) {
      if (expected === viewer) practiceList.showActionError(String(cause?.message || fallback));
      return null;
    } finally {
      if (state.busy === kind) state.busy = "";
    }
  }

  const currentAttemptId = () => modes.mode.value?.currentAttemptId || "";

  /**
   * Finish: a complete lesson's attempt is archived as finished (its record,
   * practice project and conversation); Learn mode stays on with no lesson.
   * One confirmed finish per attempt: the Finished screen remounts when the
   * archived practice project's page gives way to the Learn page.
   * summary: what the attempt held when its Finished screen first finished it
   * (finishSummary), so a screen that remounts after the archive (which
   * clears the attempt's results) still shows it.
   */
  function finish(summary = null) {
    const attemptId = state.attemptId;
    if (!attemptId) return Promise.resolve(null);
    if (finishRun?.attemptId === attemptId) return finishRun.promise;
    // A retry of the same attempt resumes its close; no request identity.
    const run = { attemptId, summary, promise: attemptAction("finish", VIBE64_LEARNING_ROUTES.lessonFinish(attemptId),
      async () => ({ expectedRevision: await readRevision() }), "Finishing the lesson was not confirmed. Try again.")
      .then(result => {
        if (finishRun === run && !result) finishRun = null;
        if (result && state.trialAttemptId === attemptId) state.trialAttemptId = "";
        return result;
      }) };
    finishRun = run;
    return run.promise;
  }
  const finishSummary = () => finishRun?.attemptId && finishRun.attemptId === state.attemptId ? finishRun.summary : null;

  /**
   * Restart: archive the lesson in progress and start it again (a fresh
   * practice project, teacher conversation and results), then open it.
   */
  async function restart() {
    const attemptId = currentAttemptId();
    if (!attemptId) return null;
    const key = JSON.stringify([attemptId, "restart"]);
    const result = await attemptAction("restart", VIBE64_LEARNING_ROUTES.lessonRestart(attemptId),
      async () => ({ requestId: pending.requestId(key), expectedRevision: await readRevision() }),
      "Restarting the lesson was not confirmed. Try again.");
    if (!result) return null;
    pending.forget(key);
    const next = modes.mode.value?.currentAttemptId || result.active?.attemptId || "";
    await opened({ attemptId: next });
    return result;
  }

  /**
   * Delete: remove the lesson in progress, its practice project and its
   * conversation, with no archive. Learn mode stays on with no lesson.
   */
  async function deleteAttempt() {
    const attemptId = currentAttemptId();
    if (!attemptId) return null;
    return attemptAction("delete", VIBE64_LEARNING_ROUTES.lessonDelete(attemptId), () => ({ confirmed: true }),
      "Deleting the lesson was not confirmed. Try again.");
  }

  const deleteArchived = attemptId => attemptAction(`archive-delete:${attemptId}`, VIBE64_LEARNING_ROUTES.archiveDelete(attemptId),
    () => ({ confirmed: true }), "Deleting the archived lesson was not confirmed. Try again.");

  /**
   * Another signed-in viewer: no confirmation or finish of the previous one, and none of its actions lands.
   */
  function reset() {
    viewer += 1;
    confirmArchive.value = null;
    finishRun = null;
  }

  return Object.freeze({
    confirmArchive,
    opened,
    admitted,
    startLesson,
    openOrientation,
    orientationAnswered,
    confirmArchiveAndStart,
    cancelArchive,
    finish,
    finishSummary,
    restart,
    deleteAttempt,
    deleteArchived,
    reset
  });
}

export { createLearningAttempts, createLearningPracticeList };
