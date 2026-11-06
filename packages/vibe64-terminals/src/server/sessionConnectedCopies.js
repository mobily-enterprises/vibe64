// A session's own copies of the repositories its connections file lists, at
// <session>/connected/<name>. Prepare makes the missing ones. Save, Update,
// update checks and Save recovery reach each copy through the same engine as
// the session's own repository: as a GitHub session of that repository whose
// source is the copy and whose branch is the repository's main.
import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  connectedRepositoryName,
  sessionConnectedCopies,
  sessionConnectedCopyPath
} from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import {
  SESSION_BRANCH_PREFIX,
  cloneCanonicalSource,
  githubMirrorCanReference,
  removeClonedDefaultBranch,
  runGit
} from "./sessionSource.js";
import { saveError } from "./sessionWorkCommands.js";
import {
  inspectSessionWork,
  prepareSessionWorkSaveMessage,
  recoverSessionWorkSave,
  retireSessionWorkSave,
  saveSessionWork
} from "./sessionWorkSave.js";
import { checkSessionUpdates, updateSessionWork } from "./sessionWorkUpdate.js";

function connectedCopyRemoteUrl(repository = "") {
  return `https://github.com/${repository}.git`;
}

function shortCommit(commit = "") {
  return normalizeText(commit).slice(0, 12);
}

/**
 * The session as its Git actor sees one copy: a GitHub session of that repository.
 * @param {object} session
 * @param {{ repository: string }} copy
 */
function connectedCopyActorSession(session = {}, copy = {}) {
  return {
    ...session,
    metadata: {
      ...(session.metadata || {}),
      repository_mode: "github",
      source_remote_url: connectedCopyRemoteUrl(copy.repository)
    }
  };
}

/**
 * The session and project the Save and Update engine reads for one copy.
 * @param {object} session
 * @param {object} project the session's own project
 * @param {{ repository: string, branch: string, path: string, baseCommit: string, canonicalCommit: string }} copy
 */
function connectedCopyWork(session = {}, project = {}, copy = {}) {
  const github = { cloneUrl: connectedCopyRemoteUrl(copy.repository), fullName: copy.repository };
  return {
    project: {
      githubMirrorOptional: true,
      githubMirrorPath: "",
      githubRepository: github,
      ownerUserKey: normalizeText(project.ownerUserKey || project.githubRepository?.owner),
      repository: { defaultBranch: copy.branch, github, mode: "github" },
      repositoryMode: "github",
      slug: normalizeText(project.slug || project.projectSlug)
    },
    session: {
      metadata: {
        base_commit: copy.baseCommit,
        canonical_commit: copy.canonicalCommit,
        source_path: copy.path
      },
      sessionId: session.sessionId,
      sourcePath: copy.path
    }
  };
}

/**
 * A failure that names the repository it belongs to, keeping its code.
 * @param {string} name
 * @param {unknown} error
 */
function connectedCopyError(name, error) {
  const message = normalizeText(error?.message) || "It could not be read.";
  return Object.assign(new Error(`Connected repository ${name}: ${message}`), {
    code: normalizeText(error?.code) || "vibe64_connected_copy_failed",
    details: error?.details || {},
    ...(error?.messageCode ? { messageCode: error.messageCode, messageParams: error.messageParams } : {}),
    ...(error?.status ? { status: error.status } : {})
  });
}

async function readDefaultBranch(remoteUrl, cwd, commandOptions) {
  const listing = await runGit(cwd, ["ls-remote", "--symref", remoteUrl, "HEAD"], [cwd], commandOptions);
  const branch = /^ref: refs\/heads\/(\S+)\tHEAD$/mu.exec(listing)?.[1];
  if (!branch) {
    throw saveError("Its repository has no default branch to copy.", "vibe64_connected_copy_branch_missing");
  }
  return branch;
}

async function cloneConnectedCopy({ commandOptions, mirror, repository, runCommand, sessionId, sourcePath }) {
  const name = connectedRepositoryName(repository);
  const copyPath = sessionConnectedCopyPath(sourcePath, name);
  const parent = path.dirname(copyPath);
  await mkdir(parent, { recursive: true });
  if (await lstat(copyPath).catch(() => null)) {
    throw saveError(
      `A folder this session did not record is already at ${copyPath}. Move it away, then prepare the workspace again.`,
      "vibe64_connected_copy_path_exists"
    );
  }
  const remoteUrl = connectedCopyRemoteUrl(repository);
  const branch = await readDefaultBranch(remoteUrl, parent, commandOptions);
  const referenceRoot = mirror?.mirrorPath && await githubMirrorCanReference({
    mirrorPath: mirror.mirrorPath,
    remoteUrl: mirror.remoteUrl,
    runCommand
  }) ? mirror.mirrorPath : "";
  const cloned = await cloneCanonicalSource({
    branch,
    commandOptions,
    referenceRoot,
    source: remoteUrl,
    sourceParent: parent,
    sourcePath: copyPath
  });
  const sessionBranch = `${SESSION_BRANCH_PREFIX}${sessionId}`;
  const roots = [parent, copyPath];
  await runGit(copyPath, ["checkout", "-B", sessionBranch, cloned.commit], roots, { runCommand });
  await removeClonedDefaultBranch({
    allowedRoots: roots,
    baselineCommit: cloned.commit,
    clonedBranch: branch,
    commandOptions: { runCommand },
    sessionBranch,
    sourcePath: copyPath
  });
  return { name, repository, branch, path: copyPath, baseCommit: cloned.commit, canonicalCommit: cloned.commit };
}

/**
 * A copy no longer listed goes only when nothing in it is unsaved: a clean
 * worktree with no commit its main lacks.
 */
async function copyHoldsNoWork(copy, runCommand) {
  const roots = [path.dirname(copy.path), copy.path];
  if (!(await lstat(copy.path).catch(() => null))?.isDirectory()) return true;
  const status = await runGit(copy.path, ["status", "--porcelain=v1", "--untracked-files=normal"], roots, { runCommand });
  if (status) return false;
  return await runGit(copy.path, ["rev-list", "--count", `${copy.canonicalCommit}..HEAD`], roots, { runCommand }) === "0";
}

/**
 * Prepare's part: a copy for every listed repository that has none, from its
 * default branch, through a local GitHub mirror of it when one exists and then
 * dissociated from it. An existing copy is never fetched, reset or replaced.
 * A copy whose repository is no longer listed is removed only when it holds no
 * work. Each new copy is recorded as soon as it exists.
 * @param {object} input
 * @param {object} input.commandOptions the clones' GitHub credentials, with their runCommand
 * @param {Array<{ fullName: string }>} input.connections the listed repositories, in order
 * @param {(fullName: string) => Promise<{ mirrorPath: string, remoteUrl: string } | null>} input.mirrorFor
 * @param {string} input.ownRepository this project's own GitHub owner/name, lowercased, if any
 * @param {typeof runVibe64Command} [input.runCommand]
 * @param {object} input.session
 * @param {(copies: object[]) => Promise<void>} input.writeCopies
 */
async function prepareConnectedCopies({
  commandOptions = {},
  connections = [],
  mirrorFor = async () => null,
  ownRepository = "",
  runCommand = runVibe64Command,
  session,
  writeCopies
}) {
  const sourcePath = sessionSourcePath(session);
  if (!sourcePath) {
    throw saveError("This session has no source checkout to keep connected repositories beside.", "vibe64_connected_copy_source_missing");
  }
  const recorded = sessionConnectedCopies(session);
  const copies = [];
  const lines = [];
  const unlisted = () => recorded.filter(copy => !connections.some(({ fullName }) => fullName === copy.repository));
  for (const { fullName: repository } of connections) {
    const name = connectedRepositoryName(repository);
    try {
      if (repository === ownRepository) {
        throw saveError(
          "It is this project's own repository. Remove it from vibe64.connections.json.",
          "vibe64_connected_source_self_reference"
        );
      }
      const existing = recorded.find(copy => copy.repository === repository);
      if (existing) {
        if (!(await lstat(existing.path).catch(() => null))?.isDirectory()) {
          throw saveError(`This session's copy is missing from ${existing.path}.`, "vibe64_connected_copy_missing");
        }
        copies.push(existing);
        lines.push(`[Connected] ${name} ready at ${shortCommit(existing.baseCommit)}.`);
        continue;
      }
      const copy = await cloneConnectedCopy({
        commandOptions,
        mirror: await mirrorFor(repository),
        repository,
        runCommand,
        sessionId: session.sessionId,
        sourcePath
      });
      copies.push(copy);
      await writeCopies([...copies, ...recorded.filter(item => !copies.some(made => made.repository === item.repository))]);
      lines.push(`[Connected] ${name} copied at ${shortCommit(copy.baseCommit)}.`);
    } catch (error) {
      throw connectedCopyError(name, error);
    }
  }
  for (const copy of unlisted()) {
    if (await copyHoldsNoWork(copy, runCommand)) {
      await rm(copy.path, { force: true, recursive: true });
      lines.push(`[Connected] ${copy.name} removed; it is no longer listed.`);
    } else {
      copies.push(copy);
      lines.push(`[Connected] ${copy.name} kept: it is no longer listed but has unsaved work. Save it, then prepare again.`);
    }
  }
  await writeCopies(copies);
  return { copies, lines };
}

/**
 * Each copy's work as the session's own inspection reads it, without the
 * network. A copy that cannot be read counts as unsaved, so nothing treats
 * its work as safe to lose.
 * @param {object} input
 * @param {object[]} input.copies
 * @param {string[]} input.derivedArtifactPaths
 * @param {object} input.project
 * @param {typeof runVibe64Command} [input.runCommand]
 * @param {object} input.session
 */
function inspectConnectedCopies({ copies = [], derivedArtifactPaths = [], project = {}, runCommand, session = {} }) {
  return Promise.all(copies.map(async (copy) => {
    const work = connectedCopyWork(session, project, copy);
    const listed = { name: copy.name, path: copy.path, repository: copy.repository };
    try {
      const inspected = await inspectSessionWork({
        derivedArtifactPaths,
        project: work.project,
        ...(runCommand ? { runCommand } : {}),
        session: work.session
      });
      return {
        ...listed,
        behind: Number(inspected.behind || 0),
        changedPathCount: inspected.changedPaths?.length || 0,
        status: "ready",
        unsaved: inspected.unsaved === true
      };
    } catch (error) {
      return { ...listed, behind: 0, changedPathCount: 0, error: normalizeText(error?.message), status: "unavailable", unsaved: true };
    }
  }));
}

/**
 * Each copy against its main, as the session's own update check: whether it
 * is behind and the main commit it saw.
 * @param {object} input
 * @param {object[]} input.copies
 * @param {(copy: object) => Promise<{ commandOptions: object, runCommand: Function }>} input.executionFor
 * @param {string} input.operationId
 * @param {object} input.project
 * @param {Function} [input.runProjectSourceExclusive]
 * @param {object} input.session
 */
async function checkConnectedCopies({ copies = [], executionFor, operationId, project, runProjectSourceExclusive, session }) {
  const checks = [];
  for (const copy of copies) {
    const work = connectedCopyWork(session, project, copy);
    try {
      const execution = await executionFor(copy);
      const check = await checkSessionUpdates({
        commandOptions: execution.commandOptions,
        operationId,
        project: work.project,
        runCommand: execution.runCommand,
        runProjectSourceExclusive,
        session: work.session
      });
      checks.push({
        ahead: check.ahead,
        behind: check.behind,
        canonicalCommit: check.canonicalCommit,
        name: copy.name,
        reconciled: check.reconciled === true,
        repository: copy.repository,
        sessionCurrent: check.sessionCurrent === true,
        updateAvailable: check.updateAvailable === true
      });
    } catch (error) {
      throw connectedCopyError(copy.name, error);
    }
  }
  return checks;
}

function updateFirstError(name) {
  return saveError(
    `${name} has newer saved work. Update this session before saving its work.`,
    "vibe64_session_save_update_required",
    { connectedRepository: name, updateRequired: true },
    { messageCode: "vibe64_session_save_branch_changed" }
  );
}

/**
 * Save's part for the copies. It first proves that no copy is behind its main
 * and then runs `beforePush` (the session's own check), so a behind
 * repository refuses Save before anything is pushed. It then saves each copy
 * that has work, in order, and records its new commit before the next one; a
 * refusal stops there. The caller saves the session's own repository last.
 * @param {object} input
 * @param {() => Promise<void>} [input.beforePush]
 * @param {object[]} input.copies
 * @param {string[]} input.derivedArtifactPaths
 * @param {(copy: object) => Promise<{ commandOptions: object, runCommand: Function }>} input.executionFor
 * @param {(prepared: { changes: object, checkpoint: object }, copy: object) => Promise<string>} input.nameSave
 * @param {(cacheMaintenance: object) => void} [input.onCacheMaintenance]
 * @param {(progress: object) => Promise<void>} [input.onProgress]
 * @param {string} input.operationId
 * @param {object} input.project
 * @param {(commits: object) => Promise<void>} input.recordCommits
 * @param {Function} [input.runProjectSourceExclusive]
 * @param {object} input.session
 * @returns {Promise<Array<{ name: string, saveCommit: string }>>} the copies saved
 */
async function saveConnectedCopies({
  beforePush = doNothing,
  copies = [],
  derivedArtifactPaths = [],
  executionFor,
  nameSave,
  onCacheMaintenance = doNothing,
  onProgress = doNothing,
  operationId,
  project,
  recordCommits,
  runProjectSourceExclusive,
  session
}) {
  const ready = [];
  for (const copy of copies) {
    const work = connectedCopyWork(session, project, copy);
    let options;
    let unsaved;
    try {
      const execution = await executionFor(copy);
      options = {
        commandOptions: execution.commandOptions,
        project: work.project,
        runCommand: execution.runCommand,
        session: work.session
      };
      const check = await checkSessionUpdates({ ...options, operationId, runProjectSourceExclusive });
      if (check.updateAvailable === true) throw updateFirstError(copy.name);
      unsaved = (await inspectSessionWork({ ...options, derivedArtifactPaths })).unsaved === true;
    } catch (error) {
      if (error?.code === "vibe64_session_save_update_required") throw error;
      throw connectedCopyError(copy.name, error);
    }
    if (unsaved) ready.push({ copy, options });
  }
  await beforePush();
  const saved = [];
  for (const { copy, options } of ready) {
    let result;
    try {
      await onProgress({ kind: "connected", message: `Saving ${copy.name}.`, stage: "connected-saving" });
      const prepared = await prepareSessionWorkSaveMessage({ ...options, derivedArtifactPaths, operationId });
      result = await saveSessionWork({
        ...options,
        checkpoint: prepared.checkpoint,
        derivedArtifactPaths,
        message: await nameSave(prepared, copy),
        onCacheMaintenance,
        operationId,
        runProjectSourceExclusive
      });
    } catch (error) {
      if (error?.code === "vibe64_session_save_update_required") throw updateFirstError(copy.name);
      throw connectedCopyError(copy.name, error);
    }
    await recordCommits({
      [copy.name]: { canonicalCommit: result.saveCommit, ...(result.reconciled === true ? { baseCommit: result.saveCommit } : {}) }
    });
    await retireSessionWorkSave({ ...options, operationId });
    saved.push({ name: copy.name, saveCommit: result.saveCommit });
    await onProgress({
      kind: "connected",
      message: `[Connected] ${copy.name} saved at ${shortCommit(result.saveCommit)}.`,
      stage: "connected-saved"
    });
  }
  return saved;
}

/**
 * Update's part for the copies: each is rebased onto its main as the
 * session's own repository is. A copy that cannot be updated (a conflict)
 * stays exactly as it was and the others still update. Each result has the
 * line Update reports for it.
 * @param {object} input
 * @param {() => Promise<void>} [input.beforeSourceChange]
 * @param {object[]} input.copies
 * @param {string[]} input.derivedArtifactPaths
 * @param {(copy: object) => Promise<{ commandOptions: object, runCommand: Function }>} input.executionFor
 * @param {string} input.operationId
 * @param {object} input.project
 * @param {(commits: object) => Promise<void>} input.recordCommits
 * @param {Function} [input.runProjectSourceExclusive]
 * @param {object} input.session
 * @param {AbortSignal | null} [input.signal]
 */
async function updateConnectedCopies({
  beforeSourceChange = doNothing,
  copies = [],
  derivedArtifactPaths = [],
  executionFor,
  operationId,
  project,
  recordCommits,
  runProjectSourceExclusive,
  session,
  signal = null
}) {
  const results = [];
  for (const copy of copies) {
    const work = connectedCopyWork(session, project, copy);
    try {
      const execution = await executionFor(copy);
      const result = await updateSessionWork({
        beforeSourceChange,
        commandOptions: execution.commandOptions,
        derivedArtifactPaths,
        operationId,
        project: work.project,
        runCommand: execution.runCommand,
        runProjectSourceExclusive,
        session: work.session,
        signal
      });
      await recordCommits({
        [copy.name]: {
          canonicalCommit: result.canonicalCommit,
          ...(result.reconciled === true ? { baseCommit: result.canonicalCommit } : {})
        }
      });
      results.push({
        canonicalCommit: result.canonicalCommit,
        line: result.status === "already_current"
          ? `[Connected] ${copy.name} was already current.`
          : `[Connected] ${copy.name} updated to ${shortCommit(result.canonicalCommit)}.`,
        name: copy.name,
        status: result.status
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = normalizeText(error?.message) || "It could not be updated.";
      results.push({
        code: normalizeText(error?.code),
        conflictPaths: Array.isArray(error?.details?.conflictPaths) ? error.details.conflictPaths : [],
        error: message,
        line: `[Connected] ${copy.name} was not updated and is unchanged: ${message}`,
        name: copy.name,
        status: "failed"
      });
    }
  }
  return results;
}

/**
 * Recovers the copies an interrupted Save had pushed but not yet recorded,
 * from the evidence each copy's own repository keeps for that operation. A
 * copy that the Save never pushed, or already recorded, is left as it is.
 * @param {object} input
 * @param {object[]} input.copies
 * @param {(copy: object) => Promise<{ commandOptions: object, runCommand: Function }>} input.executionFor
 * @param {string} input.operationId
 * @param {object} input.project
 * @param {(commits: object) => Promise<void>} input.recordCommits
 * @param {Function} [input.runProjectSourceExclusive]
 * @param {object} input.session
 */
async function recoverConnectedCopySaves({
  copies = [], executionFor, operationId, project, recordCommits, runProjectSourceExclusive, session
}) {
  const recovered = [];
  if (!normalizeText(operationId)) return recovered;
  for (const copy of copies) {
    const work = connectedCopyWork(session, project, copy);
    try {
      const execution = await executionFor(copy);
      const options = {
        commandOptions: execution.commandOptions, project: work.project, runCommand: execution.runCommand, session: work.session
      };
      const result = await recoverSessionWorkSave({ ...options, recovery: { operationId }, runProjectSourceExclusive });
      await recordCommits({
        [copy.name]: { canonicalCommit: result.saveCommit, ...(result.reconciled === true ? { baseCommit: result.saveCommit } : {}) }
      });
      await retireSessionWorkSave({ ...options, operationId });
      recovered.push({ name: copy.name, saveCommit: result.saveCommit });
    } catch (error) {
      if (error?.code === "vibe64_session_save_interrupted_retryable") continue;
      throw connectedCopyError(copy.name, error);
    }
  }
  return recovered;
}

export {
  checkConnectedCopies,
  connectedCopyActorSession,
  connectedCopyRemoteUrl,
  connectedCopyWork,
  inspectConnectedCopies,
  prepareConnectedCopies,
  recoverConnectedCopySaves,
  saveConnectedCopies,
  updateConnectedCopies
};
