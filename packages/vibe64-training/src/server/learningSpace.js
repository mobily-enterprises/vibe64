import { lstat, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { practiceIdFromSlug, practiceSlug } from "@local/vibe64-core/server/learningSpace";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { attemptPracticeId, learnerIdentity } from "./learnerState.js";

const MAX_ARCHIVES = 20;
const AUTHOR_PREVIEW_COURSE = "author-preview";
const ARCHIVE_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z_.-]{0,127}$/u;

// The learner's practice projects in the learning space (Learning v2 Rev 3
// R1, R6): listing, archive, removal and archived-bundle deletion. Admission
// and paths are core's (runWithPracticeProjectScope); the archive lifecycle
// and the light delete are the shared project archive service, Online's
// (trainingHost.projectArchive) or a standalone one. This owner adds only what
// the archiver must not know: that the project is this learner's, that its
// in-progress attempt ends (reason `discard`) inside the archiver's lock after
// every refusal (its `beforeRemove` step) and its code ledger goes, and the
// learner's archive root with `practice.json` beside each bundle.
function createTrainingLearningSpace({ learners, content, projectContext, projectArchive, systemRoot = projectContext?.systemRoot,
  removePath = rm } = {}) {
  if (typeof learners?.readState !== "function" || typeof learners?.endAttempt !== "function" ||
      typeof learners?.forgetPracticeLedger !== "function" || typeof content?.readLesson !== "function" ||
      typeof projectContext?.runWithPracticeProjectScope !== "function" ||
      typeof projectContext?.listLearningSpaceProjects !== "function" || typeof projectContext?.readLearningSpaceProject !== "function" ||
      typeof projectArchive?.archiveProject !== "function" || typeof projectArchive?.removeProject !== "function" || !systemRoot) {
    throw new TypeError("The learning space requires the learner, content, Project context and project archive owners.");
  }
  const archivesRoot = path.join(systemRoot, "training", "practice-archives");

  const learnerArchiveRoot = actor => path.join(archivesRoot, learnerIdentity(actor).key);

  // This learner's practice project, or null (none, or another learner's).
  async function findRecord(actor, practiceId) {
    const record = await projectContext.readLearningSpaceProject(practiceSlug(practiceId));
    return record?.learnerKey === learnerIdentity(actor).key ? record : null;
  }

  async function ownRecord(actor, practiceId) {
    const record = await findRecord(actor, practiceId);
    if (!record) {
      throw Object.assign(new Error("This is not one of your practice projects."), { code: "VIBE64_TRAINING_PRACTICE_MISSING", statusCode: 404 });
    }
    return record;
  }

  // A deletion marker stays visible here so a delete can resume it.
  // (practice.open and Continue lesson treat such a project as gone.)
  const inScope = (actor, record, operation) => projectContext.runWithPracticeProjectScope({
    actor, training: record.training, access: "write", allowDeleting: true }, operation);

  async function lessonTitle(pin) {
    try {
      return (await content.readLesson({ ...pin.topic, lessonCode: pin.lesson.code, lessonHash: pin.lesson.hash })).lesson.title;
    } catch {
      return pin.lesson.code;
    }
  }

  const lessonView = async pin => ({ code: pin.lesson.code, title: await lessonTitle(pin) });

  // An archived practice project's `practice.json`, or null when it is
  // missing or damaged (that entry is left out, never the whole list).
  async function readPractice(directory) {
    let practice;
    try { practice = JSON.parse(await readFile(path.join(directory, "practice.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
    const { pin } = practice || {};
    const valid = typeof practice?.practiceId === "string" && typeof practice.archivedAt === "string" &&
      Number.isFinite(Date.parse(practice.archivedAt)) && typeof pin?.lesson?.code === "string" &&
      typeof pin.lesson.hash === "string" && pin.topic && typeof pin.topic === "object";
    return valid ? practice : null;
  }

  async function readArchived(actor, live) {
    const root = learnerArchiveRoot(actor);
    const archived = [];
    for (const entry of await readdir(root, { withFileTypes: true }).catch(missingAsEmpty)) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(root, entry.name);
      const practice = await readPractice(directory);
      // Written before archiving: while the project still exists it is not archived.
      if (!practice || practiceSlug(practice.practiceId) !== entry.name || live.has(practice.practiceId)) continue;
      for (const bundle of await bundlesIn(directory)) {
        archived.push({ practiceId: practice.practiceId, archiveId: bundle, lesson: await lessonView(practice.pin),
          archivedAt: practice.archivedAt });
      }
    }
    return archived.sort((left, right) => right.archivedAt.localeCompare(left.archivedAt));
  }

  async function list(actor) {
    const state = await learners.readState({ actor, includeCompletion: true });
    const active = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    const completed = new Set((state.lessonCompletions || []).filter(value => value.completed)
      .map(value => `${value.lessonCode}\0${value.lessonHash}`));
    const projects = [];
    const live = new Set();
    for (const record of await projectContext.listLearningSpaceProjects({ learnerKey: learnerIdentity(actor).key })) {
      live.add(record.practiceId);
      const { pin } = record.training;
      if (pin.course.courseId === AUTHOR_PREVIEW_COURSE) continue;
      const status = record.deleting ? "deleting"
        : active && attemptPracticeId(active) === record.practiceId ? "in-progress"
          : completed.has(`${pin.lesson.code}\0${pin.lesson.hash}`) ? "finished" : "not-finished";
      projects.push({ practiceId: record.practiceId, slug: record.slug, lesson: await lessonView(pin), status });
    }
    return { projects, archived: await readArchived(actor, live) };
  }

  async function exists({ actor, practiceId } = {}) {
    return Boolean(await findRecord(actor, practiceId));
  }

  // Ends the learner's in-progress attempt on this practice project (reason
  // `discard`), as lesson.end does: the preparation barrier, then the typed
  // retirement. Idempotent: no attempt in progress there is nothing to end,
  // and the stable request ID replays a confirmed end.
  async function endAttemptOn(actor, practiceId) {
    for (let tries = 1; ; tries++) {
      const state = await learners.readState({ actor });
      const attempt = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
      if (!attempt || attemptPracticeId(attempt) !== practiceId) return false;
      const { attemptId } = attempt;
      try {
        await learners.runPreparationExclusive({ actor, attemptId }, () => learners.endAttempt({ actor, attemptId,
          requestId: `practice-end-${attemptId}`, expectedRevision: state.revision, reason: "discard" }));
        return true;
      } catch (error) {
        // A concurrent learning write moved the revision or ended the attempt.
        if (!["VIBE64_TRAINING_STATE_REVISION_CONFLICT", "VIBE64_TRAINING_ATTEMPT_MISSING"].includes(error.code) || tries >= 2) throw error;
      }
    }
  }

  // Runs one archiver removal whose `beforeRemove` step ends the attempt: the
  // archiver calls it under its per-slug lock after every refusal (pinned
  // session, storage headroom), so a refused archive or delete changes
  // nothing. A failure after the attempt ended carries `ended: true`.
  async function removing(actor, record, run) {
    let ended = false;
    const endAttempt = async () => { ended = await endAttemptOn(actor, record.practiceId) || ended; };
    try {
      return { ...await run(endAttempt), ended };
    } catch (error) {
      if (ended) error.ended = true;
      throw error;
    }
  }

  // Only a folder holding a bundle is an archive; a stray `practice.json`
  // from an archive that stopped before its bundle never uses up a slot.
  async function archiveCount(actor) {
    let count = 0;
    const root = learnerArchiveRoot(actor);
    for (const entry of await readdir(root, { withFileTypes: true }).catch(missingAsEmpty)) {
      if (entry.isDirectory() && (await bundlesIn(path.join(root, entry.name))).length) count++;
    }
    return count;
  }

  async function archive({ actor, practiceId } = {}) {
    const record = await ownRecord(actor, practiceId);
    const archiveRoot = learnerArchiveRoot(actor);
    const projectArchiveRoot = path.join(archiveRoot, record.slug);
    // A resumed archive already holds its (partial) bundle and its slot.
    const resumed = (await bundlesIn(projectArchiveRoot)).length > 0;
    if (!resumed && await archiveCount(actor) >= MAX_ARCHIVES) {
      throw Object.assign(new Error(`You have ${MAX_ARCHIVES} archived practice projects. Delete one in Practice → Archived first. Nothing was archived.`), {
        code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_LIMIT", statusCode: 409 });
    }
    return inScope(actor, record, () => removing(actor, record, async endAttempt => {
      const archived = await projectArchive.archiveProject({ slug: record.slug, archiveRoot, checkHeadroom: true,
        async beforeRemove() {
          // Under the lock, after the refusals: a resumed archive keeps its record.
          if (!(await bundlesIn(projectArchiveRoot)).length || !await readPractice(projectArchiveRoot)) {
            await writeJsonFileAtomic(path.join(projectArchiveRoot, "practice.json"), {
              practiceId, learnerKey: record.learnerKey, pin: record.training.pin, archivedAt: new Date().toISOString()
            }, { directoryMode: 0o700, fileMode: 0o600 });
          }
          await endAttempt();
        } });
      await learners.forgetPracticeLedger({ actor, practiceId });
      return { ok: true, practiceId, slug: record.slug, archiveId: path.basename(archived.bundlePath) };
    }));
  }

  // The light delete also finishes an archive that stopped part-way: its
  // partial bundle and `practice.json` go with the project.
  async function remove({ actor, practiceId } = {}) {
    const record = await ownRecord(actor, practiceId);
    return inScope(actor, record, () => removing(actor, record, async endAttempt => {
      const removed = await projectArchive.removeProject({ slug: record.slug, beforeRemove: endAttempt });
      await removePath(path.join(learnerArchiveRoot(actor), record.slug), { recursive: true, force: true });
      await learners.forgetPracticeLedger({ actor, practiceId });
      return { ok: true, practiceId, slug: record.slug, removed: removed?.removed !== false };
    }));
  }

  // Removes one archived bundle of this learner, and the project's archive
  // directory (with its practice.json) once no bundle remains.
  async function deleteArchive({ actor, practiceId, archiveId } = {}) {
    const slug = practiceSlug(practiceId);
    if (!practiceIdFromSlug(slug) || !ARCHIVE_ID_PATTERN.test(String(archiveId || ""))) throw archiveMissing();
    const directory = path.join(learnerArchiveRoot(actor), slug);
    const bundle = path.join(directory, archiveId);
    const info = await lstat(bundle).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info?.isDirectory()) throw archiveMissing();
    await removePath(bundle, { recursive: true, force: true });
    if (!(await bundlesIn(directory)).length) {
      await removePath(directory, { recursive: true, force: true });
    }
    return { ok: true, practiceId, archiveId, removed: true };
  }

  return Object.freeze({ list, exists, archive, remove, deleteArchive });
}

function archiveMissing() {
  return Object.assign(new Error("This archived practice project is not in your archive."), {
    code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING", statusCode: 404 });
}

function missingAsEmpty(error) {
  if (error.code === "ENOENT") return [];
  throw error;
}

async function bundlesIn(directory) {
  return (await readdir(directory, { withFileTypes: true }).catch(missingAsEmpty))
    .filter(value => value.isDirectory()).map(value => value.name);
}

export { createTrainingLearningSpace, MAX_ARCHIVES };
