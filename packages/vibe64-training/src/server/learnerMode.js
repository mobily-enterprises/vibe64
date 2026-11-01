import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";

import { validateContent } from "./contentSchemas.js";
import { failure, MAX_MODE_BYTES, modeSchema, readRecord } from "./learnerRecords.js";

/**
 * A learner's Learn mode: read with the lesson in progress and saved by the
 * learner alone.
 * @param {object} dependencies
 * @param {(paths: object) => Promise<void>} dependencies.createNamespace
 * @param {(paths: object) => Promise<object>} dependencies.loadState
 * @param {(actor: object) => object} dependencies.userPaths
 * @param {(pin: object, options?: { admissionOnly?: boolean }) => Promise<object>} dependencies.verifyInstalled
 */
function createLearnerMode({ createNamespace, loadState, userPaths, verifyInstalled }) {
  /**
   * Learn mode (Rev 4 H1): a saved per-learner flag, independent of any
   * lesson; absent means Develop. The current lesson is the attempt in
   * progress, which may stay paused while Learn mode is off. practiceSlug
   * names its practice project once preparation began. includeTitle adds the
   * lesson's title for the shell (admission needs no content read).
   */
  async function readMode(paths) {
    const value = await readRecord(paths.mode, MAX_MODE_BYTES);
    if (!value) return false;
    const mode = validateContent(modeSchema, value, "Learning mode");
    if (mode.learnerId !== paths.learner.id) throw new Error("Learning mode belongs to another learner.");
    return mode.on;
  }

  async function learningModeView(paths, { includeTitle }) {
    const { progress } = await loadState(paths);
    let on;
    try { on = await readMode(paths); } catch (cause) {
      throw failure("VIBE64_TRAINING_STATE_INVALID", `Learning mode is invalid: ${cause.message} Keep the file and ask the owner to inspect it.`, null, { cause });
    }
    const attempt = progress.attempts.find(value => value.attemptId === progress.activeAttemptId);
    // lessonStage: where the lesson runs (format 3), read with its title; ""
    // for a retired format, which has none.
    const mode = { on, currentAttemptId: attempt?.attemptId || "", lessonCode: attempt?.pin.lesson.code || "", lessonTitle: "",
      lessonStage: "", practiceSlug: attempt?.preparation && attempt.preparation.phase !== "reserved" ? attempt.projectSlug : "" };
    if (attempt && includeTitle) {
      try {
        const { lesson } = await verifyInstalled(attempt.pin);
        mode.lessonTitle = String(lesson?.title || "");
        mode.lessonStage = lesson?.schemaVersion === 3 ? lesson.stage : "";
      } catch { /* The code names it. */ }
      mode.lessonTitle ||= mode.lessonCode;
    }
    return Object.freeze(mode);
  }

  async function readLearningMode({ actor, includeTitle = false } = {}) {
    return learningModeView(userPaths(actor), { includeTitle });
  }

  /**
   * Last write wins: switching mode never touches a lesson.
   */
  async function setLearningMode({ actor, on } = {}) {
    const paths = userPaths(actor);
    if (typeof on !== "boolean") throw failure("VIBE64_TRAINING_MODE_INVALID", "Set Learn mode on or off.", 400);
    await createNamespace(paths);
    await writeJsonFileAtomic(paths.mode, { schemaVersion: 2, learnerId: paths.learner.id, on }, { directoryMode: 0o700, fileMode: 0o600 });
    return learningModeView(paths, { includeTitle: true });
  }

  // readable-check: allow setter-seam - not a slot: setLearningMode saves one learner's Learn mode
  return Object.freeze({ readLearningMode, setLearningMode });
}

export { createLearnerMode };
