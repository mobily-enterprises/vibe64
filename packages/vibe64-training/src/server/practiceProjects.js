import { lstat, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { practiceProjectAttemptId } from "@local/vibe64-core/server/practiceProjects";

const removalLocks = new Map();

// Standalone host facility practiceProjects.remove({ slug, actor }). It mirrors
// Online's light deletion (the hosted archive lifecycle minus its archive
// steps): per-slug lock, pinned-session refusal, persisted deletion marker
// with resumable steps, runtime close, source and runtime removal. Standalone
// has no managed resources or resource policy, so those steps have no
// counterpart here. A local practice project lives in the learner's private
// namespace, so every step runs inside the learner's own practice scope.
// The owning attempt is ended (reason `discard`) once the pinned check passes,
// before anything is removed; callers do not end it again.
function createLocalPracticeProjects({ learners, projectContext, project, terminals, removePath = rm } = {}) {
  if (typeof learners?.readExerciseProjectScope !== "function" || typeof learners?.endAttempt !== "function" ||
      typeof projectContext?.runWithPracticeProjectScope !== "function" ||
      typeof project?.runInProjectContext !== "function" || typeof terminals?.closeProjectRuntime !== "function") {
    throw new TypeError("Local practice project removal requires the learner, Project context, Project and terminal owners.");
  }

  async function remove({ slug, actor } = {}) {
    const attemptId = practiceProjectAttemptId(slug);
    if (!attemptId) throw notPractice();
    if (!actor) throw Object.assign(new Error("Log in to Vibe64 before deleting a practice project."), { code: "vibe64_auth_required", statusCode: 401 });
    return withRemovalLock(slug, async () => {
      let saved;
      try { saved = await learners.readExerciseProjectScope({ actor, attemptId, access: "observe" }); }
      catch (error) {
        // Another person's (or no) attempt: the slug names no practice project of this learner.
        if (["VIBE64_TRAINING_ATTEMPT_MISSING", "VIBE64_TRAINING_EXERCISE_MISSING"].includes(error.code)) throw notPractice();
        throw error;
      }
      if (saved.projectSlug !== slug) throw notPractice();
      return projectContext.runWithPracticeProjectScope({ actor, training: saved.training, access: "write", allowDeleting: true },
        () => removeAdmitted(slug, () => endPracticeAttempt({ learners, actor, attemptId })));
    });
  }

  async function removeAdmitted(slug, endAttempt) {
    const state = await projectContext.readWorkspaceProjectState({ slug });
    const projectSessionSourceRoot = projectContext.projectSessionSourceRootForSlug(slug);
    if (!Object.keys(state.metadata).length) {
      // The record is removed last; scope admission already refused leftovers.
      return { ok: true, slug, removed: false };
    }
    const pinnedSessionId = await createVibe64SessionStore({
      projectContextRoot: state.projectContextRoot,
      projectRuntimeRoot: state.projectRuntimeRoot,
      projectSessionSourceRoot
    }).readPinnedSessionId();
    if (pinnedSessionId) {
      throw Object.assign(new Error(`Unpin session ${pinnedSessionId} before deleting this practice project.`), {
        code: "vibe64_project_pinned", statusCode: 409
      });
    }
    await endAttempt();
    const started = await projectContext.beginWorkspaceProjectDeletion({
      startedAt: state.metadata.deletion?.startedAt || new Date().toISOString(), slug
    });
    const steps = { ...started.metadata.deletion?.steps };
    const markComplete = async (step) => {
      Object.assign(steps, (await projectContext.completeWorkspaceProjectDeletionStep({ slug, step })).metadata.deletion.steps);
    };
    if (!steps["runtime-closed"]) {
      const closed = await project.runInProjectContext(slug, () => terminals.closeProjectRuntime({ reason: "project-delete" }),
        { allowDeleting: true });
      if (closed?.ok === false) {
        throw Object.assign(new Error("Project runtime could not be closed before deletion."), {
          code: "vibe64_project_runtime_close_failed", result: closed
        });
      }
      await markComplete("runtime-closed");
    }
    if (!steps["source-removed"]) {
      for (const root of [state.projectContextRoot, projectSessionSourceRoot]) {
        await removePath(root, { force: true, recursive: true });
        if (await exists(root)) {
          throw Object.assign(new Error("Project namespace still exists after deletion."), { code: "vibe64_project_namespace_delete_failed" });
        }
      }
      await markComplete("source-removed");
    }
    if (!steps["state-removal-started"]) await markComplete("state-removal-started");
    await removePath(state.projectRuntimeRoot, { force: true, recursive: true });
    if (await exists(state.projectRuntimeRoot)) {
      throw Object.assign(new Error("Project runtime and session state still exists after deletion."), { code: "vibe64_project_state_delete_failed" });
    }
    // The empty per-attempt namespace directory goes too; anything else stays.
    await rmdir(path.dirname(state.projectContextRoot)).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    });
    return { ok: true, slug, removed: true };
  }

  return Object.freeze({ remove });
}

// End the practice project's attempt with reason `discard`, as lesson.end
// does (preparation.endLesson: the preparation barrier, then the typed
// retirement). Its session stop is not repeated here: deletion closes the
// project runtime, which holds the attempt's practice session. Idempotent: an
// ended, superseded or unknown attempt is left as it is, and the stable request
// ID replays a confirmed end.
async function endPracticeAttempt({ learners, actor, attemptId } = {}) {
  if (!actor || !attemptId) return { ended: false };
  for (let tries = 1; ; tries++) {
    const state = await learners.readState({ actor });
    const attempt = state.progress.attempts.find(value => value.attemptId === attemptId);
    if (!attempt || attempt.ended || state.progress.activeAttemptId !== attemptId) return { ended: false };
    const input = { actor, attemptId, requestId: `practice-delete-${attemptId}`, expectedRevision: state.revision, reason: "discard" };
    try {
      const result = await learners.runPreparationExclusive({ actor, attemptId }, () => learners.endAttempt(input));
      return { ended: Boolean(result?.attempt?.ended), revision: result?.revision };
    } catch (error) {
      // A concurrent learning write moved the revision or ended the attempt;
      // reread once (an ended attempt then returns above).
      if (!["VIBE64_TRAINING_STATE_REVISION_CONFLICT", "VIBE64_TRAINING_ATTEMPT_MISSING"].includes(error.code) || tries >= 2) throw error;
    }
  }
}

function notPractice() {
  return Object.assign(new Error("This is not one of your practice projects."), { code: "vibe64_project_not_practice", statusCode: 404 });
}

async function exists(target) {
  try { await lstat(target); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function withRemovalLock(key, operation) {
  const previous = removalLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  removalLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (removalLocks.get(key) === queued) removalLocks.delete(key);
  }
}

export { createLocalPracticeProjects, endPracticeAttempt };
