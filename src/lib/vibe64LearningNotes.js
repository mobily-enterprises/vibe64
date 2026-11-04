import { reactive, readonly, shallowRef } from "vue";
import { TRAINING_NOTES_CHANGED_CODE } from "@local/vibe64-training/shared/learner-contract";
import { VIBE64_LEARNING_NOTES_MAX, VIBE64_LEARNING_ROUTES } from "@/lib/vibe64LearningModel.js";

/** @typedef {import("./vibe64LearningModel.js").LearningState} LearningState */
/** @typedef {import("./vibe64LearningModel.js").LearningRequest} LearningRequest */
/** @typedef {import("./vibe64LearningModel.js").LearningPendingRequestIds} LearningPendingRequestIds */

/**
 * Learner notes (C7): the teacher's notes about this learner, read when
 * Courses shows them. Saves replace the whole text against the revision
 * shown, so a newer change by Colleague is never silently overwritten.
 * @param {object} dependencies
 * @param {LearningState} dependencies.state
 * @param {LearningRequest} dependencies.request
 * @param {LearningPendingRequestIds} dependencies.pending
 */
function createLearningNotes({ state, request, pending }) {
  const notes = shallowRef(null);
  const notesState = reactive({ loading: false, saving: false, error: "" });
  // viewer fences everything of one signed-in person.
  let viewer = 0;

  async function readNotes() {
    if (!state.actorKey) return null;
    const expected = viewer;
    notesState.loading = true;
    notesState.error = "";
    try {
      const result = await request(VIBE64_LEARNING_ROUTES.notes, { method: "GET" });
      if (result?.ok !== true || !result.notes) throw new Error(result?.error || "The notes could not be read.");
      // A read that finishes after a newer save never brings back older notes.
      if (expected === viewer && !(result.notes.revision < (notes.value?.revision ?? 0))) notes.value = Object.freeze({ ...result.notes });
      return expected === viewer ? notes.value : null;
    } catch (cause) {
      if (expected === viewer) notesState.error = String(cause?.message || "The notes could not be read.");
      return null;
    } finally {
      if (expected === viewer) notesState.loading = false;
    }
  }

  async function writeNotes(kind, route, body) {
    if (!state.actorKey || notesState.saving) return null;
    const expected = viewer;
    const expectedRevision = notes.value?.revision ?? 0;
    const key = JSON.stringify(["notes", kind, body.text ?? "", expectedRevision]);
    const requestId = pending.requestId(key);
    notesState.saving = true;
    notesState.error = "";
    try {
      const result = await request(route, { method: "POST", body: { ...body, requestId, expectedRevision } });
      if (result?.ok !== true || !result.notes) throw new Error(result?.error || "The notes save was not confirmed. Try again.");
      pending.forget(key);
      if (expected === viewer) notes.value = Object.freeze({ ...result.notes });
      return result;
    } catch (cause) {
      if (expected === viewer) {
        notesState.error = String(cause?.message || "The notes save was not confirmed. Try again.");
        // Someone else changed them: show the current notes; the edit stays with the caller.
        if (cause?.code === TRAINING_NOTES_CHANGED_CODE) {
          pending.forget(key);
          const message = notesState.error;
          await readNotes();
          notesState.error = message;
        }
      }
      return null;
    } finally {
      if (expected === viewer) notesState.saving = false;
    }
  }

  function saveNotes(text) {
    const value = String(text ?? "");
    if (!value || value.length > VIBE64_LEARNING_NOTES_MAX) {
      notesState.error = `Write between 1 and ${VIBE64_LEARNING_NOTES_MAX} characters, or clear the notes.`;
      return Promise.resolve(null);
    }
    return writeNotes("update", VIBE64_LEARNING_ROUTES.notes, { text: value });
  }

  const clearNotes = () => writeNotes("clear", VIBE64_LEARNING_ROUTES.notesClear, {});

  /**
   * Another signed-in viewer: no notes, and no read or save of the previous one lands.
   */
  function reset() {
    viewer += 1;
    notes.value = null;
    Object.assign(notesState, { loading: false, saving: false, error: "" });
  }

  return {
    notes,
    notesState: readonly(notesState),
    readNotes,
    saveNotes,
    clearNotes,
    reset
  };
}

export { createLearningNotes };
