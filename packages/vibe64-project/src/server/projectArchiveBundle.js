import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";

// A project archive bundle on disk: its tar archives and their listing
// evidence, its manifest, resource evidence and lifecycle record, and the
// file checks every bundle read repeats.
const ARCHIVE_TIMEOUT_MS = 120_000;

const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;

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

/**
 * @param {object} request
 * @param {string[]} [request.excludePatterns]
 * @param {string} [request.archivePath]
 * @param {string[]} [request.disposablePaths]
 * @param {typeof runVibe64Command} [request.runCommand]
 * @param {string} [request.sourceName]
 * @param {string} [request.sourceParent]
 */
async function createTarArchive({
  // readable-check: allow dependency-default - input validation: an archive request without exclusions keeps every file
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

/**
 * Lists the archive and checks its root: the listing's evidence.
 */
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

/**
 * Host resource artifacts: the generic checks (inside the bundle, unique,
 * non-empty, digest) here; each kind's own evidence comes from its host.
 */
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

async function readArchiveLifecycle(bundlePath = "", options = {}) {
  const { createdAt = "", slug = "" } = options;
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

/**
 * Each disposable path is relative to the archived root (already carrying any
 * session-source prefix); tar leaves out that path and its contents.
 */
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

export {
  createBundleManifest,
  createTarArchive,
  PROJECT_ARCHIVE_LIFECYCLE,
  PROJECT_ARCHIVE_LIFECYCLE_KIND,
  PROJECT_ARCHIVE_MANIFEST,
  PROJECT_ARCHIVE_SCHEMA_VERSION,
  PROJECT_NAMESPACE_ARCHIVE,
  PROJECT_RESOURCE_EVIDENCE,
  PROJECT_RESOURCE_EVIDENCE_KIND,
  PROJECT_STATE_ARCHIVE,
  readArchiveLifecycle,
  readJsonIfExists,
  resourceEvidenceForArtifacts,
  utcTimestamp,
  validateBundleManifest,
  validateTarArchive,
  writeArchiveLifecycle,
  writeJsonAtomic
};
