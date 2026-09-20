import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  checkpointRefRoot,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";

const GIT_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const RECOVERY_ARTIFACT_ROOT = "recovery";
const RECOVERY_BRANCH_BUNDLE_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/branch.bundle`;
const RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/checkpoints.bundle`;
const RECOVERY_PATCH_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/worktree.patch`;
const RECOVERY_UNTRACKED_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.tar.gz`;
const RECOVERY_UNTRACKED_LIST_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.list`;
const SESSION_RENEWAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

async function runCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  runtimes = [],
  timeout = GIT_TIMEOUT_MS
} = {}) {
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      cwd,
      ...allowedRoots
    ].filter(Boolean),
    args,
    command,
    cwd,
    envPolicy: "session",
    gitSafeDirectories: command === "git" ? [cwd] : [],
    maxBuffer,
    mode: "capture",
    purpose: "source",
    runtimes,
    timeout
  });
  return {
    ok: result.ok === true,
    output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      normalizeText(result.output || result.error),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

async function runGit(cwd, args = [], options = {}) {
  return runCommand("git", args, {
    cwd,
    runtimes: ["git"],
    ...options
  });
}

function metadataValue(session = {}, name = "") {
  return normalizeText(session.metadata?.[name]);
}

function recoverySessionName(session = {}) {
  return normalizeText(session.sessionName) ||
    metadataValue(session, "source_recovery_session_name") ||
    normalizeText(session.sessionId);
}

function recoveryWorktreePath(session = {}) {
  return metadataValue(session, "source_recovery_source_path") ||
    sessionSourcePath(session);
}

function parseNullSeparatedPaths(value = "") {
  return String(value || "")
    .split("\0")
    .map((entry) => normalizeText(entry).replaceAll("\\", "/").replace(/^\.\//u, ""))
    .filter(Boolean);
}

async function writeMetadataValues(store, sessionId, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    await store.writeMetadataValue(sessionId, name, value);
  }
}

async function readWorktreeGitFact(worktreePath, args = [], fallback = "") {
  const result = await runGit(worktreePath, args, {
    timeout: 15_000
  });
  return result.ok ? normalizeText(result.stdout || result.output) : fallback;
}

function sameResolvedPath(left = "", right = "") {
  return Boolean(left && right) && path.resolve(left) === path.resolve(right);
}

function assertSessionRenewalId(renewalId = "") {
  const normalizedRenewalId = normalizeText(renewalId);
  if (!SESSION_RENEWAL_ID_PATTERN.test(normalizedRenewalId)) {
    throw vibe64Error(
      `Invalid Vibe64 session renewal id: ${normalizedRenewalId || "(empty)"}`,
      "vibe64_invalid_session_renewal_id"
    );
  }
  return normalizedRenewalId;
}

function renewalSourceStagePath(session = {}, renewalId = "") {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    throw vibe64Error(
      `Session ${normalizeText(session.sessionId) || "(unknown)"} has no managed source to stage for renewal.`,
      "vibe64_session_source_required"
    );
  }
  return `${path.resolve(worktreePath)}.renewal-${assertSessionRenewalId(renewalId)}`;
}

function renewalSourceDeletionPath(session = {}, renewalId = "") {
  return `${renewalSourceStagePath(session, renewalId)}.deleting`;
}

async function isExactGitWorktree(worktreePath = "") {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  const result = await runGit(worktreePath, ["rev-parse", "--show-toplevel"], {
    timeout: 15_000
  });
  return result.ok && sameResolvedPath(normalizeText(result.stdout || result.output), worktreePath);
}

async function inspectWorktreeDirty(worktreePath = "") {
  let worktreeTree = "";
  try {
    worktreeTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      runCommand: runVibe64Command,
      worktreePath
    });
  } catch (error) {
    throw vibe64Error(
      `Cannot inspect session worktree before archive: ${normalizeText(error?.message)}`,
      "vibe64_worktree_archive_status_failed"
    );
  }
  const [statusResult, headTreeResult] = await Promise.all([
    runGit(worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
      "--ignore-submodules=none"
    ], {
      timeout: 15_000
    }),
    runGit(worktreePath, ["rev-parse", "--verify", "HEAD^{tree}"], {
      timeout: 15_000
    })
  ]);
  if (!statusResult.ok || !headTreeResult.ok) {
    throw vibe64Error(
      `Cannot inspect session worktree before archive: ${
        statusResult.ok ? headTreeResult.output : statusResult.output
      }`,
      "vibe64_worktree_archive_status_failed"
    );
  }
  return Boolean(normalizeText(statusResult.stdout)) ||
    normalizeText(worktreeTree) !== normalizeText(headTreeResult.stdout);
}

function sessionOwnsWorktreePath(session = {}, worktreePath = "") {
  return sameResolvedPath(sessionSourcePath(session), worktreePath);
}

async function removeSessionOwnedWorktreeDirectory({
  session = {},
  worktreePath = ""
} = {}) {
  if (!await pathExists(worktreePath)) {
    return {
      ok: true,
      removed: false
    };
  }
  if (!sessionOwnsWorktreePath(session, worktreePath)) {
    throw vibe64Error(
      `Refusing to remove non-worktree path outside the session-owned worktree location: ${worktreePath}`,
      "vibe64_worktree_remove_path_not_session_owned"
    );
  }
  await rm(worktreePath, {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100
  });
  return {
    ok: true,
    removed: true
  };
}

async function writeDirtyRecoveryArtifacts({
  artifactsRoot = "",
  session = {},
  store,
  worktreePath = ""
} = {}) {
  const dirty = await inspectWorktreeDirty(worktreePath);
  if (!dirty) {
    return {
      dirty: false,
      patchArtifact: "",
      untrackedArtifact: "",
      untrackedCount: 0
    };
  }

  const recoveryRoot = path.join(artifactsRoot, RECOVERY_ARTIFACT_ROOT);
  await mkdir(recoveryRoot, {
    recursive: true
  });

  const patchResult = await runGit(worktreePath, ["diff", "--binary", "HEAD"], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!patchResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session worktree diff before archive: ${patchResult.output}`,
      "vibe64_worktree_archive_patch_failed"
    );
  }
  const patchText = String(patchResult.stdout || "");
  const patchArtifact = normalizeText(patchText)
    ? RECOVERY_PATCH_ARTIFACT
    : "";
  if (patchArtifact) {
    await store.writeArtifact(session.sessionId, patchArtifact, patchText);
  }

  const untrackedResult = await runGit(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ], {
    timeout: 15_000
  });
  if (!untrackedResult.ok) {
    throw vibe64Error(
      `Cannot snapshot untracked session files before archive: ${untrackedResult.output}`,
      "vibe64_worktree_archive_untracked_failed"
    );
  }
  const untrackedPaths = parseNullSeparatedPaths(untrackedResult.stdout);
  if (untrackedPaths.length < 1) {
    return {
      dirty: true,
      patchArtifact,
      untrackedArtifact: "",
      untrackedCount: 0
    };
  }

  const listPath = path.join(artifactsRoot, RECOVERY_UNTRACKED_LIST_ARTIFACT);
  const tarPath = path.join(artifactsRoot, RECOVERY_UNTRACKED_ARTIFACT);
  await mkdir(path.dirname(listPath), {
    recursive: true
  });
  await writeFile(listPath, `${untrackedPaths.join("\0")}\0`, "utf8");
  const tarResult = await runCommand("tar", [
    "--null",
    "-czf",
    tarPath,
    "-T",
    listPath
  ], {
    allowedRoots: [artifactsRoot],
    cwd: worktreePath,
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  await rm(listPath, {
    force: true
  });
  if (!tarResult.ok) {
    throw vibe64Error(
      `Cannot snapshot untracked session files before archive: ${tarResult.output}`,
      "vibe64_worktree_archive_untracked_tar_failed"
    );
  }

  return {
    dirty: true,
    patchArtifact,
    untrackedArtifact: RECOVERY_UNTRACKED_ARTIFACT,
    untrackedCount: untrackedPaths.length
  };
}

async function writeBranchRecoveryBundle({
  artifactsRoot = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (metadataValue(session, "source_kind") !== "session_clone") {
    return metadataValue(session, "source_recovery_bundle_artifact");
  }
  const headResult = await runGit(worktreePath, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
  if (!headResult.ok) {
    return "";
  }
  const baseCommit = metadataValue(session, "base_commit");
  let bundleRef = "HEAD";
  if (baseCommit) {
    const aheadResult = await runGit(worktreePath, ["rev-list", "--count", `${baseCommit}..HEAD`], {
      timeout: 15_000
    });
    if (aheadResult.ok) {
      const commitsAhead = Number(normalizeText(aheadResult.stdout || aheadResult.output));
      if (commitsAhead < 1) {
        return "";
      }
      bundleRef = `${baseCommit}..HEAD`;
    }
  }

  const bundlePath = path.join(artifactsRoot, RECOVERY_BRANCH_BUNDLE_ARTIFACT);
  await mkdir(path.dirname(bundlePath), {
    recursive: true
  });
  const bundleResult = await runGit(worktreePath, ["bundle", "create", bundlePath, bundleRef], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!bundleResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session branch commits before archive: ${bundleResult.output}`,
      "vibe64_worktree_archive_bundle_failed"
    );
  }
  return RECOVERY_BRANCH_BUNDLE_ARTIFACT;
}

async function writeCheckpointRecoveryBundle({
  artifactsRoot = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (metadataValue(session, "source_kind") !== "session_clone") {
    return metadataValue(session, "source_recovery_checkpoint_bundle_artifact");
  }
  const refRoot = checkpointRefRoot(session.sessionId);
  const refsResult = await runGit(worktreePath, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    `${refRoot}/`
  ], {
    timeout: 15_000
  });
  if (!refsResult.ok) {
    throw vibe64Error(
      `Cannot inspect session checkpoints before archive: ${refsResult.output}`,
      "vibe64_worktree_archive_checkpoint_refs_failed"
    );
  }
  const refs = String(refsResult.stdout || "")
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return {
        commit: separator > 0 ? normalizeText(line.slice(0, separator)) : "",
        ref: separator > 0 ? normalizeText(line.slice(separator + 1)) : ""
      };
    });
  if (refs.length < 1) {
    return "";
  }
  if (refs.some(({ commit, ref }) => !commit || !ref.startsWith(`${refRoot}/`))) {
    throw vibe64Error(
      "Session checkpoint refs are not valid durable Git refs.",
      "vibe64_worktree_archive_checkpoint_refs_invalid"
    );
  }

  const recoveryRoot = path.join(artifactsRoot, RECOVERY_ARTIFACT_ROOT);
  const bundlePath = path.join(artifactsRoot, RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT);
  await mkdir(recoveryRoot, {
    recursive: true
  });
  const bundleResult = await runGit(worktreePath, [
    "bundle",
    "create",
    bundlePath,
    ...refs.map(({ ref }) => ref)
  ], {
    allowedRoots: [artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!bundleResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session checkpoints before archive: ${bundleResult.output}`,
      "vibe64_worktree_archive_checkpoint_bundle_failed"
    );
  }
  const verifyResult = await runGit(worktreePath, [
    "bundle",
    "verify",
    bundlePath
  ], {
    allowedRoots: [artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!verifyResult.ok) {
    throw vibe64Error(
      `Session checkpoint bundle could not be validated: ${verifyResult.output}`,
      "vibe64_worktree_archive_checkpoint_bundle_invalid"
    );
  }

  const verificationRoot = await mkdtemp(path.join(recoveryRoot, ".checkpoint-restore-"));
  try {
    const initResult = await runGit(worktreePath, ["init", "--bare", verificationRoot], {
      allowedRoots: [artifactsRoot],
      timeout: 15_000
    });
    if (!initResult.ok) {
      throw vibe64Error(
        `Cannot initialize checkpoint restore verification: ${initResult.output}`,
        "vibe64_worktree_archive_checkpoint_restore_init_failed"
      );
    }
    const fetchResult = await runGit(worktreePath, [
      "--git-dir",
      verificationRoot,
      "fetch",
      bundlePath,
      ...refs.map(({ ref }) => `${ref}:${ref}`)
    ], {
      allowedRoots: [artifactsRoot],
      timeout: SNAPSHOT_TIMEOUT_MS
    });
    if (!fetchResult.ok) {
      throw vibe64Error(
        `Session checkpoint bundle could not be restored: ${fetchResult.output}`,
        "vibe64_worktree_archive_checkpoint_restore_failed"
      );
    }
    const restored = await runGit(worktreePath, [
      "--git-dir",
      verificationRoot,
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      `${refRoot}/`
    ], {
      allowedRoots: [artifactsRoot],
      timeout: 15_000
    });
    if (!restored.ok) {
      throw vibe64Error(
        `Session checkpoint restore verification could not run: ${restored.output}`,
        "vibe64_worktree_archive_checkpoint_restore_verify_failed"
      );
    }
    const restoredRefs = restored.stdout.split("\n").map(normalizeText).filter(Boolean).sort();
    const expectedRefs = refs.map(({ commit, ref }) => `${commit} ${ref}`).sort();
    if (restoredRefs.join("\n") !== expectedRefs.join("\n")) {
      throw vibe64Error(
        "Session checkpoint bundle did not restore the exact checkpoint refs.",
        "vibe64_worktree_archive_checkpoint_restore_mismatch"
      );
    }
  } finally {
    await rm(verificationRoot, {
      force: true,
      recursive: true
    });
  }
  return RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT;
}

function recoveryDetailsFromSession(session = {}) {
  return {
    branch: metadataValue(session, "source_recovery_branch"),
    branchBundleArtifact: metadataValue(session, "source_recovery_bundle_artifact"),
    checkpointBundleArtifact: metadataValue(session, "source_recovery_checkpoint_bundle_artifact"),
    dirty: metadataValue(session, "source_recovery_dirty") === "yes",
    head: metadataValue(session, "source_recovery_head"),
    patchArtifact: metadataValue(session, "source_recovery_patch_artifact"),
    recoverySaved: metadataValue(session, "source_recovery_saved") === "yes",
    recoverySourcePath: metadataValue(session, "source_recovery_source_path"),
    untrackedArtifact: metadataValue(session, "source_recovery_untracked_artifact"),
    untrackedCount: Number(metadataValue(session, "source_recovery_untracked_count") || 0)
  };
}

async function saveSessionSourceRecovery({
  session = {},
  store,
  worktreeIsGitWorktree = false,
  worktreePath = ""
} = {}) {
  const branch = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["branch", "--show-current"], metadataValue(session, "branch"))
    : metadataValue(session, "branch") || metadataValue(session, "source_recovery_branch");
  const head = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"], metadataValue(session, "source_recovery_head"))
    : metadataValue(session, "source_recovery_head");
  const remoteUrl = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["remote", "get-url", "origin"], metadataValue(session, "source_remote_url"))
    : metadataValue(session, "source_recovery_remote_url") || metadataValue(session, "source_remote_url");
  const dirtyArtifacts = worktreeIsGitWorktree
    ? await writeDirtyRecoveryArtifacts({
      artifactsRoot: session.artifactsRoot,
      session,
      store,
      worktreePath
    })
    : {
      dirty: false,
      patchArtifact: metadataValue(session, "source_recovery_patch_artifact"),
      untrackedArtifact: metadataValue(session, "source_recovery_untracked_artifact"),
      untrackedCount: Number(metadataValue(session, "source_recovery_untracked_count") || 0)
    };
  const branchBundleArtifact = worktreeIsGitWorktree
    ? await writeBranchRecoveryBundle({
      artifactsRoot: session.artifactsRoot,
      session,
      worktreePath
    })
    : metadataValue(session, "source_recovery_bundle_artifact");
  const checkpointBundleArtifact = worktreeIsGitWorktree
    ? await writeCheckpointRecoveryBundle({
      artifactsRoot: session.artifactsRoot,
      session,
      worktreePath
    })
    : metadataValue(session, "source_recovery_checkpoint_bundle_artifact");
  const archivedAt = new Date().toISOString();
  const details = {
    branch,
    branchBundleArtifact,
    checkpointBundleArtifact,
    dirty: dirtyArtifacts.dirty,
    head,
    patchArtifact: dirtyArtifacts.patchArtifact,
    recoverySaved: true,
    recoverySourcePath: worktreePath,
    untrackedArtifact: dirtyArtifacts.untrackedArtifact,
    untrackedCount: dirtyArtifacts.untrackedCount || 0
  };
  await writeMetadataValues(store, session.sessionId, {
    source_recovery_base_branch: metadataValue(session, "base_branch"),
    source_recovery_base_commit: metadataValue(session, "base_commit"),
    source_recovery_branch: details.branch,
    source_recovery_bundle_artifact: details.branchBundleArtifact,
    source_recovery_checkpoint_bundle_artifact: details.checkpointBundleArtifact,
    source_recovery_default_branch: metadataValue(session, "source_default_branch") || metadataValue(session, "base_branch"),
    source_recovery_dirty: details.dirty ? "yes" : "no",
    source_recovery_head: details.head,
    source_recovery_kind: metadataValue(session, "source_kind") || metadataValue(session, "source_recovery_kind"),
    source_recovery_patch_artifact: details.patchArtifact,
    source_recovery_remote_url: remoteUrl,
    source_recovery_session_name: recoverySessionName(session),
    source_recovery_saved: "yes",
    source_recovery_saved_at: archivedAt,
    source_recovery_untracked_artifact: details.untrackedArtifact,
    source_recovery_untracked_count: String(details.untrackedCount),
    source_recovery_source_path: worktreePath
  });
  return details;
}

async function validateRecoveryBundle({
  artifact = "",
  expectedArtifact = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (!artifact) {
    return;
  }
  if (artifact !== expectedArtifact) {
    throw vibe64Error(
      `Renewal recovery references an unexpected artifact: ${artifact}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const artifactPath = path.join(session.artifactsRoot, artifact);
  if (!await pathExists(artifactPath)) {
    throw vibe64Error(
      `Renewal recovery artifact is missing: ${artifact}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const verification = await runGit(worktreePath, ["bundle", "verify", artifactPath], {
    allowedRoots: [session.artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!verification.ok) {
    throw vibe64Error(
      `Renewal recovery artifact is invalid: ${artifact}: ${verification.output}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
}

async function validateCleanRenewalRecovery({
  details = {},
  session = {},
  sourcePath = "",
  worktreePath = ""
} = {}) {
  if (
    details.recoverySaved !== true ||
    !sameResolvedPath(details.recoverySourcePath, sourcePath) ||
    details.dirty === true ||
    details.patchArtifact ||
    details.untrackedArtifact ||
    Number(details.untrackedCount || 0) !== 0
  ) {
    throw vibe64Error(
      "A renewal source stage requires complete clean-worktree recovery evidence.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const head = await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"]);
  if (!details.head || head !== details.head) {
    throw vibe64Error(
      "The renewal recovery commit does not match the staged worktree.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const branch = await readWorktreeGitFact(worktreePath, ["branch", "--show-current"]);
  if (details.branch && branch !== details.branch) {
    throw vibe64Error(
      "The renewal recovery branch does not match the staged worktree.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  await validateRecoveryBundle({
    artifact: details.branchBundleArtifact,
    expectedArtifact: RECOVERY_BRANCH_BUNDLE_ARTIFACT,
    session,
    worktreePath
  });
  await validateRecoveryBundle({
    artifact: details.checkpointBundleArtifact,
    expectedArtifact: RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT,
    session,
    worktreePath
  });
}

async function prepareRenewalSessionSource({
  renewalId = "",
  session = {},
  store
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists) {
    throw vibe64Error(
      stageExists
        ? `Renewal source was staged before its durable commit: ${normalizeText(session.sessionId)}`
        : `Renewal source is missing from its active location: ${normalizeText(session.sessionId)}`,
      stageExists
        ? "vibe64_session_renewal_source_prematurely_staged"
        : "vibe64_session_renewal_source_missing"
    );
  }
  if (!sessionOwnsWorktreePath(session, sourcePath) || !await isExactGitWorktree(sourcePath)) {
    throw vibe64Error(
      `Renewal requires the exact session-owned Git worktree: ${sourcePath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  if (await inspectWorktreeDirty(sourcePath)) {
    throw vibe64Error(
      "Renewal requires a clean, saved session source.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  const existingDetails = recoveryDetailsFromSession(session);
  const [currentHead, currentBranch] = await Promise.all([
    readWorktreeGitFact(sourcePath, ["rev-parse", "--verify", "HEAD"]),
    readWorktreeGitFact(sourcePath, ["branch", "--show-current"])
  ]);
  if (
    existingDetails.recoverySaved === true &&
    sameResolvedPath(existingDetails.recoverySourcePath, sourcePath) &&
    existingDetails.head === currentHead &&
    (!existingDetails.branch || existingDetails.branch === currentBranch)
  ) {
    await validateCleanRenewalRecovery({
      details: existingDetails,
      session,
      sourcePath,
      worktreePath: sourcePath
    });
    return {
      changed: false,
      prepared: true,
      renewalId: assertSessionRenewalId(renewalId),
      sessionId: normalizeText(session.sessionId),
      sourcePath,
      stagePath,
      staged: false
    };
  }
  await Promise.all([
    RECOVERY_BRANCH_BUNDLE_ARTIFACT,
    RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT
  ].map((relativePath) => rm(path.join(session.artifactsRoot, relativePath), {
    force: true
  })));
  const details = await saveSessionSourceRecovery({
    session,
    store,
    worktreeIsGitWorktree: true,
    worktreePath: sourcePath
  });
  await validateCleanRenewalRecovery({
    details,
    session,
    sourcePath,
    worktreePath: sourcePath
  });
  if (await inspectWorktreeDirty(sourcePath)) {
    throw vibe64Error(
      "Renewal source changed while its recovery evidence was being prepared.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  return {
    changed: true,
    prepared: true,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: normalizeText(session.sessionId),
    sourcePath,
    stagePath,
    staged: false
  };
}

async function stagePreparedRenewalSessionSource({
  renewalId = "",
  session = {}
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists && !stageExists) {
    throw vibe64Error(
      `Renewal source is missing from both active and staged locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_missing"
    );
  }
  const currentPath = sourceExists ? sourcePath : stagePath;
  if (!sessionOwnsWorktreePath(session, sourcePath) || !await isExactGitWorktree(currentPath)) {
    throw vibe64Error(
      `Renewal requires the exact session-owned Git worktree: ${currentPath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  if (await inspectWorktreeDirty(currentPath)) {
    throw vibe64Error(
      "Renewal requires the exact clean source used for its recovery proof.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  await validateCleanRenewalRecovery({
    details: recoveryDetailsFromSession(session),
    session,
    sourcePath,
    worktreePath: currentPath
  });
  if (sourceExists) {
    if (await inspectWorktreeDirty(sourcePath)) {
      throw vibe64Error(
        "Renewal source changed before its committed stage transition.",
        "vibe64_session_renewal_source_dirty"
      );
    }
    await rename(sourcePath, stagePath);
  }
  return {
    changed: sourceExists,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: normalizeText(session.sessionId),
    sourcePath,
    stagePath,
    staged: true
  };
}

async function restoreRenewalSessionSourceStage({
  renewalId = "",
  session = {}
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists && !stageExists) {
    throw vibe64Error(
      `Renewal source is missing from both active and staged locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_missing"
    );
  }
  const currentPath = stageExists ? stagePath : sourcePath;
  if (!await isExactGitWorktree(currentPath) || await inspectWorktreeDirty(currentPath)) {
    throw vibe64Error(
      `Renewal source stage is no longer the exact clean session Git worktree: ${currentPath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  await validateCleanRenewalRecovery({
    details: recoveryDetailsFromSession(session),
    session,
    sourcePath,
    worktreePath: currentPath
  });
  if (stageExists) {
    await rename(stagePath, sourcePath);
  }
  if (!await isExactGitWorktree(sourcePath)) {
    throw vibe64Error(
      `Restored renewal source is not the exact session Git worktree: ${sourcePath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  return {
    changed: stageExists,
    renewalId: assertSessionRenewalId(renewalId),
    restored: true,
    sessionId: normalizeText(session.sessionId),
    sourcePath,
    stagePath
  };
}

async function commitRenewalSessionSourceStage({
  renewalId = "",
  session = {}
} = {}) {
  if (
    session.archived !== true ||
    normalizeText(session.archiveStatus || session.status) !== "archived" ||
    !normalizeText(session.archivePath) ||
    !normalizeText(session.artifactsRoot)
  ) {
    throw vibe64Error(
      `Renewal source removal requires the published predecessor archive: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_commit_status_invalid"
    );
  }
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const deletionPath = renewalSourceDeletionPath(session, renewalId);
  if (await pathExists(sourcePath)) {
    throw vibe64Error(
      `Refusing to remove a renewal stage while the active source still exists: ${sourcePath}`,
      "vibe64_session_renewal_source_not_staged"
    );
  }
  const [stageExists, deletionExists] = await Promise.all([
    pathExists(stagePath),
    pathExists(deletionPath)
  ]);
  if (stageExists && deletionExists) {
    throw vibe64Error(
      `Renewal source exists in both staged and deleting locations: ${normalizeText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (stageExists) {
    if (!await isExactGitWorktree(stagePath) || await inspectWorktreeDirty(stagePath)) {
      throw vibe64Error(
        `Refusing to remove an invalid renewal source stage: ${stagePath}`,
        "vibe64_session_renewal_source_invalid"
      );
    }
    await validateCleanRenewalRecovery({
      details: recoveryDetailsFromSession(session),
      session,
      sourcePath,
      worktreePath: stagePath
    });
    await rename(stagePath, deletionPath);
  }
  if (stageExists || deletionExists) {
    await rm(deletionPath, {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 100
    });
  }
  return {
    changed: stageExists || deletionExists,
    deletionPath,
    removed: true,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: normalizeText(session.sessionId),
    sourcePath,
    stagePath
  };
}

async function archiveSessionSource({
  reason = "archive",
  session = {},
  store
} = {}) {
  const worktreePath = recoveryWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: true,
      removed: false,
      recoverable: false,
      reason: "worktree_missing"
    };
  }

  const recoveryKind = metadataValue(session, "source_kind") ||
    metadataValue(session, "source_recovery_kind");
  if (recoveryKind !== "session_clone") {
    return {
      ok: true,
      removed: false,
      recoverable: false,
      reason: "not_session_clone"
    };
  }
  const worktreeExists = await pathExists(worktreePath);
  const worktreeIsGitWorktree = worktreeExists
    ? await isExactGitWorktree(worktreePath)
    : false;
  if (worktreeExists && !worktreeIsGitWorktree && !sessionOwnsWorktreePath(session, worktreePath)) {
    throw vibe64Error(
      `Cannot archive session worktree because the path exists but is not the session-owned Git worktree: ${worktreePath}`,
      "vibe64_worktree_archive_path_not_session_owned"
    );
  }
  const sessionId = normalizeText(session.sessionId);
  const recovery = await saveSessionSourceRecovery({
    session,
    store,
    worktreeIsGitWorktree,
    worktreePath
  });

  const removal = await removeSessionOwnedWorktreeDirectory({
    session,
    worktreePath
  });
  await writeMetadataValues(store, sessionId, {
    source_removed: "yes",
    source_removed_at: new Date().toISOString(),
    source_removed_reason: reason
  });
  return {
    ...removal,
    dirty: recovery.dirty,
    worktreePath
  };
}

export {
  archiveSessionSource,
  commitRenewalSessionSourceStage,
  prepareRenewalSessionSource,
  renewalSourceStagePath,
  restoreRenewalSessionSourceStage,
  stagePreparedRenewalSessionSource
};
