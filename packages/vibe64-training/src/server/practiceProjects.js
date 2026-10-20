import { lstat, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { practiceProjectAttemptId } from "@local/vibe64-core/server/practiceProjects";

const removalLocks = new Map();

// Standalone host facility practiceProjects.remove({ slug, actor }) (with its
// read-only canRemove and exists). It mirrors Online's light deletion (the
// hosted archive lifecycle minus its archive steps): per-slug lock,
// pinned-session refusal, persisted deletion marker with resumable steps,
// runtime close, source and runtime removal. Standalone
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

  async function ownPracticeScope({ slug, actor }) {
    const attemptId = practiceProjectAttemptId(slug);
    if (!attemptId) throw notPractice();
    if (!actor) throw Object.assign(new Error("Log in to Vibe64 before deleting a practice project."), { code: "vibe64_auth_required", statusCode: 401 });
    const saved = await readOwnPracticeScope({ learners, actor, slug, access: "observe" });
    if (!saved) throw notPractice();
    return { attemptId, saved };
  }

  async function remove({ slug, actor } = {}) {
    if (!practiceProjectAttemptId(slug)) throw notPractice();
    return withRemovalLock(slug, async () => {
      const { attemptId, saved } = await ownPracticeScope({ slug, actor });
      return projectContext.runWithPracticeProjectScope({ actor, training: saved.training, access: "write", allowDeleting: true },
        () => removeAdmitted(slug, () => endPracticeAttempt({ learners, actor, attemptId })));
    });
  }

  // Read-only preflight for practice.delete: the refusals remove would make
  // before any side effect (not this learner's practice project, a pinned
  // session). A pin added between preflight and remove is still refused there.
  async function canRemove({ slug, actor } = {}) {
    let scope;
    try { scope = await ownPracticeScope({ slug, actor }); }
    catch (error) {
      if (error.statusCode && error.statusCode < 500) return { ok: false, reason: error.message };
      throw error;
    }
    return projectContext.runWithPracticeProjectScope({ actor, training: scope.saved.training, access: "write", allowDeleting: true },
      async () => {
        const state = await projectContext.readWorkspaceProjectState({ slug });
        if (!Object.keys(state.metadata).length) return { ok: true };
        const pinnedSessionId = await readPinnedSessionId(slug, state);
        return pinnedSessionId ? { ok: false, reason: pinnedMessage(pinnedSessionId) } : { ok: true };
      });
  }

  // Read-only presence check for learning.read and lesson.read: a deleted
  // practice project (no record left) is no longer listed or offered for
  // deletion. A project whose deletion stopped part-way keeps its record (the
  // record is removed last), so it stays listed for the retry. Another
  // learner's slug, or one with no saved attempt behind it, does not exist here.
  // Leftover storage whose ownership no longer matches (scope admission refuses
  // it) is still present: it stays listed so a delete can retry or report why.
  async function exists({ slug, actor } = {}) {
    let scope;
    try { scope = await ownPracticeScope({ slug, actor }); }
    catch (error) {
      if (error.statusCode && error.statusCode < 500) return false;
      throw error;
    }
    try {
      return await projectContext.runWithPracticeProjectScope({ actor, training: scope.saved.training, access: "write", allowDeleting: true },
        async () => Object.keys((await projectContext.readWorkspaceProjectState({ slug })).metadata).length > 0);
    } catch (error) {
      if (error.code === "vibe64_practice_scope_mismatch") return true;
      throw error;
    }
  }

  function readPinnedSessionId(slug, state) {
    return createVibe64SessionStore({
      projectContextRoot: state.projectContextRoot,
      projectRuntimeRoot: state.projectRuntimeRoot,
      projectSessionSourceRoot: projectContext.projectSessionSourceRootForSlug(slug)
    }).readPinnedSessionId();
  }

  async function removeAdmitted(slug, endAttempt) {
    const state = await projectContext.readWorkspaceProjectState({ slug });
    const projectSessionSourceRoot = projectContext.projectSessionSourceRootForSlug(slug);
    if (!Object.keys(state.metadata).length) {
      // The record is removed last; scope admission already refused leftovers.
      return { ok: true, slug, removed: false };
    }
    const pinnedSessionId = await readPinnedSessionId(slug, state);
    if (pinnedSessionId) {
      throw Object.assign(new Error(pinnedMessage(pinnedSessionId)), {
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
        if (await pathExists(root)) {
          throw Object.assign(new Error("Project namespace still exists after deletion."), { code: "vibe64_project_namespace_delete_failed" });
        }
      }
      await markComplete("source-removed");
    }
    if (!steps["state-removal-started"]) await markComplete("state-removal-started");
    await removePath(state.projectRuntimeRoot, { force: true, recursive: true });
    if (await pathExists(state.projectRuntimeRoot)) {
      throw Object.assign(new Error("Project runtime and session state still exists after deletion."), { code: "vibe64_project_state_delete_failed" });
    }
    // The empty per-attempt namespace directory goes too; anything else stays.
    await rmdir(path.dirname(state.projectContextRoot)).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    });
    return { ok: true, slug, removed: true };
  }

  return Object.freeze({ remove, canRemove, exists });
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

function pinnedMessage(sessionId) {
  return `Unpin session ${sessionId} before deleting this practice project.`;
}

function notPractice() {
  return Object.assign(new Error("This is not one of your practice projects."), { code: "vibe64_project_not_practice", statusCode: 404 });
}

async function pathExists(target) {
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

// Ordinary local Project pages open only this person's own saved lesson
// Project; the slug is derived from the attempt and rechecked against it.
// Core grants the admitted scope full write (the learner's own practice
// project is an ordinary project to them).
async function admitLocalPracticeProject({ learners, actor, slug }) {
  if (!practiceProjectAttemptId(slug)) return null;
  const saved = await readOwnPracticeScope({ learners, actor, slug, access: "control", malformedIsForeign: true });
  return saved ? { actor, training: saved.training } : null;
}

// The saved practice scope of `slug` when it is this learner's own practice
// project, else null: another person's (or no) attempt, a lesson without an
// exercise, or a saved scope naming another project. With malformedIsForeign
// an attempt ID the learner store rejects as malformed is not theirs either.
// Every other failure is the store's own and is thrown.
async function readOwnPracticeScope({ learners, actor, slug, access, malformedIsForeign = false }) {
  const attemptId = practiceProjectAttemptId(slug);
  let saved;
  try { saved = await learners.readExerciseProjectScope({ actor, attemptId, access }); }
  catch (error) {
    if (["VIBE64_TRAINING_ATTEMPT_MISSING", "VIBE64_TRAINING_EXERCISE_MISSING"].includes(error.code) ||
        (malformedIsForeign && error.message === "Use the exact saved exercise attempt ID.")) return null;
    throw error;
  }
  return saved.projectSlug === slug ? saved : null;
}

export { admitLocalPracticeProject, createLocalPracticeProjects, endPracticeAttempt, readOwnPracticeScope };
