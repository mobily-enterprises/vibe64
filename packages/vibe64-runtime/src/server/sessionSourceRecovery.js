import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { checkpointRefRoot } from "@local/vibe64-execution/server";

import {
  inspectWorktreeDirty,
  metadataValue,
  parseNullSeparatedPaths,
  readWorktreeGitFact,
  RECOVERY_ARTIFACT_ROOT,
  RECOVERY_BRANCH_BUNDLE_ARTIFACT,
  RECOVERY_PATCH_ARTIFACT,
  RECOVERY_UNTRACKED_ARTIFACT,
  RECOVERY_UNTRACKED_LIST_ARTIFACT,
  recoverySessionName,
  runCommand,
  runGit,
  SNAPSHOT_TIMEOUT_MS,
  writeMetadataValues
} from "./sessionWorktreeGit.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

const SESSION_RECOVERY_ARTIFACTS = Object.freeze({
  branchBundle: RECOVERY_BRANCH_BUNDLE_ARTIFACT,
  patch: RECOVERY_PATCH_ARTIFACT,
  root: RECOVERY_ARTIFACT_ROOT,
  untracked: RECOVERY_UNTRACKED_ARTIFACT,
  untrackedList: RECOVERY_UNTRACKED_LIST_ARTIFACT
});

/**
 * The same recovery artifacts for one connected copy, below recovery/connected/<name>/.
 * @param {string} name
 */
function connectedCopyRecoveryArtifacts(name) {
  const root = `${RECOVERY_ARTIFACT_ROOT}/connected/${name}`;
  return Object.freeze(Object.fromEntries(Object.entries(SESSION_RECOVERY_ARTIFACTS).map(([key, artifact]) => [
    key,
    key === "root" ? root : `${root}/${path.posix.basename(artifact)}`
  ])));
}

/**
 * Recovery of a session's source before it is archived: its uncommitted work
 * and branch as artifacts, and the details saved for restoring them. Its turn
 * checkpoints go to Project Backups (`backUpCheckpoints`).
 * @param {object} request
 * @param {string} [request.artifactsRoot]
 * @param {object} [request.session]
 * @param {Vibe64SessionStore} request.store
 * @param {string} [request.worktreePath]
 * @param {typeof SESSION_RECOVERY_ARTIFACTS} [request.artifacts] where in the session's artifacts they go
 */
async function writeDirtyRecoveryArtifacts({
  artifacts = SESSION_RECOVERY_ARTIFACTS,
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

  const recoveryRoot = path.join(artifactsRoot, artifacts.root);
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
  const patchArtifact = toText(patchText)
    ? artifacts.patch
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

  const listPath = path.join(artifactsRoot, artifacts.untrackedList);
  const tarPath = path.join(artifactsRoot, artifacts.untracked);
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
    untrackedArtifact: artifacts.untracked,
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
  return writeBranchBundle({
    artifact: RECOVERY_BRANCH_BUNDLE_ARTIFACT,
    artifactsRoot,
    baseCommit: metadataValue(session, "base_commit"),
    worktreePath
  });
}

/**
 * The worktree's commits since `baseCommit` as a bundle, or "" when it has none.
 */
async function writeBranchBundle({ artifact, artifactsRoot, baseCommit, worktreePath }) {
  const headResult = await runGit(worktreePath, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
  if (!headResult.ok) {
    return "";
  }
  let bundleRef = "HEAD";
  if (baseCommit) {
    const aheadResult = await runGit(worktreePath, ["rev-list", "--count", `${baseCommit}..HEAD`], {
      timeout: 15_000
    });
    if (aheadResult.ok) {
      const commitsAhead = Number(toText(aheadResult.stdout || aheadResult.output));
      if (commitsAhead < 1) {
        return "";
      }
      bundleRef = `${baseCommit}..HEAD`;
    }
  }

  const bundlePath = path.join(artifactsRoot, artifact);
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
  return artifact;
}

/**
 * The Project Backups file of a session's turn checkpoints, named after the
 * session (and the connected copy, for a copy's) so a person can tell whose it is.
 * @param {object} session
 * @param {string} [copyName]
 */
function checkpointBackupFileName(session = {}, copyName = "") {
  const slug = (value = "") => toText(value).toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-").slice(0, 48).replace(/^-+|-+$/gu, "");
  const sessionId = toText(session.sessionId);
  const name = slug(recoverySessionName(session));
  const parts = [name === slug(sessionId) ? "" : name, sessionId, slug(copyName)].filter(Boolean);
  return `session-checkpoints-${parts.join("-")}.bundle`;
}

/**
 * A repository's turn checkpoints as one bundle in the project's Project
 * Backups. It holds only what the base commit's history lacks, so it takes the
 * checkpoints' own size, not the repository's, and is proven to restore every
 * checkpoint exactly from that history and the bundle alone. It never fails the
 * caller: archive and renewal go on without it, with the reason recorded.
 * @param {object} request
 * @param {string} request.artifactsRoot where the restore proof runs
 * @param {string} request.baseCommit the commit the session last took from its main
 * @param {string} request.fileName
 * @param {string} request.sessionId
 * @param {Vibe64SessionStore} request.store whose project's Project Backups receive it
 * @param {string} request.worktreePath
 * @returns {Promise<{ checkpointBackup: string, checkpointBackupError: string }>}
 */
async function backUpCheckpoints({ artifactsRoot, baseCommit, fileName, sessionId, store, worktreePath }) {
  let backupPath = "";
  try {
    const backupsRoot = toText(store.paths().projectBackupsRoot);
    if (backupsRoot) {
      await store.prepareProjectFileAreas();
      backupPath = path.join(backupsRoot, fileName);
    }
    const written = await writeCheckpointBackup({ artifactsRoot, backupPath, baseCommit, sessionId, worktreePath });
    return { checkpointBackup: written ? fileName : "", checkpointBackupError: "" };
  } catch (error) {
    if (backupPath) await rm(backupPath, { force: true }).catch(() => {});
    return {
      checkpointBackup: "",
      checkpointBackupError: toText(error?.message) || "The session's turn checkpoints could not be backed up."
    };
  }
}

/**
 * Writes the bundle and its proof within one SNAPSHOT_TIMEOUT_MS, or throws why not.
 * @returns {Promise<boolean>} whether the worktree had checkpoints to back up
 */
async function writeCheckpointBackup({ artifactsRoot, backupPath, baseCommit, sessionId, worktreePath }) {
  const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS;
  const timeLeft = () => {
    const left = deadline - Date.now();
    if (left < 1) throw new Error(`Backing up the session's turn checkpoints took longer than ${SNAPSHOT_TIMEOUT_MS / 1000} s.`);
    return left;
  };
  const refRoot = checkpointRefRoot(sessionId);
  const refsResult = await runGit(worktreePath, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    `${refRoot}/`
  ], {
    timeout: Math.min(15_000, timeLeft())
  });
  if (!refsResult.ok) {
    throw new Error(`Cannot read the session's turn checkpoints: ${refsResult.output}`);
  }
  const refs = String(refsResult.stdout || "")
    .split("\n")
    .map((line) => toText(line))
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return {
        commit: separator > 0 ? toText(line.slice(0, separator)) : "",
        ref: separator > 0 ? toText(line.slice(separator + 1)) : ""
      };
    });
  if (refs.length < 1) {
    return false;
  }
  if (refs.some(({ commit, ref }) => !commit || !ref.startsWith(`${refRoot}/`))) {
    throw new Error("Session checkpoint refs are not valid durable Git refs.");
  }
  if (!backupPath) {
    throw new Error("This project has no Project Backups folder for the session's turn checkpoints.");
  }
  // Restore starts from the project's own history, which has the base commit:
  // the bundle leaves out everything that history already holds.
  const base = baseCommit
    ? toText((await runGit(worktreePath, ["rev-parse", "--verify", "--quiet", `${baseCommit}^{commit}`], {
      timeout: Math.min(15_000, timeLeft())
    })).stdout)
    : "";
  await mkdir(path.dirname(backupPath), { recursive: true });
  const allowedRoots = [artifactsRoot, path.dirname(backupPath)];
  const bundleResult = await runGit(worktreePath, [
    "bundle",
    "create",
    backupPath,
    ...refs.map(({ ref }) => ref),
    ...(base ? ["--not", base] : [])
  ], {
    allowedRoots,
    timeout: timeLeft()
  });
  if (!bundleResult.ok) {
    throw new Error(`Cannot bundle the session's turn checkpoints: ${bundleResult.output}`);
  }
  const verifyResult = await runGit(worktreePath, ["bundle", "verify", backupPath], {
    allowedRoots,
    timeout: timeLeft()
  });
  if (!verifyResult.ok) {
    throw new Error(`The session's checkpoint bundle could not be validated: ${verifyResult.output}`);
  }
  await proveCheckpointRestore({ artifactsRoot, backupPath, base, refs, timeLeft, worktreePath });
  return true;
}

/**
 * Unbundles the bundle into an empty repository that sees the worktree's
 * objects (Git alternates) only for the prerequisites it names, checks that it
 * lists every checkpoint at its exact commit, then, with those objects out of
 * sight again, that its own pack holds every object the checkpoints need beyond
 * the base commit's history. A fetch would prove nothing here: seeing every
 * object through the alternates, it skips the bundle's pack. All of it reads the
 * checkpoints' own objects and the base commit's tree, never the history.
 */
async function proveCheckpointRestore({ artifactsRoot, backupPath, base, refs, timeLeft, worktreePath }) {
  const recoveryRoot = path.join(artifactsRoot, RECOVERY_ARTIFACT_ROOT);
  await mkdir(recoveryRoot, { recursive: true });
  const verificationRoot = await mkdtemp(path.join(recoveryRoot, ".checkpoint-restore-"));
  const allowedRoots = [artifactsRoot, path.dirname(backupPath)];
  const inVerification = (args) => runGit(worktreePath, ["--git-dir", verificationRoot, ...args], {
    allowedRoots,
    timeout: timeLeft()
  });
  try {
    const initResult = await runGit(worktreePath, ["init", "--bare", verificationRoot], {
      allowedRoots,
      timeout: Math.min(15_000, timeLeft())
    });
    if (!initResult.ok) {
      throw new Error(`Cannot initialize checkpoint restore verification: ${initResult.output}`);
    }
    const alternatesPath = path.join(verificationRoot, "objects", "info", "alternates");
    if (base) {
      const objectsResult = await runGit(worktreePath, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], {
        timeout: Math.min(15_000, timeLeft())
      });
      const objectsRoot = toText(objectsResult.stdout);
      if (!objectsResult.ok || !path.isAbsolute(objectsRoot)) {
        throw new Error(`Cannot find the session's Git objects for checkpoint restore verification: ${objectsResult.output}`);
      }
      await mkdir(path.dirname(alternatesPath), { recursive: true });
      await writeFile(alternatesPath, `${objectsRoot}\n`, "utf8");
      // A ref at the base keeps Git's connectivity checks to the checkpoints' own objects.
      const baseResult = await inVerification(["update-ref", "refs/vibe64-restore/base", base]);
      if (!baseResult.ok) {
        throw new Error(`Cannot mark the base commit for checkpoint restore verification: ${baseResult.output}`);
      }
    }
    const unbundled = await inVerification(["bundle", "unbundle", backupPath]);
    if (!unbundled.ok) {
      throw new Error(`The session's checkpoint bundle could not be restored: ${unbundled.output}`);
    }
    const restoredRefs = unbundled.stdout.split("\n").map(toText).filter(Boolean).sort();
    const expectedRefs = refs.map(({ commit, ref }) => `${commit} ${ref}`).sort();
    if (restoredRefs.join("\n") !== expectedRefs.join("\n")) {
      throw new Error("The session's checkpoint bundle did not restore the exact checkpoint refs.");
    }
    const needed = await inVerification([
      "rev-list",
      "--objects",
      ...refs.map(({ commit }) => commit),
      ...(base ? ["--not", base] : [])
    ]);
    if (!needed.ok) {
      throw new Error(`Checkpoint restore verification could not list the checkpoints' objects: ${needed.output}`);
    }
    await rm(alternatesPath, { force: true });
    const held = await inVerification(["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"]);
    if (!held.ok) {
      throw new Error(`Checkpoint restore verification could not list the bundle's objects: ${held.output}`);
    }
    const heldObjects = new Set(held.stdout.split("\n").map(toText).filter(Boolean));
    const missing = needed.stdout.split("\n")
      .map((line) => toText(line).split(" ")[0])
      .filter((objectId) => objectId && !heldObjects.has(objectId));
    if (missing.length) {
      throw new Error(`The session's checkpoint bundle lacks ${missing.length} objects its checkpoints need.`);
    }
  } finally {
    await rm(verificationRoot, {
      force: true,
      recursive: true
    });
  }
}

function recoveryDetailsFromSession(session = {}) {
  return {
    branch: metadataValue(session, "source_recovery_branch"),
    branchBundleArtifact: metadataValue(session, "source_recovery_bundle_artifact"),
    checkpointBackup: metadataValue(session, "source_recovery_checkpoint_backup"),
    checkpointBackupError: metadataValue(session, "source_recovery_checkpoint_backup_error"),
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
  const checkpoints = worktreeIsGitWorktree && metadataValue(session, "source_kind") === "session_clone"
    ? await backUpCheckpoints({
      artifactsRoot: session.artifactsRoot,
      baseCommit: metadataValue(session, "base_commit"),
      fileName: checkpointBackupFileName(session),
      sessionId: session.sessionId,
      store,
      worktreePath
    })
    : {
        checkpointBackup: metadataValue(session, "source_recovery_checkpoint_backup"),
        checkpointBackupError: metadataValue(session, "source_recovery_checkpoint_backup_error")
      };
  const archivedAt = new Date().toISOString();
  const details = {
    branch,
    branchBundleArtifact,
    checkpointBackup: checkpoints.checkpointBackup,
    checkpointBackupError: checkpoints.checkpointBackupError,
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
    source_recovery_checkpoint_backup: details.checkpointBackup,
    source_recovery_checkpoint_backup_error: details.checkpointBackupError,
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

/**
 * Recovery of each connected copy before the session's source goes: its
 * uncommitted work and commits since its recorded base, below
 * recovery/connected/<name>/, and its turn checkpoints in Project Backups,
 * recorded in connected_copies_recovery. A copy whose folder is gone keeps its
 * earlier record.
 * @param {{ session: object, store: Vibe64SessionStore }} request
 */
async function saveConnectedCopiesRecovery({ session = {}, store } = {}) {
  const copies = sessionConnectedCopies(session);
  if (!copies.length) return {};
  let recorded = {};
  try {
    recorded = JSON.parse(metadataValue(session, "connected_copies_recovery") || "{}");
  } catch { /* An unreadable earlier record is replaced by this one. */ }
  const details = {};
  for (const copy of copies) {
    const isWorktree = await pathExists(copy.path) &&
      toText((await runGit(copy.path, ["rev-parse", "--show-toplevel"], { timeout: 15_000 })).stdout) === path.resolve(copy.path);
    if (!isWorktree) {
      if (recorded[copy.name]) details[copy.name] = recorded[copy.name];
      continue;
    }
    const artifacts = connectedCopyRecoveryArtifacts(copy.name);
    await rm(path.join(session.artifactsRoot, artifacts.root), { force: true, recursive: true });
    const dirty = await writeDirtyRecoveryArtifacts({
      artifacts, artifactsRoot: session.artifactsRoot, session, store, worktreePath: copy.path
    });
    details[copy.name] = {
      baseCommit: copy.baseCommit,
      branch: await readWorktreeGitFact(copy.path, ["branch", "--show-current"]),
      branchBundleArtifact: await writeBranchBundle({
        artifact: artifacts.branchBundle,
        artifactsRoot: session.artifactsRoot,
        baseCommit: copy.baseCommit,
        worktreePath: copy.path
      }),
      ...await backUpCheckpoints({
        artifactsRoot: session.artifactsRoot,
        baseCommit: copy.baseCommit,
        fileName: checkpointBackupFileName(session, copy.name),
        sessionId: session.sessionId,
        store,
        worktreePath: copy.path
      }),
      dirty: dirty.dirty,
      head: await readWorktreeGitFact(copy.path, ["rev-parse", "--verify", "HEAD"]),
      patchArtifact: dirty.patchArtifact,
      repository: copy.repository,
      sourcePath: copy.path,
      untrackedArtifact: dirty.untrackedArtifact,
      untrackedCount: dirty.untrackedCount || 0
    };
  }
  await store.writeMetadataValue(session.sessionId, "connected_copies_recovery", JSON.stringify(details));
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
      "vibe64_session_renewal_recovery_artifact_unexpected",
      { params: { artifact } }
    );
  }
  const artifactPath = path.join(session.artifactsRoot, artifact);
  if (!await pathExists(artifactPath)) {
    throw vibe64Error(
      `Renewal recovery artifact is missing: ${artifact}`,
      "vibe64_session_renewal_recovery_artifact_missing",
      { params: { artifact } }
    );
  }
  const verification = await runGit(worktreePath, ["bundle", "verify", artifactPath], {
    allowedRoots: [session.artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!verification.ok) {
    throw vibe64Error(
      `Renewal recovery artifact is invalid: ${artifact}: ${verification.output}`,
      "vibe64_session_renewal_recovery_invalid",
      { params: { artifact } }
    );
  }
}

export {
  connectedCopyRecoveryArtifacts,
  recoveryDetailsFromSession,
  saveConnectedCopiesRecovery,
  saveSessionSourceRecovery,
  validateRecoveryBundle
};
