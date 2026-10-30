import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir
} from "node:fs/promises";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import {
  assertProjectDirectoryUsable,
  normalizeProjectSlug,
  resolveProjectContextRoot
} from "@local/vibe64-core/server/studioProjectContext";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { pathExists, pathInsideOrEqual } from "@local/vibe64-core/server/core";
// Practice project slugs (the learning space). Outside its practice scope such
// a slug resolves to catalogue paths while its record is shared, so the
// archiver refuses it before writing any deletion marker.
import { PRACTICE_SLUG_PATTERN } from "@local/vibe64-core/server/learningSpace";
import { runVibe64Command } from "@local/vibe64-execution/server";

const ARCHIVE_TIMEOUT_MS = 120_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const PROJECT_ARCHIVE_ROOT = "project-archives";
const PROJECT_ARCHIVE_SCHEMA_VERSION = 1;
const PROJECT_ARCHIVE_KIND = "vibe64.project-archive-bundle";
const PROJECT_ARCHIVE_LIFECYCLE_KIND = "vibe64.project-archive-lifecycle";
const PROJECT_RESOURCE_EVIDENCE_KIND = "vibe64.project-resource-archive-evidence";
const PROJECT_ARCHIVE_MANIFEST = "manifest.json";
const PROJECT_ARCHIVE_LIFECYCLE = "lifecycle.json";
const PROJECT_RESOURCE_EVIDENCE = "resource-evidence.json";
// Archive schema v1 calls this artifact source.tgz/project-source. Its content
// is the project namespace, not a project-level application checkout.
const PROJECT_NAMESPACE_ARCHIVE = "source.tgz";
const PROJECT_STATE_ARCHIVE = "runtime-state.tgz";
const projectDeletionLocks = new Map();
const SESSION_SOURCE_DISPOSABLE_PATHS = Object.freeze([
  ".jskit/cache",
  ".next",
  ".turbo",
  "build",
  "cmake-build-*",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor"
]);
// Rebuildable output at the root of every session source in the namespace.
const PROJECT_NAMESPACE_DISPOSABLE_PATHS = Object.freeze(
  SESSION_SOURCE_DISPOSABLE_PATHS.map((entry) => `sessions/*/*/source/${entry}`)
);
const NO_HOST_RESOURCES = Object.freeze({
  archive: async () => [],
  remove: async () => {},
  artifactKinds: Object.freeze({})
});

// The project archive lifecycle shared by every host. A host with project
// resources of its own (managed databases, resource profiles) supplies them
// as hostResources:
//   archive(ctx) -> artifacts written inside ctx.bundlePath,
//   remove(ctx) after the bundle is validated (ctx.manifest is null for removeProject),
//   forget(ctx) after the project's runtime state is gone,
//   artifactKinds[kind] = { evidence(artifact, file), validate(artifact, file) }.
function createProjectArchiveService({
  assertArchiveHeadroom = null,
  closeProjectRuntime,
  clock = () => new Date(),
  hostResources = NO_HOST_RESOURCES,
  projectContext,
  removePath = rm,
  runCommand = runVibe64Command
} = {}) {
  if (!projectContext?.systemRoot) {
    throw new Error("createProjectArchiveService requires projectContext.systemRoot.");
  }
  if (typeof closeProjectRuntime !== "function") {
    throw new Error("createProjectArchiveService requires a runtime cleanup operation.");
  }
  const resources = { ...NO_HOST_RESOURCES, ...hostResources };
  const systemRoot = path.resolve(projectContext.systemRoot);
  const defaultArchiveRoot = path.join(systemRoot, PROJECT_ARCHIVE_ROOT);

  function readPinnedSessionId({ projectContextRoot, projectRuntimeRoot, slug }) {
    return createVibe64SessionStore({
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot: projectContext.projectSessionSourceRootForSlug(slug)
    }).readPinnedSessionId();
  }

  // The namespace of a slug: the catalogue's, or inside the matching practice
  // scope the learning-space one. Everything else is refused before any write.
  async function projectNamespace(slug, { archiveRoot = defaultArchiveRoot } = {}) {
    const scope = projectContext.currentPracticeProjectScope?.() || null;
    if (scope?.slug === slug) {
      const learningSpaceRoot = projectContext.learningSpaceRoot ? path.resolve(projectContext.learningSpaceRoot) : "";
      const projectContextRoot = path.resolve(scope.targetRoot);
      if (!PRACTICE_SLUG_PATTERN.test(slug) || !learningSpaceRoot ||
          projectContextRoot === learningSpaceRoot || !pathInsideOrEqual(learningSpaceRoot, projectContextRoot)) {
        throw practiceScopeRequired(slug);
      }
      // The archive holds and removes only the namespace, so the learner's
      // session sources must live inside it (one layout on both hosts).
      if (!pathInsideOrEqual(projectContextRoot, path.resolve(projectContext.projectSessionSourceRootForSlug(slug)))) {
        throw Object.assign(new Error(`Practice project ${slug} keeps its session sources outside its namespace; inspect it before retrying.`), {
          code: "vibe64_practice_session_source_outside_namespace"
        });
      }
      return { practice: true, projectContextRoot };
    }
    const projectsRoot = path.resolve(String(projectContext.projectsRoot || "/"));
    const projectContextRoot = resolveProjectContextRoot({ projectsRoot, slug });
    if (PRACTICE_SLUG_PATTERN.test(slug) && (!projectContext.projectsRoot ||
        !await catalogueProjectNamedLikePractice({ archiveRoot, slug }))) {
      throw practiceScopeRequired(slug);
    }
    if (!projectContext.projectsRoot || !pathInsideOrEqual(projectsRoot, projectContextRoot)) {
      const error = new Error("Project folder must be inside the Vibe64 projects root.");
      error.code = "vibe64_project_outside_projects_root";
      throw error;
    }
    return { practice: false, projectContextRoot };
  }

  // A catalogue project named like a practice project (created before the
  // name was reserved) is still archived, resumed and replayed; a practice
  // record never is. The record decides; once it is gone (a completed
  // archive), the catalogue's own lifecycle journal for the slug does.
  async function catalogueProjectNamedLikePractice({ archiveRoot, slug }) {
    const { metadata = {} } = await projectContext.readWorkspaceProjectState({ slug });
    if (Object.keys(metadata).length) return !metadata.training;
    const entries = await readdir(path.join(archiveRoot, slug), { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries.filter((value) => value.isDirectory())) {
      const lifecycle = await readJsonIfExists(path.join(archiveRoot, slug, entry.name, PROJECT_ARCHIVE_LIFECYCLE));
      if (lifecycle?.kind === PROJECT_ARCHIVE_LIFECYCLE_KIND && lifecycle.slug === slug) return true;
    }
    return false;
  }

  async function removeEmptyPracticeParent({ practice, projectContextRoot }) {
    if (!practice) return;
    // The practice namespace's own directory goes too; anything else stays.
    await rmdir(path.dirname(projectContextRoot)).catch((error) => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    });
  }

  // The final deletion steps shared by archival and removeProject.
  async function removeProjectNamespaceAndState({ completed, markComplete, namespace, projectRuntimeRoot, slug, metadata }) {
    const { projectContextRoot } = namespace;
    if (!completed("source-removed")) {
      if (await pathExists(projectContextRoot)) {
        await removePath(projectContextRoot, {
          force: true,
          recursive: true
        });
      }
      if (await pathExists(projectContextRoot)) {
        const error = new Error("Project namespace still exists after deletion.");
        error.code = "vibe64_project_namespace_delete_failed";
        throw error;
      }
      await markComplete("source-removed");
    }

    if (!completed("state-removal-started")) {
      await markComplete("state-removal-started");
    }
    if (await pathExists(projectRuntimeRoot)) {
      await removePath(projectRuntimeRoot, {
        force: true,
        recursive: true
      });
    }
    if (await pathExists(projectRuntimeRoot)) {
      const error = new Error("Project runtime and session state still exists after deletion.");
      error.code = "vibe64_project_state_delete_failed";
      throw error;
    }
    await removeEmptyPracticeParent(namespace);
    await resources.forget?.({ metadata, projectContextRoot, projectRuntimeRoot, slug });
  }

  async function projectStorageRemains({ projectContextRoot, expectedProjectRuntimeRoot }) {
    return await pathExists(projectContextRoot) || Boolean(expectedProjectRuntimeRoot && await pathExists(expectedProjectRuntimeRoot));
  }

  async function archiveProject(input = {}) {
    const slug = normalizeProjectSlug(input.slug || input.projectSlug || "");
    const archiveRoot = input.archiveRoot ? path.resolve(input.archiveRoot) : defaultArchiveRoot;
    return withProjectDeletionLock(`${systemRoot}\0${slug}`, async () => {
      const namespace = await projectNamespace(slug, { archiveRoot });
      const { projectContextRoot } = namespace;
      const existingState = await projectContext.readWorkspaceProjectState({
        slug
      });
      if (!Object.keys(existingState.metadata || {}).length) {
        const completed = await completedArchiveWithoutProjectState({
          archiveRoot,
          projectContextRoot,
          runCommand,
          resources,
          slug
        });
        if (completed) {
          return completed;
        }
        const error = new Error(`Project state is missing for ${slug}.`);
        error.code = "vibe64_project_state_missing";
        throw error;
      }
      const projectRuntimeRoot = assertProjectRuntimeRoot({
        expectedProjectRuntimeRoot: projectContext.projectRuntimeRootForSlug(slug),
        projectRuntimeRoot: existingState.projectRuntimeRoot,
        systemRoot
      });
      const commandRoot = await pathExists(projectContextRoot)
        ? projectContextRoot
        : projectRuntimeRoot;
      const runArchiveCommand = (input = {}) => runCommand({
        ...input,
        allowedRoots: [...(input.allowedRoots || []), commandRoot],
        cwd: commandRoot
      });
      const pinnedSessionId = await readPinnedSessionId({ projectContextRoot, projectRuntimeRoot, slug });
      if (pinnedSessionId) {
        throw Object.assign(new Error(`Unpin session ${pinnedSessionId} before deleting this project.`), {
          code: "vibe64_project_pinned",
          statusCode: 409
        });
      }
      // A fresh archive may first ask the host for storage headroom; a resumed
      // one continues, because finishing it is what frees the space.
      if (input.checkHeadroom === true && !existingState.metadata.deletion && typeof assertArchiveHeadroom === "function") {
        await assertArchiveHeadroom({ archiveRoot, projectContextRoot, projectRuntimeRoot, slug });
      }
      // The owner's own step before removal, under the lock after every
      // refusal, so a refused archive changes nothing.
      if (typeof input.beforeRemove === "function") await input.beforeRemove({ slug });
      const metadata = existingState.metadata;
      const started = await projectContext.beginWorkspaceProjectDeletion({
        startedAt: metadata.deletion?.startedAt || clock().toISOString(),
        slug
      });
      const activeDeletion = started.metadata.deletion;
      const bundlePath = path.join(
        archiveRoot,
        slug,
        `${utcTimestamp(activeDeletion.startedAt)}-${slug}`
      );
      const namespaceArchivePath = path.join(bundlePath, PROJECT_NAMESPACE_ARCHIVE);
      const stateArchivePath = path.join(bundlePath, PROJECT_STATE_ARCHIVE);
      await mkdir(bundlePath, {
        mode: 0o700,
        recursive: true
      });
      await chmod(bundlePath, 0o700);
      const lifecycle = await readArchiveLifecycle(bundlePath, {
        createdAt: activeDeletion.startedAt,
        slug
      });
      let lifecycleChanged = false;
      for (const [step, value] of Object.entries(activeDeletion.steps || {})) {
        if (value && lifecycle.steps[step] !== true) {
          lifecycle.steps[step] = true;
          lifecycleChanged = true;
        }
      }
      if (lifecycleChanged) {
        lifecycle.updatedAt = clock().toISOString();
        await writeArchiveLifecycle(bundlePath, lifecycle);
      }
      const completed = (step) => Boolean(
        activeDeletion.steps?.[step] || lifecycle.steps?.[step]
      );
      const markComplete = async (step) => {
        const updated = await projectContext.completeWorkspaceProjectDeletionStep({
          slug,
          step
        });
        activeDeletion.steps = updated.metadata.deletion.steps;
        lifecycle.steps[step] = true;
        lifecycle.updatedAt = clock().toISOString();
        await writeArchiveLifecycle(bundlePath, lifecycle);
      };
      const resourceContext = { bundlePath, metadata, projectContextRoot, projectRuntimeRoot, slug };
      // Evidence this run already produced, so one uninterrupted run lists and
      // hashes each archive once when it is created and once when validated.
      let namespaceEvidence = null;
      let stateEvidence = null;
      let validatedManifest = null;

      if (!completed("runtime-closed")) {
        const closed = await closeProjectRuntime({
          reason: "project-delete",
          slug
        });
        if (closed?.ok === false) {
          const error = new Error("Project runtime could not be closed before archival.");
          error.code = "vibe64_project_runtime_close_failed";
          error.result = closed;
          throw error;
        }
        await markComplete("runtime-closed");
      }

      if (!completed("source-archived")) {
        await assertProjectDirectoryUsable(projectContextRoot);
        await createTarArchive({
          archivePath: namespaceArchivePath,
          disposablePaths: PROJECT_NAMESPACE_DISPOSABLE_PATHS,
          runCommand: runArchiveCommand,
          sourceName: slug,
          sourceParent: path.dirname(projectContextRoot)
        });
        namespaceEvidence = await validateTarArchive({
          archivePath: namespaceArchivePath,
          expectedPrefix: `${slug}/`,
          runCommand: runArchiveCommand
        });
        await markComplete("source-archived");
      }

      if (!completed("state-archived")) {
        await createTarArchive({
          archivePath: stateArchivePath,
          // Drop Zones and usage recordings belong to their session only.
          excludePatterns: ["active", "closing"].flatMap((state) => ["drop-zone", "usage-recordings"]
            .map((name) => `${path.basename(projectRuntimeRoot)}/sessions/${state}/*/${name}`)),
          runCommand: runArchiveCommand,
          sourceName: path.basename(projectRuntimeRoot),
          sourceParent: path.dirname(projectRuntimeRoot)
        });
        stateEvidence = await validateTarArchive({
          archivePath: stateArchivePath,
          expectedPrefix: `${path.basename(projectRuntimeRoot)}/`,
          runCommand: runArchiveCommand
        });
        await markComplete("state-archived");
      }

      if (!completed("resources-archived")) {
        const evidence = await resourceEvidenceForArtifacts({
          artifacts: await resources.archive(resourceContext),
          artifactKinds: resources.artifactKinds,
          bundlePath,
          runCommand: runArchiveCommand
        });
        await writeJsonAtomic(path.join(bundlePath, PROJECT_RESOURCE_EVIDENCE), {
          artifacts: evidence,
          kind: PROJECT_RESOURCE_EVIDENCE_KIND,
          schemaVersion: PROJECT_ARCHIVE_SCHEMA_VERSION,
          slug
        });
        await markComplete("resources-archived");
      }

      if (!completed("bundle-validated")) {
        const manifest = await createBundleManifest({
          bundlePath,
          createdAt: activeDeletion.startedAt,
          runCommand: runArchiveCommand,
          slug,
          namespaceArchivePath,
          namespaceEvidence,
          stateArchivePath,
          stateEvidence
        });
        await writeJsonAtomic(path.join(bundlePath, PROJECT_ARCHIVE_MANIFEST), manifest);
        validatedManifest = await validateBundleManifest({
          artifactKinds: resources.artifactKinds,
          bundlePath,
          runCommand: runArchiveCommand,
          slug
        });
        await markComplete("bundle-validated");
      }

      // A resumed run validates the bundle an earlier run completed.
      const manifest = validatedManifest ?? await validateBundleManifest({
        artifactKinds: resources.artifactKinds,
        bundlePath,
        runCommand: runArchiveCommand,
        slug
      });

      if (!completed("resources-removed")) {
        await resources.remove({ ...resourceContext, manifest });
        await markComplete("resources-removed");
      }

      await removeProjectNamespaceAndState({ completed, markComplete, namespace, projectRuntimeRoot, slug, metadata });
      lifecycle.steps["state-removed"] = true;
      lifecycle.updatedAt = clock().toISOString();
      await writeArchiveLifecycle(bundlePath, lifecycle);
      return archiveResult({
        bundlePath,
        manifest,
        slug
      });
    });
  }

  // The refusals of removeProject before any side effect: a completed removal
  // (missing record), a project outside its practice scope or not practice,
  // or a pinned session. Read-only; removeProject repeats it under the lock.
  async function removalPreflight(input = {}) {
    const slug = normalizeProjectSlug(input.slug || input.projectSlug || "");
    if (!PRACTICE_SLUG_PATTERN.test(slug)) throw notPractice();
    const namespace = await projectNamespace(slug);
    if (!namespace.practice) throw notPractice();
    const { projectContextRoot } = namespace;
    const existingState = await projectContext.readWorkspaceProjectState({
      slug
    });
    const expectedProjectRuntimeRoot = projectContext.projectRuntimeRootForSlug(slug);
    if (!Object.keys(existingState.metadata || {}).length) {
      // The record is removed last, so a missing record with no remaining
      // storage is a completed removal; anything else needs inspection.
      if (await projectStorageRemains({ projectContextRoot, expectedProjectRuntimeRoot })) {
        const error = new Error(`Project state is missing for ${slug}.`);
        error.code = "vibe64_project_state_missing";
        throw error;
      }
      return { ok: true, slug, removed: false };
    }
    if (!existingState.metadata.training) {
      throw notPractice();
    }
    const projectRuntimeRoot = assertProjectRuntimeRoot({
      expectedProjectRuntimeRoot,
      projectRuntimeRoot: existingState.projectRuntimeRoot,
      systemRoot
    });
    const pinnedSessionId = await readPinnedSessionId({ projectContextRoot, projectRuntimeRoot, slug });
    if (pinnedSessionId) {
      throw Object.assign(new Error(`Unpin session ${pinnedSessionId} before deleting this practice project.`), {
        code: "vibe64_project_pinned",
        statusCode: 409
      });
    }
    return { slug, namespace, existingState, projectRuntimeRoot };
  }

  // Read-only presence check: a project whose removal completed (no record,
  // no storage) no longer exists; one whose removal stopped part-way keeps its
  // record and still exists for the retry.
  async function projectExists(input = {}) {
    const slug = normalizeProjectSlug(input.slug || input.projectSlug || "");
    const existingState = await projectContext.readWorkspaceProjectState({ slug });
    if (Object.keys(existingState.metadata || {}).length) return true;
    return projectStorageRemains({
      projectContextRoot: (await projectNamespace(slug)).projectContextRoot,
      expectedProjectRuntimeRoot: projectContext.projectRuntimeRootForSlug(slug)
    });
  }

  async function canRemoveProject(input = {}) {
    try {
      await removalPreflight(input);
      return { ok: true };
    } catch (error) {
      if (error.statusCode && error.statusCode < 500) return { ok: false, reason: error.message };
      throw error;
    }
  }

  // Light deletion of a practice project: the archive lifecycle above minus
  // its archive steps. It shares the per-slug lock, pinned-session refusal,
  // persisted deletion marker and resumable steps, then removes host
  // resources, namespace and runtime state exactly as archival does.
  async function removeProject(input = {}) {
    const slug = normalizeProjectSlug(input.slug || input.projectSlug || "");
    return withProjectDeletionLock(`${systemRoot}\0${slug}`, async () => {
      const checked = await removalPreflight({ slug });
      if (checked.removed === false) return { ok: true, slug, removed: false };
      if (typeof input.beforeRemove === "function") await input.beforeRemove({ slug });
      const { namespace, existingState, projectRuntimeRoot } = checked;
      const metadata = existingState.metadata;
      const started = await projectContext.beginWorkspaceProjectDeletion({
        startedAt: metadata.deletion?.startedAt || clock().toISOString(),
        slug
      });
      const steps = { ...started.metadata.deletion?.steps };
      const completed = (step) => Boolean(steps[step]);
      const markComplete = async (step) => {
        const updated = await projectContext.completeWorkspaceProjectDeletionStep({
          slug,
          step
        });
        Object.assign(steps, updated.metadata.deletion.steps);
      };

      if (!completed("runtime-closed")) {
        const closed = await closeProjectRuntime({
          reason: "project-delete",
          slug
        });
        if (closed?.ok === false) {
          const error = new Error("Project runtime could not be closed before deletion.");
          error.code = "vibe64_project_runtime_close_failed";
          error.result = closed;
          throw error;
        }
        await markComplete("runtime-closed");
      }

      if (!completed("resources-removed")) {
        await resources.remove({ manifest: null, metadata, projectContextRoot: namespace.projectContextRoot,
          projectRuntimeRoot, slug });
        await markComplete("resources-removed");
      }

      await removeProjectNamespaceAndState({ completed, markComplete, namespace, projectRuntimeRoot, slug, metadata });
      return { ok: true, slug, removed: true };
    });
  }

  return Object.freeze({
    archiveProject,
    canRemoveProject,
    projectExists,
    removeProject
  });
}

function notPractice() {
  return Object.assign(new Error("Only practice projects can be deleted without an archive. Use Delete project instead."), {
    code: "vibe64_project_not_practice",
    statusCode: 409
  });
}

function practiceScopeRequired(slug = "") {
  return Object.assign(new Error(`Practice project ${slug} can be archived or deleted only from its learner's Practice list.`), {
    code: "vibe64_practice_scope_required",
    statusCode: 409
  });
}

async function withProjectDeletionLock(key = "", operation) {
  const previous = projectDeletionLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  projectDeletionLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectDeletionLocks.get(key) === queued) {
      projectDeletionLocks.delete(key);
    }
  }
}

async function completedArchiveWithoutProjectState({
  archiveRoot = "",
  projectContextRoot = "",
  resources,
  runCommand = runVibe64Command,
  slug = ""
} = {}) {
  if (await pathExists(projectContextRoot)) {
    return null;
  }
  const projectArchiveRoot = path.join(archiveRoot, slug);
  const entries = await readdir(projectArchiveRoot, {
    withFileTypes: true
  }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  for (const entry of entries.filter((value) => value.isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name))) {
    const bundlePath = path.join(projectArchiveRoot, entry.name);
    const lifecycle = await readJsonIfExists(path.join(bundlePath, PROJECT_ARCHIVE_LIFECYCLE));
    if (
      lifecycle?.kind !== PROJECT_ARCHIVE_LIFECYCLE_KIND ||
      lifecycle?.slug !== slug ||
      lifecycle?.steps?.["resources-removed"] !== true ||
      lifecycle?.steps?.["source-removed"] !== true ||
      lifecycle?.steps?.["state-removal-started"] !== true
    ) {
      continue;
    }
    const manifest = await validateBundleManifest({
      artifactKinds: resources.artifactKinds,
      bundlePath,
      runCommand,
      slug
    });
    if (lifecycle.steps["state-removed"] !== true) {
      lifecycle.steps["state-removed"] = true;
      lifecycle.updatedAt = new Date().toISOString();
      await writeArchiveLifecycle(bundlePath, lifecycle);
    }
    return archiveResult({
      bundlePath,
      manifest,
      slug
    });
  }
  return null;
}

function archiveResult({ bundlePath = "", manifest = {}, slug = "" } = {}) {
  return {
    archivePath: bundlePath,
    artifacts: Array.isArray(manifest.artifacts) ? manifest.artifacts : [],
    bundlePath,
    manifestPath: path.join(bundlePath, PROJECT_ARCHIVE_MANIFEST),
    ok: true,
    slug
  };
}

function assertProjectRuntimeRoot({
  expectedProjectRuntimeRoot = "",
  projectRuntimeRoot = "",
  systemRoot = ""
} = {}) {
  const resolvedSystemRoot = path.resolve(String(systemRoot || "").trim());
  const resolvedExpectedProjectRuntimeRoot = path.resolve(String(expectedProjectRuntimeRoot || "").trim());
  const resolvedProjectRuntimeRoot = path.resolve(String(projectRuntimeRoot || "").trim());
  if (
    !String(systemRoot || "").trim() ||
    !String(expectedProjectRuntimeRoot || "").trim() ||
    resolvedProjectRuntimeRoot !== resolvedExpectedProjectRuntimeRoot ||
    resolvedProjectRuntimeRoot === resolvedSystemRoot ||
    !pathInsideOrEqual(resolvedSystemRoot, resolvedProjectRuntimeRoot)
  ) {
    const error = new Error("Project state folder does not match the project's Vibe64 runtime folder.");
    error.code = "vibe64_project_state_outside_system_root";
    throw error;
  }
  return resolvedProjectRuntimeRoot;
}

async function createTarArchive({
  excludePatterns = [],
  archivePath = "",
  disposablePaths = [],
  runCommand = runVibe64Command,
  sourceName = "",
  sourceParent = ""
} = {}) {
  await mkdir(path.dirname(archivePath), {
    mode: 0o700,
    recursive: true
  });
  const temporaryPath = `${archivePath}.partial`;
  await rm(temporaryPath, {
    force: true
  });
  const args = [
    "--acls",
    "--xattrs",
    "--numeric-owner",
    "-czf",
    temporaryPath,
    ...tarExcludeArgs(sourceName, disposablePaths),
    ...excludePatterns.flatMap((pattern) => ["--exclude", pattern]),
    "-C",
    sourceParent,
    sourceName
  ];
  const result = await runCommand({
    actor: "daemon",
    allowedRoots: [
      sourceParent,
      path.dirname(archivePath)
    ],
    args,
    command: "tar",
    cwd: sourceParent,
    envPolicy: "project",
    maxBuffer: COMMAND_BUFFER_BYTES,
    mode: "capture",
    purpose: "deployment",
    timeout: ARCHIVE_TIMEOUT_MS
  });
  if (result?.ok !== true) {
    await rm(temporaryPath, {
      force: true
    });
    const error = new Error(`Project archive could not be created: ${commandOutput(result) || "tar failed."}`);
    error.code = "vibe64_project_archive_failed";
    error.result = result;
    throw error;
  }
  await assertNonEmptyFile(temporaryPath, "vibe64_project_archive_empty");
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, archivePath);
}

// Lists the archive and checks its root: the listing's evidence.
async function tarListingEvidence({
  archivePath = "",
  expectedPrefix = "",
  runCommand = runVibe64Command
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots: [path.dirname(archivePath)],
    args: ["-tzf", archivePath],
    command: "tar",
    cwd: path.dirname(archivePath),
    envPolicy: "project",
    maxBuffer: COMMAND_BUFFER_BYTES,
    mode: "capture",
    purpose: "health",
    timeout: ARCHIVE_TIMEOUT_MS
  });
  if (result?.ok !== true) {
    const error = new Error(`Project archive validation failed: ${commandOutput(result) || "tar failed."}`);
    error.code = "vibe64_project_archive_invalid";
    error.result = result;
    throw error;
  }
  const listing = commandOutput(result)
    .split(/\r?\n/u)
    .filter(Boolean);
  if (listing.length < 1 || !listing.some((entry) => entry === expectedPrefix || entry.startsWith(expectedPrefix))) {
    const error = new Error(`Project archive does not contain its expected root: ${expectedPrefix}`);
    error.code = "vibe64_project_archive_incomplete";
    throw error;
  }
  return {
    entryCount: listing.length,
    listingSha256: sha256Text(`${listing.join("\n")}\n`)
  };
}

async function validateTarArchive(options = {}) {
  const listing = await tarListingEvidence(options);
  const info = await assertNonEmptyFile(options.archivePath, "vibe64_project_archive_empty");
  return {
    ...listing,
    sha256: await sha256File(options.archivePath),
    size: info.size,
    type: "tar-gzip"
  };
}

// Host resource artifacts: the generic checks (inside the bundle, unique,
// non-empty, digest) here; each kind's own evidence comes from its host.
async function resourceEvidenceForArtifacts({
  artifactKinds = {},
  artifacts = [],
  bundlePath = "",
  runCommand = runVibe64Command
} = {}) {
  const seen = new Set();
  const evidence = [];
  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    const absolutePath = assertArtifactInsideBundle(bundlePath, artifact?.path);
    const relativePath = portableRelativePath(bundlePath, absolutePath);
    if (seen.has(relativePath)) {
      const error = new Error(`Managed resource archive path is duplicated: ${relativePath}`);
      error.code = "vibe64_project_resource_archive_duplicate";
      throw error;
    }
    seen.add(relativePath);
    const kind = Object.hasOwn(artifactKinds, String(artifact?.kind || "")) ? artifactKinds[artifact.kind] : null;
    if (!kind) {
      const error = new Error("Managed resource archive validation evidence is incomplete.");
      error.code = "vibe64_project_resource_archive_evidence_invalid";
      throw error;
    }
    const info = await assertNonEmptyFile(absolutePath, "vibe64_project_resource_archive_empty");
    const record = await kind.evidence(artifact, { absolutePath, path: relativePath, runCommand, size: info.size });
    evidence.push({ ...record, kind: artifact.kind, path: relativePath, sha256: await sha256File(absolutePath), size: info.size });
  }
  return evidence.sort((left, right) => left.path.localeCompare(right.path));
}

async function createBundleManifest({
  bundlePath = "",
  createdAt = "",
  runCommand = runVibe64Command,
  slug = "",
  namespaceArchivePath = "",
  namespaceEvidence = null,
  stateArchivePath = "",
  stateEvidence = null
} = {}) {
  const namespace = namespaceEvidence || await validateTarArchive({
    archivePath: namespaceArchivePath,
    expectedPrefix: `${slug}/`,
    runCommand
  });
  const state = stateEvidence || await validateTarArchive({
    archivePath: stateArchivePath,
    expectedPrefix: `${slug}/`,
    runCommand
  });
  const resourceEvidence = await readResourceEvidence(bundlePath, slug);
  return {
    artifacts: [
      {
        entryCount: namespace.entryCount,
        kind: "project-source",
        listingSha256: namespace.listingSha256,
        path: PROJECT_NAMESPACE_ARCHIVE,
        sha256: namespace.sha256,
        size: namespace.size,
        type: namespace.type
      },
      {
        entryCount: state.entryCount,
        kind: "project-runtime-state",
        listingSha256: state.listingSha256,
        path: PROJECT_STATE_ARCHIVE,
        sha256: state.sha256,
        size: state.size,
        type: state.type
      },
      ...resourceEvidence.artifacts
    ],
    createdAt,
    kind: PROJECT_ARCHIVE_KIND,
    schemaVersion: PROJECT_ARCHIVE_SCHEMA_VERSION,
    slug
  };
}

async function validateBundleManifest({
  artifactKinds = {},
  bundlePath = "",
  runCommand = runVibe64Command,
  slug = ""
} = {}) {
  const manifestPath = path.join(bundlePath, PROJECT_ARCHIVE_MANIFEST);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Project archive manifest is unreadable: ${error.message}`);
    wrapped.code = "vibe64_project_archive_manifest_invalid";
    wrapped.cause = error;
    throw wrapped;
  }
  if (
    manifest?.kind !== PROJECT_ARCHIVE_KIND ||
    manifest?.schemaVersion !== PROJECT_ARCHIVE_SCHEMA_VERSION ||
    manifest?.slug !== slug ||
    !Array.isArray(manifest?.artifacts)
  ) {
    const error = new Error("Project archive manifest has an invalid shape.");
    error.code = "vibe64_project_archive_manifest_invalid";
    throw error;
  }
  const paths = new Set();
  for (const artifact of manifest.artifacts) {
    const absolutePath = assertArtifactInsideBundle(bundlePath, artifact?.path);
    if (
      typeof artifact?.path !== "string" ||
      path.isAbsolute(artifact.path) ||
      portableRelativePath(bundlePath, absolutePath) !== artifact.path
    ) {
      const error = new Error("Project archive manifest paths must be canonical bundle-relative paths.");
      error.code = "vibe64_project_archive_manifest_invalid";
      throw error;
    }
    if (paths.has(artifact.path)) {
      const error = new Error(`Project archive manifest path is duplicated: ${artifact.path}`);
      error.code = "vibe64_project_archive_manifest_invalid";
      throw error;
    }
    paths.add(artifact.path);
    const info = await assertNonEmptyFile(absolutePath, "vibe64_project_archive_artifact_missing");
    const digest = await sha256File(absolutePath);
    if (info.size !== artifact.size || digest !== artifact.sha256) {
      const error = new Error(`Project archive artifact does not match its manifest: ${artifact.path}`);
      error.code = "vibe64_project_archive_artifact_changed";
      throw error;
    }
    if (["project-source", "project-runtime-state"].includes(artifact.kind)) {
      const expectedKind = artifact.path === PROJECT_NAMESPACE_ARCHIVE
        ? "project-source"
        : artifact.path === PROJECT_STATE_ARCHIVE
          ? "project-runtime-state"
          : "";
      const tarEvidence = await tarListingEvidence({
        archivePath: absolutePath,
        expectedPrefix: `${slug}/`,
        runCommand
      });
      if (
        tarEvidence.entryCount !== artifact.entryCount ||
        tarEvidence.listingSha256 !== artifact.listingSha256 ||
        artifact.kind !== expectedKind ||
        artifact.type !== "tar-gzip"
      ) {
        const error = new Error(`Project archive listing does not match its manifest: ${artifact.path}`);
        error.code = "vibe64_project_archive_listing_changed";
        throw error;
      }
    } else if (Object.hasOwn(artifactKinds, String(artifact.kind || ""))) {
      await artifactKinds[artifact.kind].validate(artifact, { absolutePath, runCommand, size: info.size });
    } else {
      const error = new Error(`Project archive resource evidence is invalid: ${artifact.path}`);
      error.code = "vibe64_project_archive_manifest_invalid";
      throw error;
    }
  }
  for (const required of [PROJECT_NAMESPACE_ARCHIVE, PROJECT_STATE_ARCHIVE]) {
    if (!paths.has(required)) {
      const error = new Error(`Project archive manifest is missing ${required}.`);
      error.code = "vibe64_project_archive_manifest_incomplete";
      throw error;
    }
  }
  return manifest;
}

async function readResourceEvidence(bundlePath = "", slug = "") {
  const evidence = await readJsonIfExists(path.join(bundlePath, PROJECT_RESOURCE_EVIDENCE));
  if (
    evidence?.kind !== PROJECT_RESOURCE_EVIDENCE_KIND ||
    evidence?.schemaVersion !== PROJECT_ARCHIVE_SCHEMA_VERSION ||
    evidence?.slug !== slug ||
    !Array.isArray(evidence?.artifacts)
  ) {
    const error = new Error("Project resource archive evidence is missing or invalid.");
    error.code = "vibe64_project_resource_archive_evidence_invalid";
    throw error;
  }
  return evidence;
}

async function readArchiveLifecycle(bundlePath = "", { createdAt = "", slug = "" } = {}) {
  const existing = await readJsonIfExists(path.join(bundlePath, PROJECT_ARCHIVE_LIFECYCLE));
  if (existing) {
    if (
      existing.kind !== PROJECT_ARCHIVE_LIFECYCLE_KIND ||
      existing.schemaVersion !== PROJECT_ARCHIVE_SCHEMA_VERSION ||
      existing.slug !== slug ||
      !existing.steps ||
      typeof existing.steps !== "object" ||
      Array.isArray(existing.steps)
    ) {
      const error = new Error("Project archive lifecycle journal is invalid.");
      error.code = "vibe64_project_archive_lifecycle_invalid";
      throw error;
    }
    return existing;
  }
  return {
    createdAt,
    kind: PROJECT_ARCHIVE_LIFECYCLE_KIND,
    schemaVersion: PROJECT_ARCHIVE_SCHEMA_VERSION,
    slug,
    steps: {},
    updatedAt: createdAt
  };
}

async function writeArchiveLifecycle(bundlePath = "", lifecycle = {}) {
  return writeJsonAtomic(path.join(bundlePath, PROJECT_ARCHIVE_LIFECYCLE), lifecycle);
}

async function writeJsonAtomic(filePath = "", value = {}) {
  await writeJsonFileAtomic(filePath, value, { fileMode: 0o600 });
}

async function readJsonIfExists(filePath = "") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function assertArtifactInsideBundle(bundlePath = "", artifactPath = "") {
  const root = path.resolve(bundlePath);
  const resolved = path.isAbsolute(String(artifactPath || ""))
    ? path.resolve(String(artifactPath || ""))
    : path.resolve(root, String(artifactPath || ""));
  if (!String(artifactPath || "").trim() || resolved === root || !pathInsideOrEqual(root, resolved)) {
    const error = new Error("Project archive artifact must be inside its bundle.");
    error.code = "vibe64_project_archive_artifact_outside_bundle";
    throw error;
  }
  return resolved;
}

function portableRelativePath(root = "", filePath = "") {
  return path.relative(path.resolve(root), path.resolve(filePath)).split(path.sep).join("/");
}

function commandOutput(result = {}) {
  return String(result.output || result.stdout || "").trim();
}

async function sha256File(filePath = "") {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

function sha256Text(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

// Each disposable path is relative to the archived root (already carrying any
// session-source prefix); tar leaves out that path and its contents.
function tarExcludeArgs(slug = "", disposablePaths = []) {
  return disposablePaths.flatMap((entry) => ["--exclude", `${slug}/${entry}`, "--exclude", `${slug}/${entry}/*`]);
}

async function assertNonEmptyFile(filePath = "", code = "vibe64_project_archive_missing") {
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    error.code = error?.code === "ENOENT" ? code : error.code;
    throw error;
  }
  if (!info.isFile() || info.size < 1) {
    const error = new Error(`Project archive artifact was not created: ${filePath}`);
    error.code = code;
    throw error;
  }
  return info;
}

function utcTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString()
    .replace(/[-:]/gu, "")
    .replace(".", "");
}

export { createProjectArchiveService };
