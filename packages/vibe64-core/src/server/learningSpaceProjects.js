import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { isPlainObject, pathExists } from "./core.js";
import {
  PRACTICE_SLUG_PATTERN,
  normalizeProjectTraining,
  practiceIdFromSlug,
  practiceLearnerKey,
  practiceNamespace,
  practiceProjectDeletedError,
  practiceSlug
} from "./learningSpace.js";
import { runWithPracticeProjectContext } from "./practiceContext.js";
import { readProjectRecordMetadata } from "./projectRecordMetadata.js";
import { PROJECT_REPOSITORY_MODE_MANAGED_GIT } from "./projectRepository.js";
import { resolveProjectRecordPath } from "./projectState.js";
import { practiceOwnershipDiffers, readProjectMetadata, resolveCatalogProjectRuntimeRoot } from "./studioProjectRecords.js";

/**
 * The learning space's practice projects: listed, read and run in a learner's
 * practice scope.
 * @param {object} dependencies
 * @param {string} dependencies.learningSpaceRoot
 * @param {boolean} dependencies.learningSpaceRootNamed
 * @param {object} dependencies.practiceOwner
 * @param {string} dependencies.systemRoot
 */
function createLearningSpaceProjects({
  learningSpaceRoot,
  learningSpaceRootNamed,
  practiceOwner,
  systemRoot
}) {
  function learningSpaceStorageRoot() {
    if (!learningSpaceRootNamed && process.env.NODE_TEST_CONTEXT) {
      throw new Error(
        "A test must pass explicitManagedSourceRoot or learningSpace.root; the default learning space is in the real home folder."
      );
    }
    return learningSpaceRoot;
  }

  async function practiceDirectoryExists(directory) {
    let current = path.parse(directory).root;
    for (const part of directory.slice(current.length).split(path.sep)) {
      current = path.join(current, part);
      let info;
      try { info = await lstat(current); }
      catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw Object.assign(
          new Error("Practice storage must contain only real directories; inspect it before retrying."),
          { code: "vibe64_practice_path_unsafe" }
        );
      }
    }
    return true;
  }

  // Each skipped entry warns once per process: listings run on every
  // Projects page load, and the scrap upgrade, not the listing, clears them.
  const warnedSkippedEntries = new Set();

  function skipLearningSpaceEntry(entry, reason) {
    const key = `${entry}: ${reason}`;
    if (!warnedSkippedEntries.has(key)) {
      warnedSkippedEntries.add(key);
      console.warn(`Vibe64 learning space: skipped ${key}`);
    }
    return null;
  }

  /**
   * The learning-space project a practice slug names: its marker is valid,
   * names that practice, and its namespace is a real directory. Null when the
   * space has no such project; an unsafe or invalid one is skipped with a warning.
   * `deleting` reports a deletion marker (a removal that stopped part-way).
   */
  async function readLearningSpaceProject(slug) {
    const practiceId = practiceIdFromSlug(slug);
    if (!practiceId) return null;
    const projectRuntimeRoot = resolveCatalogProjectRuntimeRoot({ slug, systemRoot });
    let metadata;
    try { metadata = await readProjectRecordMetadata(resolveProjectRecordPath({ projectRuntimeRoot })); }
    catch (error) {
      if (error instanceof SyntaxError || error.code === "ENOTDIR") return skipLearningSpaceEntry(slug, "unreadable project record");
      throw error;
    }
    if (!isPlainObject(metadata) || !metadata.training) return null;
    let training;
    try { training = normalizeProjectTraining(metadata.training); }
    catch (error) {
      if (error.code === "vibe64_project_training_invalid") return skipLearningSpaceEntry(slug, "invalid training marker");
      throw error;
    }
    if (training.practiceId !== practiceId || metadata.repository?.mode !== PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
      return skipLearningSpaceEntry(slug, "training marker names another practice project");
    }
    try {
      if (!await practiceDirectoryExists(practiceNamespace(learningSpaceStorageRoot(), training).projectContextRoot)) return null;
    } catch (error) {
      if (error.code === "vibe64_practice_path_unsafe") return skipLearningSpaceEntry(slug, error.message);
      throw error;
    }
    return Object.freeze({
      slug,
      learnerKey: training.learnerKey,
      practiceId,
      training,
      deleting: Boolean(metadata.deletion)
    });
  }

  async function readDirectoryEntries(directory) {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  /**
   * Every practice project in the space (one learner's with learnerKey), as
   * {slug, learnerKey, practiceId, training}. Unsafe or invalid entries are
   * skipped with a warning and never change the listing for the others.
   */
  async function listLearningSpaceProjects({ learnerKey } = {}) {
    const learners = [];
    for (const entry of await readDirectoryEntries(learningSpaceStorageRoot())) {
      if (learnerKey !== undefined && entry.name !== learnerKey) continue;
      if (entry.isDirectory()) learners.push(entry.name);
      else skipLearningSpaceEntry(entry.name, "not a real directory");
    }
    const projects = [];
    for (const learner of learners) {
      for (const practice of await readDirectoryEntries(path.join(learningSpaceStorageRoot(), learner))) {
        const entry = path.join(learner, practice.name);
        const slug = practiceSlug(practice.name);
        if (!practice.isDirectory() || practiceIdFromSlug(slug) !== practice.name) {
          skipLearningSpaceEntry(entry, "not a practice project directory");
          continue;
        }
        const project = await readLearningSpaceProject(slug);
        if (project?.learnerKey === learner) projects.push(project);
        else if (project) skipLearningSpaceEntry(entry, "training marker names another learner");
      }
    }
    return projects.sort((left, right) => left.slug.localeCompare(right.slug));
  }

  /**
   * A practice runtime root in the shared inventory is never a catalogue
   * orphan: the catalogue sweep leaves every training slug with a marker.
   */
  async function isLearningSpaceRuntime(slug, projectRuntimeRoot) {
    if (!PRACTICE_SLUG_PATTERN.test(slug)) return false;
    let metadata;
    try { metadata = await readProjectRecordMetadata(resolveProjectRecordPath({ projectRuntimeRoot })); }
    catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
    if (!metadata?.training) return false;
    if (!await readLearningSpaceProject(slug)) skipLearningSpaceEntry(slug, "practice runtime without its learning-space project");
    return true;
  }

  /**
   * The one practice scope, on both hosts. allowDeleting admits only the
   * learner's own deletion: it requires write access and lets that owner see
   * and resume its deletion marker. requireProject is the ordinary page
   * admission: a project without its record, or one being deleted, is a
   * deleted practice project (not found).
   */
  async function runWithPracticeProjectScope({
    actor,
    training: inputTraining,
    access: practiceAccess = "observe",
    allowDeleting = false,
    requireProject = false
  } = {}, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Practice access requires an owning callback.");
    }
    if (allowDeleting === true && practiceAccess !== "write") {
      throw new TypeError("Practice deletion requires explicit write access.");
    }
    if (!["observe", "control", "write", "create"].includes(practiceAccess)) {
      throw new TypeError("Practice access requires an explicit supported operation scope.");
    }
    const training = normalizeProjectTraining(inputTraining);
    for (const value of [training.pin.course, training.pin.topic, training.pin.lesson, training.pin, training.exercise, training]) {
      Object.freeze(value);
    }
    if (practiceLearnerKey(actor) !== training.learnerKey) {
      throw Object.assign(new Error("Practice access belongs to the admitted learner."), { code: "vibe64_practice_scope_mismatch" });
    }
    const { slug, projectsRoot: practiceProjectsRoot, projectContextRoot } = practiceNamespace(learningSpaceStorageRoot(), training);
    // Preserve original runtime inventory, upgrade and canonical Git ownership.
    const projectRuntimeRoot = resolveCatalogProjectRuntimeRoot({ slug, systemRoot });
    for (const directory of [projectContextRoot, projectRuntimeRoot]) await practiceDirectoryExists(directory);
    const projectRecordPath = resolveProjectRecordPath({ projectRuntimeRoot });
    const metadata = await readProjectMetadata({ projectRecordPath });
    if (requireProject && practiceAccess !== "create" && (!Object.keys(metadata).length || (metadata.deletion && !allowDeleting))) {
      throw practiceProjectDeletedError();
    }
    if (await pathExists(projectContextRoot) || await pathExists(projectRuntimeRoot) || Object.keys(metadata).length) {
      if (practiceOwnershipDiffers(metadata, training, allowDeleting)) {
        throw Object.assign(
          new Error("Practice project has missing or different ownership. Keep it intact and ask the owner to inspect it."),
          { code: "vibe64_practice_scope_mismatch" }
        );
      }
    }
    const scope = Object.freeze({
      training,
      access: practiceAccess,
      slug,
      projectsRoot: practiceProjectsRoot,
      systemRoot,
      targetRoot: projectContextRoot,
      projectRecordPath,
      projectRuntimeRoot,
      projectSessionSourceRoot: projectContextRoot,
      sourceRoot: "",
      sourceConfigRoot: "",
      vibe64User: actor,
      ...(allowDeleting ? { allowDeleting: true } : {})
    });
    return runWithPracticeProjectContext(practiceOwner, scope, operation);
  }

  return Object.freeze({
    readLearningSpaceProject,
    listLearningSpaceProjects,
    runWithPracticeProjectScope,
    skipLearningSpaceEntry,
    isLearningSpaceRuntime,
    practiceDirectoryExists
  });
}

export { createLearningSpaceProjects };
