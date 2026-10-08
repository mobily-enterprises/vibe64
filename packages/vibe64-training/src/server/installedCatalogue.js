import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { tryAcquireExclusiveFileLock } from "@jskit-ai/kernel/server/support";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/projectRecordMetadata";
import { createCourseLock } from "./catalogue.js";
import { canonicalJson } from "./content.js";
import { courseSchema, list, validateContent } from "./contentSchemas.js";
import { createInstalledTrainingContent, validateInstalledTopicPin } from "./installedContent.js";

const MAX_COURSES = 16;
const MAX_BYTES = 1024 * 1024;
const entrySchema = createSchema({
  course: { type: "object", required: true, schema: courseSchema },
  // The original course-lock owner checks the complete identity below.
  lock: { type: "object", required: true },
  enabled: { type: "boolean", required: true }
});
const catalogueSchema = createSchema({
  schemaVersion: { type: "integer", required: true, enum: [1] },
  revision: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER },
  courses: list(entrySchema, MAX_COURSES)
});

function failure(code, message, statusCode, cause) {
  return Object.assign(new Error(message), {
    code,
    ...(statusCode ? { statusCode } : {}),
    ...(cause ? { cause } : {})
  });
}

function requireRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Supply the expected revision from a fresh installed catalogue read.");
  }
}

// The admitted owner selects course/lock together. This internal facility does
// not authenticate objects, fetch sources or expose a browser/assistant action.
function createInstalledTrainingCatalogue({ systemRoot } = {}) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) ||
      path.resolve(systemRoot) !== systemRoot || systemRoot === path.parse(systemRoot).root) {
    throw new Error("Installed catalogue needs a canonical absolute, non-root server-owned system root.");
  }
  const trainingRoot = path.join(systemRoot, "training");
  const cataloguePath = path.join(trainingRoot, "catalogue.json");
  const lockPath = path.join(trainingRoot, "catalogue.lock");
  const installed = createInstalledTrainingContent({ systemRoot });

  async function inspectPaths() {
    const directories = [trainingRoot];
    for (let current = systemRoot; ; current = path.dirname(current)) {
      directories.unshift(current);
      if (current === path.dirname(current)) {
        break;
      }
    }
    let rootExists = false;
    let catalogueStat = null;
    for (const filename of [...directories, cataloguePath, lockPath]) {
      let stat;
      try {
        stat = await lstat(filename);
      } catch (error) {
        if (error.code === "ENOENT") {
          continue;
        }
        throw error;
      }
      const directory = filename !== cataloguePath && filename !== lockPath;
      if (stat.isSymbolicLink() || await realpath(filename) !== filename ||
          (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
        throw new Error("Installed catalogue paths must be canonical directories and unaliased regular files.");
      }
      if (filename === systemRoot) {
        rootExists = true;
      }
      if (filename === cataloguePath) {
        catalogueStat = stat;
      }
      if (filename === lockPath && stat.size !== 0) {
        throw new Error("Installed catalogue lock contains unexplained data. Inspect it; do not unlink it.");
      }
    }
    return { rootExists, catalogueStat };
  }

  async function verifyEntry(entry) {
    const references = entry.lock.topics;
    if (!Array.isArray(references) || references.length !== entry.course.topics.length || references.length > 32) {
      throw new Error("The approved course lock must contain every selected whole topic in order.");
    }
    const resolved = [];
    const lessonTitles = [];
    for (const reference of references) {
      const pin = validateInstalledTopicPin({
        schemaVersion: 1,
        topicId: reference?.topicId,
        release: reference?.release,
        repository: reference?.repository,
        commit: reference?.commit,
        topicHash: reference?.manifestHash
      });
      const topic = await installed.readTopic(pin);
      if (canonicalJson(topic.pin) !== canonicalJson(pin)) {
        throw new Error("Installed topic identity differs from the approved course lock.");
      }
      for (const bundle of topic.bundles) {
        lessonTitles.push({ topicId: pin.topicId, topicRelease: pin.release,
          code: bundle.lesson.code, hash: bundle.hash, title: bundle.lesson.title });
      }
      resolved.push({
        topicId: topic.pin.topicId,
        release: topic.release,
        repository: topic.pin.repository,
        commit: topic.pin.commit,
        topicManifest: topic.topicManifest,
        topicHash: topic.topicHash
      });
    }
    const expected = createCourseLock(entry.course, resolved);
    if (canonicalJson(entry.lock) !== canonicalJson(expected)) {
      throw new Error("The approved course lock differs from the complete installed topic inventory. Regenerate and review its exact release.");
    }
    return lessonTitles;
  }

  async function readCatalogue({ includeLessonTitles = false } = {}) {
    if (typeof includeLessonTitles !== "boolean") {
      throw new TypeError("Lesson title projection requires an explicit Boolean read option.");
    }
    try {
      const { catalogueStat } = await inspectPaths();
      if (!catalogueStat) {
        return { schemaVersion: 1, revision: 0, courses: [] };
      }
      if (catalogueStat.size > MAX_BYTES) {
        throw new Error("Installed catalogue exceeds its 1 MiB limit.");
      }
      const bytes = await readFile(cataloguePath);
      if (bytes.length > MAX_BYTES) {
        throw new Error("Installed catalogue exceeds its 1 MiB limit.");
      }
      const catalogue = validateContent(catalogueSchema, JSON.parse(bytes.toString("utf8")), "Installed catalogue");
      if (catalogue.courses.length ? catalogue.revision < 1 : catalogue.revision !== 0) {
        throw new Error("Installed catalogue revision conflicts with its course inventory.");
      }
      const seen = new Set();
      for (const entry of catalogue.courses) {
        const identity = `${entry.course.courseId}@${entry.course.release}`;
        if (seen.has(identity)) {
          throw new Error("Installed catalogue contains duplicate course releases.");
        }
        seen.add(identity);
        // Disabled snapshots are retained and verified too. A missing/corrupt
        // snapshot fails catalogue admission closed, never triggers a repair.
        const lessonTitles = await verifyEntry(entry);
        // Read-only display metadata is never part of the saved course/lock.
        // All writers retain the original default read result unchanged.
        if (includeLessonTitles) entry.lessonTitles = lessonTitles;
      }
      return catalogue;
    } catch (cause) {
      throw failure("VIBE64_TRAINING_CATALOGUE_INVALID",
        `Installed catalogue is invalid: ${cause.message} Keep existing state and ask the owner to restore the exact approved catalogue or pinned content. No automatic repair was performed.`, null, cause);
    }
  }

  async function acquire() {
    const { rootExists } = await inspectPaths();
    if (!rootExists) {
      throw new Error("Prepare the server-owned system root before changing the catalogue.");
    }
    try {
      await mkdir(trainingRoot, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    await inspectPaths();
    const release = await tryAcquireExclusiveFileLock(lockPath);
    if (!release) {
      throw failure("VIBE64_TRAINING_CATALOGUE_BUSY", "Installed catalogue is being updated. Retry after the current owner operation finishes.", 409);
    }
    return release;
  }

  function checkRevision(catalogue, expectedRevision) {
    if (catalogue.revision !== expectedRevision) {
      throw failure("VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT", "Installed catalogue changed. Read its current revision before deliberately retrying this enablement change.", 409);
    }
  }

  async function save(catalogue, entry) {
    if (catalogue.revision === Number.MAX_SAFE_INTEGER) {
      throw new Error("Installed catalogue reached its revision limit. No change was written.");
    }
    const next = { ...catalogue, revision: catalogue.revision + 1 };
    if (Buffer.byteLength(`${JSON.stringify(next, null, 2)}\n`) > MAX_BYTES) {
      throw new Error("Installed catalogue exceeds its 1 MiB limit. No change was written.");
    }
    try {
      await writeJsonFileAtomic(cataloguePath, next, { directoryMode: 0o700, fileMode: 0o600 });
    } catch (cause) {
      throw failure("VIBE64_TRAINING_CATALOGUE_SAVE_UNCONFIRMED", "Catalogue save was not confirmed; atomic rename may already have succeeded. Read the current catalogue before deliberately retrying. Do not assume the course changed or remained unchanged.", null, cause);
    }
    return { revision: next.revision, entry, changed: true };
  }

  async function enableCourse({ course, lock, expectedRevision } = {}) {
    requireRevision(expectedRevision);
    const entry = structuredClone(validateContent(entrySchema, { course, lock, enabled: true }, "Approved installed course"));
    await readCatalogue();
    await verifyEntry(entry);
    const release = await acquire();
    try {
      const catalogue = await readCatalogue();
      checkRevision(catalogue, expectedRevision);
      await verifyEntry(entry);
      const current = catalogue.courses.find(value => value.course.courseId === entry.course.courseId && value.course.release === entry.course.release);
      if (current) {
        if (canonicalJson(current.course) !== canonicalJson(entry.course) || canonicalJson(current.lock) !== canonicalJson(entry.lock)) {
          throw failure("VIBE64_TRAINING_COURSE_RELEASE_CONFLICT", "This installed course release is immutable. Resume its approved pin or publish and approve a different course release.", 409);
        }
        if (current.enabled) {
          return { revision: catalogue.revision, entry: current, changed: false };
        }
        current.enabled = true;
        return await save(catalogue, current);
      }
      if (catalogue.courses.length >= MAX_COURSES) {
        throw new Error("Installed catalogue reached its 16 course-release limit. No retained release was removed.");
      }
      catalogue.courses.push(entry);
      return await save(catalogue, entry);
    } finally {
      await release();
    }
  }

  async function disableCourse({ courseId, release: courseRelease, expectedRevision } = {}) {
    requireRevision(expectedRevision);
    if (typeof courseId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(courseId) || typeof courseRelease !== "string" || !/^\d+\.\d+\.\d+$/u.test(courseRelease)) {
      throw new Error("Disable an exact installed course ID and three-part release.");
    }
    const before = await readCatalogue();
    if (!before.courses.some(entry => entry.course.courseId === courseId && entry.course.release === courseRelease)) {
      throw failure("VIBE64_TRAINING_COURSE_MISSING", "This course release is not installed in the catalogue. Read the current catalogue before retrying.", 404);
    }
    const unlock = await acquire();
    try {
      const catalogue = await readCatalogue();
      checkRevision(catalogue, expectedRevision);
      const entry = catalogue.courses.find(value => value.course.courseId === courseId && value.course.release === courseRelease);
      if (!entry) {
        throw failure("VIBE64_TRAINING_COURSE_MISSING", "This course release is no longer in the catalogue. Read the current catalogue before retrying.", 404);
      }
      if (!entry.enabled) {
        return { revision: catalogue.revision, entry, changed: false };
      }
      entry.enabled = false;
      return await save(catalogue, entry);
    } finally {
      await unlock();
    }
  }

  return { readCatalogue, enableCourse, disableCourse };
}

export { createInstalledTrainingCatalogue };
