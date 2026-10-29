import { lstat, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { practiceSlug } from "@local/vibe64-core/server/learningSpace";
import { learnThreadFile, releaseLearnThread } from "@local/vibe64-core/server/learnThreads";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { learnerIdentity } from "./learnerState.js";
import { pinnedLessonKey } from "./installedContent.js";

const MAX_ARCHIVES = 20;
// Archives keep their record and conversation; only the newest few keep their
// practice project, the one part that grows with the learner's work.
const KEPT_ARCHIVED_PROJECTS = 3;
const AUTHOR_PREVIEW_COURSE = "author-preview";
const ARCHIVE_REASONS = Object.freeze(["finished", "archived"]);
const PRIVATE = Object.freeze({ directoryMode: 0o700, fileMode: 0o600 });
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

// The attempt lifecycle in the learning space (Learning v2 Rev 4 H4/H5).
// An attempt is the parent of its practice project (training-<attemptId>,
// when the lesson has one), its step results and its teacher conversation.
// closeAttempt is the one implementation behind finish, restart,
// start-with-archive and delete. Archiving keeps one bundle per attempt:
//   <sys>/training/practice-archives/<learnerKey>/<attemptId>/
//     attempt.json        the attempt record with its step results
//     conversation.json   the teacher thread, moved out of Colleague's store
//     project/            the shared project archive (only with a project)
// Admission and paths are core's (runWithPracticeProjectScope); the project
// archive lifecycle is the shared archive service, the host's
// (trainingHost.projectArchive) or a standalone one. A host may keep a
// different number of archived practice projects (keptArchivedProjects).
function createTrainingLearningSpace({ learners, content, projectContext, projectArchive, systemRoot = projectContext?.systemRoot,
  keptArchivedProjects = KEPT_ARCHIVED_PROJECTS, removePath = rm } = {}) {
  if (typeof learners?.readState !== "function" || typeof learners?.endAttempt !== "function" ||
      typeof learners?.readAttemptRecord !== "function" || typeof learners?.runPreparationExclusive !== "function" ||
      typeof content?.readLesson !== "function" || typeof projectContext?.runWithPracticeProjectScope !== "function" ||
      typeof projectContext?.readLearningSpaceProject !== "function" ||
      typeof projectArchive?.archiveProject !== "function" || typeof projectArchive?.removeProject !== "function" || !systemRoot) {
    throw new TypeError("The learning space requires the learner, content, Project context and project archive owners.");
  }
  if (!Number.isSafeInteger(keptArchivedProjects) || keptArchivedProjects < 0) {
    throw new TypeError("The learning space keeps a whole, non-negative number of archived practice projects.");
  }
  const archivesRoot = path.join(systemRoot, "training", "practice-archives");
  const learnerArchiveRoot = actor => path.join(archivesRoot, learnerIdentity(actor).key);
  const bundleRoot = (actor, attemptId) => path.join(learnerArchiveRoot(actor), attemptId);

  // This learner's practice project of an attempt, or null (none, or another learner's).
  async function findRecord(actor, attemptId) {
    const record = await projectContext.readLearningSpaceProject(practiceSlug(attemptId));
    return record?.learnerKey === learnerIdentity(actor).key ? record : null;
  }

  // An archived attempt's `attempt.json`, or null when it is missing or
  // damaged (that entry is left out, never the whole list).
  async function readBundle(directory, attemptId) {
    let record;
    try { record = JSON.parse(await readFile(path.join(directory, "attempt.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
    const valid = record?.schemaVersion === 1 && record.attemptId === attemptId && ARCHIVE_REASONS.includes(record.reason) &&
      typeof record.archivedAt === "string" && Number.isFinite(Date.parse(record.archivedAt)) &&
      typeof record.pin?.lesson?.code === "string" && typeof record.lessonTitle === "string";
    return valid ? record : null;
  }

  // The lesson in progress (with its practice project, if any) and the
  // archived attempts, newest first.
  async function list(actor) {
    const state = await learners.readState({ actor });
    const active = state.progress.attempts.find(value => value.attemptId === state.progress.activeAttemptId);
    let current = null;
    if (active && active.pin.course.courseId !== AUTHOR_PREVIEW_COURSE) {
      const record = active.projectSlug ? await findRecord(actor, active.attemptId) : null;
      current = { attemptId: active.attemptId, lesson: { code: active.pin.lesson.code, title: await lessonTitle(content, active.pin) },
        ...(record ? { slug: record.slug } : {}), status: record?.deleting ? "deleting" : "in-progress" };
    }
    const archived = (await readArchives(actor, active?.attemptId)).map(({ record, hasProject }) => ({ attemptId: record.attemptId,
      lesson: { code: record.pin.lesson.code, title: record.lessonTitle }, reason: record.reason, archivedAt: record.archivedAt,
      hasProject }));
    return { current, archived };
  }

  // This learner's archived attempts, newest first, without the attempt in
  // progress: a close that stopped part-way keeps it in progress, not archived.
  async function readArchives(actor, activeAttemptId) {
    const archives = [];
    const root = learnerArchiveRoot(actor);
    for (const entry of await readdir(root, { withFileTypes: true }).catch(missingAsEmpty)) {
      if (!entry.isDirectory() || entry.name === activeAttemptId) continue;
      const directory = path.join(root, entry.name);
      const record = await readBundle(directory, entry.name);
      if (!record) continue;
      archives.push({ directory, record, hasProject: (await readdir(path.join(directory, "project")).catch(missingAsEmpty)).length > 0 });
    }
    return archives.sort((left, right) => right.record.archivedAt.localeCompare(left.record.archivedAt));
  }

  // The disk limit: past the newest keptArchivedProjects, an archive loses its
  // practice project and keeps its record and conversation. Only this learner's
  // archive root is touched, never the lesson in progress or a working project.
  async function pruneArchivedProjects(actor) {
    const { progress } = await learners.readState({ actor });
    const withProject = (await readArchives(actor, progress.activeAttemptId)).filter(archive => archive.hasProject);
    for (const { directory } of withProject.slice(keptArchivedProjects)) {
      await removePath(path.join(directory, "project"), { recursive: true, force: true });
    }
  }

  async function exists({ actor, attemptId } = {}) {
    return Boolean(await findRecord(actor, attemptId));
  }

  // Only a folder holding a valid attempt record is an archive.
  async function archiveCount(actor) {
    const root = learnerArchiveRoot(actor);
    let count = 0;
    for (const entry of await readdir(root, { withFileTypes: true }).catch(missingAsEmpty)) {
      if (entry.isDirectory() && await readBundle(path.join(root, entry.name), entry.name)) count++;
    }
    return count;
  }

  // Step 1, under the archiver's lock after its refusals: the attempt record
  // with its step results. A resumed close keeps the record it wrote first.
  async function writeAttemptRecord(actor, attemptId, reason) {
    const directory = bundleRoot(actor, attemptId);
    if (await readBundle(directory, attemptId)) return;
    const { attempt, stepProgress, lessonTitle: title } = await learners.readAttemptRecord({ actor, attemptId });
    await writeJsonFileAtomic(path.join(directory, "attempt.json"), {
      schemaVersion: 1, attemptId, learnerKey: learnerIdentity(actor).key, pin: attempt.pin, lessonTitle: title,
      reason, createdAt: attempt.createdAt, archivedAt: new Date().toISOString(), stepProgress
    }, PRIVATE);
  }

  // Step 2: the learner store ends the attempt (forgetting its code ledger,
  // C1), inside the close's preparation barrier. The stable request replays.
  async function endAttempt(actor, attemptId, reason) {
    for (let tries = 1; ; tries++) {
      const state = await learners.readState({ actor });
      try {
        await learners.endAttempt({ actor, attemptId, requestId: `close-${attemptId}`, expectedRevision: state.revision, reason });
        return;
      } catch (error) {
        // A concurrent learning write (a step result) moved the revision.
        if (error.code !== "VIBE64_TRAINING_STATE_REVISION_CONFLICT" || tries >= 2) throw error;
      }
    }
  }

  // Step 3, once the attempt has ended, so Colleague no longer resolves its
  // thread: Colleague releases the thread's live runtime, then its file moves
  // into the bundle (archive) or goes (delete). A thread already moved is done.
  async function closeThread(actor, attemptId, archive) {
    const learnerKey = learnerIdentity(actor).key;
    await releaseLearnThread({ learnerKey, attemptId });
    const file = learnThreadFile({ systemRoot, learnerKey, attemptId });
    if (!archive) return removePath(file, { force: true });
    if (!await lstat(file).then(() => true, missingAsFalse)) return;
    const destination = path.join(bundleRoot(actor, attemptId), "conversation.json");
    await mkdir(path.dirname(destination), { recursive: true, mode: PRIVATE.directoryMode });
    await rename(file, destination);
  }

  // Finish (reason finished), restart and start-with-archive (archived) keep a
  // bundle; delete (deleted) keeps nothing. The whole close until the attempt
  // ends holds the preparation barrier, so no preparation can recreate the
  // practice project meanwhile. The project goes first, through the archiver,
  // so its refusals (a pinned session, storage) change nothing, and a removal
  // that stops leaves the attempt in progress with its project marked
  // deleting. Repeating the close resumes it, keyed by attemptId; for an
  // attempt that has already ended it only finishes the thread step. Every
  // archiving close ends with the disk limit, so a repeat also finishes it.
  async function closeAttempt({ actor, attemptId, archive, reason } = {}) {
    if (archive ? !ARCHIVE_REASONS.includes(reason) : reason !== "deleted") {
      throw new TypeError("Close an attempt as finished or archived with an archive, or as deleted without one.");
    }
    const attempt = await readAttempt(actor, attemptId);
    if (!attempt) {
      throw Object.assign(new Error("This is not one of your lessons. Nothing was changed."), {
        code: "VIBE64_TRAINING_ATTEMPT_MISSING", statusCode: 404 });
    }
    let closed = false;
    if (!attempt.ended) {
      const directory = bundleRoot(actor, attemptId);
      // A resumed archive already holds its (partial) bundle and its slot.
      if (archive && !await isDirectory(directory) && await archiveCount(actor) >= MAX_ARCHIVES) {
        throw Object.assign(new Error(`You have ${MAX_ARCHIVES} archived lessons. Delete one in Courses → Archived first. Nothing was changed.`), {
          code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_LIMIT", statusCode: 409 });
      }
      try {
        await learners.runPreparationExclusive({ actor, attemptId, closing: true }, async () => {
          const record = attempt.projectSlug ? await findRecord(actor, attemptId) : null;
          if (record) {
            await projectContext.runWithPracticeProjectScope({ actor, training: record.training, access: "write", allowDeleting: true },
              () => archive
                ? projectArchive.archiveProject({ slug: record.slug, archiveRoot: path.join(directory, "project"), checkHeadroom: true,
                  beforeRemove: () => writeAttemptRecord(actor, attemptId, reason) })
                : projectArchive.removeProject({ slug: record.slug }));
          } else if (archive) {
            await writeAttemptRecord(actor, attemptId, reason);
          }
          // A delete also takes the partial bundle of an archive that stopped part-way.
          if (!archive) await removePath(directory, { recursive: true, force: true });
          await endAttempt(actor, attemptId, reason);
        });
        closed = true;
      } catch (error) {
        // A concurrent close of the same attempt ended it first.
        if (error.code !== "VIBE64_TRAINING_ATTEMPT_MISSING" || !(await readAttempt(actor, attemptId))?.ended) throw error;
      }
    }
    const { ended } = await readAttempt(actor, attemptId);
    await closeThread(actor, attemptId, ended.reason !== "deleted");
    if (ended.reason !== "deleted") await pruneArchivedProjects(actor);
    return { ok: true, attemptId, closed };
  }

  async function readAttempt(actor, attemptId) {
    return (await learners.readState({ actor })).progress.attempts.find(value => value.attemptId === attemptId) || null;
  }

  // Removes one archived attempt bundle of this learner.
  async function deleteArchive({ actor, attemptId } = {}) {
    const state = await learners.readState({ actor });
    const archived = UUID_PATTERN.test(String(attemptId || "")) && attemptId !== state.progress.activeAttemptId &&
      await isDirectory(bundleRoot(actor, attemptId));
    if (!archived) {
      throw Object.assign(new Error("This archived lesson is not in your archive."), {
        code: "VIBE64_TRAINING_PRACTICE_ARCHIVE_MISSING", statusCode: 404 });
    }
    await removePath(bundleRoot(actor, attemptId), { recursive: true, force: true });
    return { ok: true, attemptId, removed: true };
  }

  return Object.freeze({ list, exists, closeAttempt, deleteArchive });
}

// The pinned lesson's title, or its code when its content cannot be read.
// The title comes from the lesson's identity (its descriptor), so a lesson
// this Vibe64 can no longer teach is still named by its title.
async function lessonTitle(content, pin) {
  const read = typeof content.readAdmissionIdentity === "function" ? content.readAdmissionIdentity : content.readLesson;
  try {
    return (await read(pinnedLessonKey(pin))).lesson.title;
  } catch {
    return pin.lesson.code;
  }
}

async function isDirectory(directory) {
  return lstat(directory).then(info => info.isDirectory(), missingAsFalse);
}

function missingAsFalse(error) {
  if (error.code === "ENOENT") return false;
  throw error;
}

function missingAsEmpty(error) {
  if (error.code === "ENOENT") return [];
  throw error;
}

export { createTrainingLearningSpace, KEPT_ARCHIVED_PROJECTS, lessonTitle, MAX_ARCHIVES };
