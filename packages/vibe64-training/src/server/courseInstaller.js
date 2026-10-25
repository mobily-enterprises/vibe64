import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { canonicalJson } from "./content.js";
import { courseSchema, id, list, text, validateContent } from "./contentSchemas.js";
import { createTrainingContentInstaller } from "./contentInstaller.js";
import { createInstalledTrainingContent } from "./installedContent.js";
import { trainingFailure } from "./errors.js";

// The official catalogue is the only source this facility reads. Arbitrary
// repositories, local directories and author snapshots stay with the operator
// CLI and the low-level content installer.
const DEFAULT_CATALOGUE_REPOSITORY = "mobily-enterprises/vibe64-learning-catalog";
const CATALOGUE_REPOSITORY = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u;
const TOPIC_REPOSITORY = /^[a-zA-Z0-9_.-]+\/learn-[a-zA-Z0-9_.-]+$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const COURSE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const RELEASE = /^\d+\.\d+\.\d+$/u;
// Scratch sources live beside, never inside, the training installation
// namespace: the content installer refuses a source inside it. Each scratch
// source is exactly one level below it with this name, and each Git run is
// confined (allowedRoots) to one such directory; keep that shape exact.
const SOURCES_DIR = "training-sources";
const SCRATCH_NAME = /^(catalogue|topic)-[a-f0-9-]{36}$/u;
const MAX_FILE_BYTES = 256 * 1024;
// The installed catalogue's own release limit. An update replaces its older
// release; an operator frees other places with `vibe64 training remove-course`.
const MAX_INSTALLED_RELEASES = 16;
const MAX_COURSES = 64;
const CACHE_MS = 60_000;

const version = { type: "integer", required: true, enum: [1] };
const status = { ...text, enum: ["preview", "released"] };
const domainsSchema = createSchema({ schemaVersion: version, domains: list(createSchema({ domainId: id, title: text }), 64) });
const topicsSchema = createSchema({
  schemaVersion: version,
  topics: list(createSchema({
    topicId: id, repository: text,
    // Optional catalogue grouping: the domain this whole topic belongs to.
    domainId: { ...id, required: false },
    releases: list(createSchema({ release: text, status, commit: text, manifestHash: text }), 256)
  }), 256)
});
const lockSchema = createSchema({
  schemaVersion: version, courseId: id, release: text, status,
  topics: list(createSchema({
    topicId: id, release: text, repository: text, commit: text, manifestHash: text,
    lessons: list(createSchema({ code: id, hash: text, status: { ...text, enum: ["draft", "published"] },
      required: { type: "boolean", required: true } }), 64)
  }), 32)
});

function failure(code, message, statusCode, cause) {
  return trainingFailure(code, message, { statusCode, ...(cause ? { cause } : {}) });
}

function compareReleases(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function invalid(message) {
  return failure("VIBE64_TRAINING_AVAILABLE_INVALID",
    `The official course catalogue is invalid: ${message} Nothing was installed. Ask the catalogue maintainers to publish a corrected catalogue.`, 502);
}

function validateLock(course, lock) {
  const value = validateContent(lockSchema, lock, `Course lock ${course.courseId}`);
  if (value.courseId !== course.courseId || value.release !== course.release || value.status !== course.status ||
      value.topics.length !== course.topics.length) {
    throw invalid(`course ${course.courseId} and its lock describe different releases.`);
  }
  value.topics.forEach((topic, index) => {
    const reference = course.topics[index];
    if (topic.topicId !== reference.topicId || topic.release !== reference.release || !TOPIC_REPOSITORY.test(topic.repository) ||
        !COMMIT.test(topic.commit) || !HASH.test(topic.manifestHash) || !RELEASE.test(topic.release) ||
        !topic.lessons.length || topic.lessons.some(lesson => !HASH.test(lesson.hash))) {
      throw invalid(`course ${course.courseId} has an incomplete or non-canonical topic pin: ${topic.topicId}.`);
    }
  });
  return value;
}

// Reads the official catalogue and installs one exact course release through
// the original owners: readPinnedTopic/installTopic verify and publish each
// topic snapshot, and the installed catalogue's enableCourse verifies the lock
// against the installed inventory under its own lock and revision check.
function createTrainingCourseInstaller({ systemRoot, catalogue, repository = "", runCommand = runVibe64Command,
  remoteUrl = slug => `https://github.com/${slug}.git`, now = () => Date.now(), cacheMs = CACHE_MS } = {}) {
  if (typeof systemRoot !== "string" || !path.isAbsolute(systemRoot) || path.resolve(systemRoot) !== systemRoot ||
      systemRoot === path.parse(systemRoot).root) {
    throw new Error("Course installation needs a canonical absolute, non-root server-owned system root.");
  }
  if (typeof catalogue?.readCatalogue !== "function" || typeof catalogue.enableCourse !== "function" ||
      typeof catalogue.removeCourse !== "function") {
    throw new TypeError("Course installation requires the installed catalogue owner.");
  }
  const catalogueRepository = String(repository || "").trim() || DEFAULT_CATALOGUE_REPOSITORY;
  if (!CATALOGUE_REPOSITORY.test(catalogueRepository)) {
    throw new Error("The learning catalogue repository must be a GitHub owner/name.");
  }
  const sourcesRoot = path.join(systemRoot, SOURCES_DIR);
  const installer = createTrainingContentInstaller({ systemRoot });
  const content = createInstalledTrainingContent({ systemRoot });
  let cached = null;
  let reading = null;
  let queue = Promise.resolve();
  const pending = new Map();
  const progress = new Map();

  async function withScratch(kind, operation) {
    try {
      await mkdir(sourcesRoot, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await lstat(sourcesRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory() || await realpath(sourcesRoot) !== sourcesRoot) {
      throw new Error("The training source scratch directory must be a canonical directory, not an alias.");
    }
    const root = path.join(sourcesRoot, `${kind}-${randomUUID()}`);
    if (!SCRATCH_NAME.test(path.basename(root))) throw new Error("Invalid training source scratch name.");
    await mkdir(root, { mode: 0o700 });
    try {
      return await operation(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  async function git(root, args, { maxBuffer = 1024 * 1024, timeout = 120_000 } = {}) {
    // Hooks are disabled; no fetched file is executed. Install runs no authored code.
    const result = await runCommand({
      actor: "daemon", allowedRoots: [root], args: ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "init.defaultBranch=main", ...args],
      command: "git", cwd: root, envPolicy: "project", gitSafeDirectories: [root],
      maxBuffer, mode: "capture", outputEncoding: "utf8", purpose: "source", runtimes: ["git"], timeout
    });
    if (result?.ok !== true) {
      throw failure("VIBE64_TRAINING_SOURCE_FETCH_FAILED", String(result?.error || result?.stderr || "Git could not read the source.").slice(0, 300));
    }
    return String(result.stdout || "");
  }

  async function readAvailableUncached() {
    return withScratch("catalogue", async root => {
      try {
        await git(root, ["init", "-q"]);
        await git(root, ["fetch", "-q", "--depth=1", "--no-tags", remoteUrl(catalogueRepository), "HEAD"]);
      } catch (cause) {
        throw failure("VIBE64_TRAINING_AVAILABLE_UNREACHABLE",
          `The official course catalogue (${catalogueRepository}) could not be downloaded. Check this server's internet access to GitHub and retry. Installed courses are unchanged.`, 503, cause);
      }
      const commit = (await git(root, ["rev-parse", "FETCH_HEAD"])).trim();
      if (!COMMIT.test(commit)) throw invalid("its fetched revision is not a commit.");
      const readJson = async file => {
        let size;
        try {
          size = Number((await git(root, ["cat-file", "-s", `${commit}:${file}`])).trim());
        } catch {
          throw invalid(`${file} is missing.`);
        }
        if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) throw invalid(`${file} exceeds its ${MAX_FILE_BYTES}-byte limit.`);
        try {
          return JSON.parse(await git(root, ["cat-file", "blob", `${commit}:${file}`], { maxBuffer: MAX_FILE_BYTES * 2 }));
        } catch {
          throw invalid(`${file} is not valid JSON.`);
        }
      };
      let domains, topics;
      try {
        domains = validateContent(domainsSchema, await readJson("domains.json"), "domains.json");
        topics = validateContent(topicsSchema, await readJson("topics.json"), "topics.json");
      } catch (error) {
        throw error.code ? error : invalid(error.message);
      }
      const domainIds = new Set(domains.domains.map(domain => domain.domainId));
      if (domainIds.size !== domains.domains.length) throw invalid("domains.json repeats a domain.");
      const topicDomains = new Map();
      for (const topic of topics.topics) {
        if (topicDomains.has(topic.topicId)) throw invalid(`topics.json repeats topic ${topic.topicId}.`);
        if (topic.domainId && !domainIds.has(topic.domainId)) throw invalid(`topic ${topic.topicId} names an unknown domain.`);
        topicDomains.set(topic.topicId, topic.domainId || null);
      }
      const entries = (await git(root, ["ls-tree", "-z", commit, "courses/"])).split("\0").filter(Boolean);
      if (entries.length > MAX_COURSES) throw invalid(`it lists more than ${MAX_COURSES} courses.`);
      const courses = [];
      const seen = new Set();
      for (const entry of entries) {
        const match = /^040000 tree [a-f0-9]{40,64}\tcourses\/([^/]+)$/u.exec(entry);
        if (!match || !COURSE_ID.test(match[1])) throw invalid(`courses/ contains an unexpected entry.`);
        let course, lock;
        try {
          course = validateContent(courseSchema, await readJson(`courses/${match[1]}/course.json`), `Course ${match[1]}`);
          if (course.courseId !== match[1] || !RELEASE.test(course.release) || !course.topics.length) {
            throw invalid(`course ${match[1]} needs its directory ID, an exact release and at least one topic.`);
          }
          lock = validateLock(course, await readJson(`courses/${match[1]}/course.lock.json`));
        } catch (error) {
          throw error.code ? error : invalid(error.message);
        }
        const key = `${course.courseId}@${course.release}`;
        if (seen.has(key)) throw invalid(`course ${key} is listed twice.`);
        seen.add(key);
        // A course is listed under its first topic's declared domain.
        courses.push({ course, lock, domainId: lock.topics.map(topic => topicDomains.get(topic.topicId)).find(Boolean) || null });
      }
      return { repository: catalogueRepository, commit, domains: domains.domains, courses };
    });
  }

  async function readAvailable({ fresh = false } = {}) {
    if (!fresh && cached && now() - cached.readAt < cacheMs) return cached.value;
    if (!reading) {
      reading = readAvailableUncached().then(value => {
        cached = { readAt: now(), value };
        return value;
      }).finally(() => { reading = null; });
    }
    return reading;
  }

  // The catalogue entry is the exact descriptor/lock pair for enableCourse.
  function installState(installed, { course, lock }) {
    const entry = installed.courses.find(value => value.course.courseId === course.courseId && value.course.release === course.release);
    if (!entry) return "not-installed";
    if (canonicalJson(entry.course) !== canonicalJson(course) || canonicalJson(entry.lock) !== canonicalJson(lock)) return "conflict";
    return entry.enabled ? "enabled" : "disabled";
  }

  async function listAvailable() {
    const available = await readAvailable();
    const installed = await catalogue.readCatalogue();
    return {
      repository: available.repository, commit: available.commit,
      domains: available.domains.map(domain => ({ domainId: domain.domainId, title: domain.title })),
      courses: available.courses.map(({ course, lock, domainId }) => ({
        courseId: course.courseId, release: course.release, title: course.title, status: course.status, domainId,
        topics: course.topics.map(topic => ({ topicId: topic.topicId, release: topic.release })),
        lessonCount: lock.topics.reduce((total, topic) => total + topic.lessons.length, 0),
        installed: installState(installed, { course, lock }),
        otherReleases: installed.courses.filter(entry => entry.course.courseId === course.courseId && entry.course.release !== course.release)
          .map(entry => entry.course.release),
        // An update is this newer catalogue release of an already installed course.
        updateFrom: installed.courses.filter(entry => entry.course.courseId === course.courseId)
          .map(entry => entry.course.release).sort(compareReleases).at(-1) || null,
        installing: progress.get(`${course.courseId}@${course.release}`) || null
      })).map(course => ({ ...course,
        updateFrom: course.updateFrom && compareReleases(course.updateFrom, course.release) < 0 ? course.updateFrom : null }))
    };
  }

  async function enable(course, lock) {
    for (let attempt = 0; ; attempt += 1) {
      const { revision } = await catalogue.readCatalogue();
      try {
        return await catalogue.enableCourse({ course, lock, expectedRevision: revision });
      } catch (error) {
        // Another writer changed the catalogue between the read and the lock:
        // retry once against a fresh revision, never blindly overwrite.
        if (attempt > 0 || error.code !== "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT") throw error;
      }
    }
  }

  // After a newer release is enabled, older releases of the same course are
  // removed from the catalogue, freeing their places. Saved attempts keep their
  // pinned lesson content and still resume; only new starts use the newer one.
  async function retireOlderReleases(course) {
    const retired = [];
    for (let attempt = 0; ; attempt += 1) {
      const current = await catalogue.readCatalogue();
      const older = current.courses.find(entry => entry.course.courseId === course.courseId &&
        compareReleases(entry.course.release, course.release) < 0);
      if (!older) return retired;
      try {
        await catalogue.removeCourse({ courseId: course.courseId, release: older.course.release, expectedRevision: current.revision });
        retired.push(older.course.release);
        attempt = -1;
      } catch (error) {
        if (attempt > 0 || error.code !== "VIBE64_TRAINING_CATALOGUE_REVISION_CONFLICT") throw error;
      }
    }
  }

  async function installExact({ courseId, release }) {
    const key = `${courseId}@${release}`;
    const report = value => progress.set(key, { ...value });
    try {
      report({ phase: "catalogue", topicsDone: 0, topicsTotal: 0 });
      const available = await readAvailable({ fresh: true });
      const selected = available.courses.find(entry => entry.course.courseId === courseId && entry.course.release === release);
      if (!selected) {
        throw failure("VIBE64_TRAINING_COURSE_NOT_AVAILABLE",
          `Course ${key} is not in the official catalogue. Refresh the catalogue and choose a listed course.`, 404);
      }
      const { course, lock } = selected;
      const installed = await catalogue.readCatalogue();
      const state = installState(installed, selected);
      if (state === "enabled") {
        // A repeated update finishes retiring older releases if that step was interrupted.
        const retired = await retireOlderReleases(course);
        return { changed: retired.length > 0, course, retired, catalogueCommit: available.commit };
      }
      if (state === "conflict") {
        throw failure("VIBE64_TRAINING_COURSE_RELEASE_CONFLICT",
          `This server already has a different course ${key}. Installed releases are immutable; ask the owner to inspect it.`, 409);
      }
      // Installing never re-enables a disabled release, for anyone: that stays
      // the operator's deliberate `vibe64 training enable-course`.
      if (state === "disabled") {
        throw failure("VIBE64_TRAINING_COURSE_DISABLED",
          `Course ${key} was disabled on this server, and installing does not enable it again. Only the server's operator can enable it again. Nothing was changed.`, 409);
      }
      if (state === "not-installed" && installed.courses.length >= MAX_INSTALLED_RELEASES) {
        throw failure("VIBE64_TRAINING_COURSE_LIMIT",
          `This server already keeps ${MAX_INSTALLED_RELEASES} installed course releases, its limit, so ${key} cannot be added. The server's operator can free a place by removing a release; saved lessons keep their content. Nothing was changed.`, 409);
      }
      const total = lock.topics.length;
      for (const [index, topic] of lock.topics.entries()) {
        const pin = { schemaVersion: 1, topicId: topic.topicId, release: topic.release, repository: topic.repository,
          commit: topic.commit, topicHash: topic.manifestHash };
        report({ phase: "topic", topicsDone: index, topicsTotal: total, topicId: topic.topicId });
        let present = false;
        try {
          present = canonicalJson((await content.readTopic(pin)).pin) === canonicalJson(pin);
        } catch {
          present = false;
        }
        if (present) continue;
        await withScratch("topic", async sourceRoot => {
          try {
            await git(sourceRoot, ["init", "-q"]);
            await git(sourceRoot, ["fetch", "-q", "--depth=1", "--no-tags", remoteUrl(topic.repository), topic.commit], { timeout: 300_000 });
            await git(sourceRoot, ["checkout", "-q", "--detach", topic.commit]);
          } catch (cause) {
            throw failure("VIBE64_TRAINING_TOPIC_UNREACHABLE",
              `Topic ${topic.topicId} could not be downloaded from ${topic.repository} at its pinned commit. Check this server's internet access to GitHub and retry. Nothing was enabled.`, 503, cause);
          }
          if ((await git(sourceRoot, ["rev-parse", "HEAD"])).trim() !== topic.commit) {
            throw failure("VIBE64_TRAINING_TOPIC_COMMIT_MISMATCH", `Topic ${topic.topicId} did not check out its exact pinned commit. Nothing was enabled.`, 502);
          }
          // The original owner re-verifies the clean commit, canonical source,
          // byte hashes and manifest hash against this exact pin.
          await installer.installTopic({ sourceRoot, pin });
        });
      }
      report({ phase: "enable", topicsDone: total, topicsTotal: total });
      const result = await enable(course, lock);
      const retired = await retireOlderReleases(course);
      const revision = retired.length ? (await catalogue.readCatalogue()).revision : result.revision;
      return { changed: result.changed || retired.length > 0, course, retired, catalogueCommit: available.commit, revision };
    } finally {
      progress.delete(key);
    }
  }

  function installCourse({ courseId, release } = {}) {
    if (typeof courseId !== "string" || !COURSE_ID.test(courseId) || typeof release !== "string" || !RELEASE.test(release)) {
      return Promise.reject(failure("VIBE64_TRAINING_COURSE_INVALID", "Choose an exact course ID and three-part release.", 400));
    }
    const key = `${courseId}@${release}`;
    if (pending.has(key)) return pending.get(key);
    // One install at a time: topics shared between courses never race their
    // per-pin installation lock, and repeated clicks share one operation.
    if (!progress.has(key)) progress.set(key, { phase: "queued", topicsDone: 0, topicsTotal: 0 });
    const operation = queue.then(() => installExact({ courseId, release }));
    queue = operation.catch(() => null);
    const shared = operation.finally(() => { pending.delete(key); });
    pending.set(key, shared);
    return shared;
  }

  return Object.freeze({ repository: catalogueRepository, readAvailable, listAvailable, installCourse });
}

export { DEFAULT_CATALOGUE_REPOSITORY, createTrainingCourseInstaller };
