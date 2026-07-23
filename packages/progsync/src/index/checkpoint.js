import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_GIT_BASE,
  PROGSYNC_STATE_REF,
  PROGSYNC_STATE_SCHEMA_VERSION
} from "./constants.js";
import { ProgSyncError } from "./errors.js";
import {
  assertGitRepository,
  currentGitContext,
  gitResult,
  isGitAncestor,
  parseNulPaths,
  readGitFile,
  readGitFiles,
  readWorkingFile,
  readWorkingFiles,
  resolveGitBase,
  resolveOptionalCommit,
  runGit
} from "./git.js";
import { auxiliaryRootForImplementationPath } from "./paths.js";
import { stableJson } from "./program.js";
import { fileChanged, ownedFilesChanged, pairDigest, sourceHash } from "./state.js";

const MAX_STATE_WRITE_ATTEMPTS = 8;

function pairId(pair) {
  return `sha256:${pairDigest(pair)}`;
}

function receiptPathForPair(pair) {
  const digest = pairDigest(pair);
  return `.progsync/pairs/${digest.slice(0, 2)}/${digest}.json`;
}

function prefixedSourceHash(file) {
  const digest = sourceHash(file);
  return digest ? `sha256:${digest}` : null;
}

function fileState(previous, current) {
  if (!previous.exists && !current.exists) {
    return "missing";
  }
  if (!previous.exists && current.exists) {
    return "untracked";
  }
  if (previous.exists && !current.exists) {
    return "deleted";
  }
  return fileChanged(previous, current) ? "modified" : "unchanged";
}

function checkpointCorrupt(message, details = {}) {
  throw new ProgSyncError("PROGSYNC_STATE_CORRUPT", message, details);
}

function parseReceipt(source, { pair, receiptPath, stateCommit }) {
  let receipt;
  try {
    receipt = JSON.parse(source);
  } catch (error) {
    checkpointCorrupt("ProgSync's private pair receipt is not valid JSON.", {
      cause: error.message,
      receiptPath,
      stateCommit
    });
  }
  const expected = {
    implementationPath: pair.implementationPath,
    pairId: pairId(pair),
    programPath: pair.programPath,
    schemaVersion: PROGSYNC_STATE_SCHEMA_VERSION,
    targetKind: pair.target.kind
  };
  for (const [name, value] of Object.entries(expected)) {
    if (receipt?.[name] !== value) {
      checkpointCorrupt(`ProgSync's private pair receipt has an invalid ${name}.`, {
        actual: receipt?.[name] ?? null,
        expected: value,
        receiptPath,
        stateCommit
      });
    }
  }
  for (const name of ["implementationMode", "programMode"]) {
    if (receipt?.[name] !== 0o644 && receipt?.[name] !== 0o755) {
      checkpointCorrupt(`ProgSync's private pair receipt has an invalid ${name}.`, {
        actual: receipt?.[name] ?? null,
        receiptPath,
        stateCommit
      });
    }
  }
  if (
    receipt.runnerProfile !== undefined &&
    receipt.runnerProfile !== null &&
    (
      typeof receipt.runnerProfile !== "object" ||
      Array.isArray(receipt.runnerProfile) ||
      typeof receipt.runnerProfile.model !== "string" ||
      typeof receipt.runnerProfile.reasoningEffort !== "string"
    )
  ) {
    checkpointCorrupt("ProgSync's private pair receipt has an invalid runnerProfile.", {
      actual: receipt.runnerProfile,
      receiptPath,
      stateCommit
    });
  }
  if (!Array.isArray(receipt.auxiliaryFiles)) {
    checkpointCorrupt("ProgSync's private pair receipt has no valid auxiliaryFiles list.", {
      receiptPath,
      stateCommit
    });
  }
  const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
  const seenAuxiliaries = new Set();
  for (const auxiliary of receipt.auxiliaryFiles || []) {
    if (
      !auxiliary ||
      typeof auxiliary.path !== "string" ||
      !auxiliary.path.startsWith(auxiliaryRoot) ||
      seenAuxiliaries.has(auxiliary.path) ||
      (auxiliary.mode !== 0o644 && auxiliary.mode !== 0o755) ||
      !/^sha256:[a-f0-9]{64}$/u.test(auxiliary.hash || "")
    ) {
      checkpointCorrupt("ProgSync's private pair receipt has invalid auxiliary ownership data.", {
        auxiliary,
        auxiliaryRoot,
        receiptPath,
        stateCommit
      });
    }
    seenAuxiliaries.add(auxiliary.path);
  }
  return receipt;
}

async function readCheckpointPair({
  currentGit,
  currentAuxiliaries,
  currentImplementation,
  currentProgram,
  pair
}) {
  const stateCommit = await resolveOptionalCommit(pair.projectRoot, PROGSYNC_STATE_REF);
  if (!stateCommit) {
    return {
      applicable: false,
      found: false,
      reason: "state-ref-missing",
      stateCommit: null
    };
  }

  const receiptPath = receiptPathForPair(pair);
  const receiptFile = await readGitFile(pair.projectRoot, stateCommit, receiptPath);
  if (!receiptFile.exists) {
    return {
      applicable: false,
      found: false,
      reason: "pair-not-checkpointed",
      receiptPath,
      stateCommit
    };
  }
  const receipt = parseReceipt(receiptFile.source, {
    pair,
    receiptPath,
    stateCommit
  });
  const [program, implementation] = await Promise.all([
    readGitFile(pair.projectRoot, stateCommit, pair.programPath),
    readGitFile(pair.projectRoot, stateCommit, pair.implementationPath)
  ]);
  if (!program.exists || !implementation.exists) {
    checkpointCorrupt("ProgSync's private checkpoint is missing an accepted pair file.", {
      implementationExists: implementation.exists,
      programExists: program.exists,
      receiptPath,
      stateCommit
    });
  }
  const actualProgramHash = prefixedSourceHash(program);
  const actualImplementationHash = prefixedSourceHash(implementation);
  if (
    receipt.programHash !== actualProgramHash ||
    receipt.implementationHash !== actualImplementationHash ||
    receipt.programMode !== program.mode ||
    receipt.implementationMode !== implementation.mode
  ) {
    checkpointCorrupt("ProgSync's private checkpoint does not match its pair receipt.", {
      actualImplementationHash,
      actualProgramHash,
      receiptImplementationHash: receipt.implementationHash,
      receiptImplementationMode: receipt.implementationMode,
      receiptPath,
      receiptProgramHash: receipt.programHash,
      receiptProgramMode: receipt.programMode,
      stateCommit
    });
  }
  const auxiliaries = await Promise.all(receipt.auxiliaryFiles.map(async (entry) => ({
    relativePath: entry.path,
    state: await readGitFile(pair.projectRoot, stateCommit, entry.path)
  })));
  for (const auxiliary of auxiliaries) {
    const declared = receipt.auxiliaryFiles.find((entry) => entry.path === auxiliary.relativePath);
    if (
      !auxiliary.state.exists ||
      prefixedSourceHash(auxiliary.state) !== declared.hash ||
      auxiliary.state.mode !== declared.mode
    ) {
      checkpointCorrupt("ProgSync's private checkpoint does not match its auxiliary receipt.", {
        auxiliaryPath: auxiliary.relativePath,
        receiptPath,
        stateCommit
      });
    }
  }

  const exactPairMatch = (
    !fileChanged(program, currentProgram) &&
    !fileChanged(implementation, currentImplementation) &&
    !ownedFilesChanged(auxiliaries, currentAuxiliaries)
  );
  if (exactPairMatch) {
    return {
      applicable: true,
      exactPairMatch: true,
      found: true,
      implementation,
      auxiliaries,
      program,
      reason: "exact-pair-match",
      receipt,
      receiptPath,
      stateCommit
    };
  }

  const sameBranch = Boolean(
    receipt.branch && currentGit.branch && receipt.branch === currentGit.branch
  );
  const historyContinues = sameBranch && await isGitAncestor(
    pair.projectRoot,
    receipt.head,
    currentGit.head
  );
  return {
    applicable: historyContinues,
    exactPairMatch: false,
    found: true,
    implementation,
    auxiliaries,
    program,
    reason: historyContinues
      ? "same-branch-history-continues"
      : sameBranch
        ? "same-branch-history-diverged"
        : "branch-changed",
    receipt,
    receiptPath,
    stateCommit
  };
}

async function readPairSnapshot({
  base,
  pair,
  projectRoot
}) {
  await assertGitRepository(projectRoot);
  const explicitBase = base !== undefined && base !== null;
  const requestedBase = explicitBase ? base : DEFAULT_GIT_BASE;
  const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
  const [baseCommit, currentGit, P1, I1, A1] = await Promise.all([
    resolveGitBase(projectRoot, requestedBase),
    currentGitContext(projectRoot),
    readWorkingFile(projectRoot, pair.programPath),
    readWorkingFile(projectRoot, pair.implementationPath),
    readWorkingFiles(projectRoot, auxiliaryRoot)
  ]);
  const [gitProgram, gitImplementation, gitAuxiliaries] = await Promise.all([
    readGitFile(projectRoot, baseCommit, pair.programPath),
    readGitFile(projectRoot, baseCommit, pair.implementationPath),
    readGitFiles(projectRoot, baseCommit, auxiliaryRoot)
  ]);

  let checkpoint = {
    applicable: false,
    found: false,
    reason: explicitBase ? "explicit-git-base" : "not-inspected",
    stateCommit: null
  };
  if (!explicitBase) {
    checkpoint = await readCheckpointPair({
      currentGit,
      currentAuxiliaries: A1,
      currentImplementation: I1,
      currentProgram: P1,
      pair
    });
  }
  const useCheckpoint = checkpoint.applicable;
  const P0 = useCheckpoint ? checkpoint.program : gitProgram;
  const I0 = useCheckpoint ? checkpoint.implementation : gitImplementation;
  const A0 = useCheckpoint ? checkpoint.auxiliaries : gitAuxiliaries;

  return {
    acceptedChanges: {
      implementation: fileState(I0, I1),
      auxiliaries: ownedFilesChanged(A0, A1) ? "modified" : "unchanged",
      program: fileState(P0, P1)
    },
    baseCommit,
    baselineKind: useCheckpoint ? "checkpoint" : "git",
    baselineReason: checkpoint.reason,
    checkpoint,
    currentGit,
    gitChanges: {
      implementation: fileState(gitImplementation, I1),
      auxiliaries: ownedFilesChanged(gitAuxiliaries, A1) ? "modified" : "unchanged",
      program: fileState(gitProgram, P1)
    },
    gitImplementation,
    gitProgram,
    I0,
    I1,
    A0,
    A1,
    P0,
    P1
  };
}

async function hashObject(projectRoot, source) {
  return (await runGit(projectRoot, ["hash-object", "-w", "--stdin"], {
    input: source
  })).trim();
}

async function updateAlternateIndex({
  indexPath,
  objectId,
  projectRoot,
  repositoryPrefix = "",
  relativePath,
  sourceMode = 0o644
}) {
  const gitMode = (sourceMode & 0o111) === 0 ? "100644" : "100755";
  await runGit(projectRoot, [
    "update-index",
    "--add",
    "--cacheinfo",
    gitMode,
    objectId,
    path.posix.join(repositoryPrefix, relativePath)
  ], {
    env: { GIT_INDEX_FILE: indexPath }
  });
}

async function createStateCommit({
  auxiliaries,
  implementation,
  pair,
  previousCommit,
  program,
  receipt,
  receiptPath
}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-state-"));
  const indexPath = path.join(temporaryRoot, "index");
  const indexOptions = {
    env: { GIT_INDEX_FILE: indexPath }
  };
  try {
    const repositoryPrefix = (await runGit(
      pair.projectRoot,
      ["rev-parse", "--show-prefix"]
    )).trim();
    await runGit(
      pair.projectRoot,
      previousCommit
        ? ["read-tree", `${previousCommit}^{tree}`]
        : ["read-tree", "--empty"],
      indexOptions
    );
    const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
    const indexedAuxiliaries = parseNulPaths((await runGit(
      pair.projectRoot,
      ["ls-files", "--full-name", "-z", "--", auxiliaryRoot],
      indexOptions
    )));
    if (indexedAuxiliaries.length > 0) {
      await runGit(
        pair.projectRoot,
        ["update-index", "--force-remove", "--", ...indexedAuxiliaries],
        indexOptions
      );
    }
    const [programObject, implementationObject, receiptObject] = await Promise.all([
      hashObject(pair.projectRoot, program.source),
      hashObject(pair.projectRoot, implementation.source),
      hashObject(pair.projectRoot, stableJson(receipt))
    ]);
    await updateAlternateIndex({
      indexPath,
      objectId: programObject,
      projectRoot: pair.projectRoot,
      repositoryPrefix,
      relativePath: pair.programPath,
      sourceMode: program.mode
    });
    for (const auxiliary of auxiliaries) {
      const objectId = await hashObject(pair.projectRoot, auxiliary.state.source);
      await updateAlternateIndex({
        indexPath,
        objectId,
        projectRoot: pair.projectRoot,
        repositoryPrefix,
        relativePath: auxiliary.relativePath,
        sourceMode: auxiliary.state.mode
      });
    }
    await updateAlternateIndex({
      indexPath,
      objectId: implementationObject,
      projectRoot: pair.projectRoot,
      repositoryPrefix,
      relativePath: pair.implementationPath,
      sourceMode: implementation.mode
    });
    await updateAlternateIndex({
      indexPath,
      objectId: receiptObject,
      projectRoot: pair.projectRoot,
      repositoryPrefix,
      relativePath: receiptPath
    });
    const tree = (await runGit(pair.projectRoot, ["write-tree"], indexOptions)).trim();
    const args = [
      "-c",
      "user.name=ProgSync",
      "-c",
      "user.email=progsync@local",
      "commit-tree",
      tree
    ];
    if (previousCommit) {
      args.push("-p", previousCommit);
    }
    const commit = (await runGit(pair.projectRoot, args, {
      input: `ProgSync checkpoint: ${pair.programPath} (${receipt.mode})\n`
    })).trim();
    return { commit, tree };
  } finally {
    await fs.rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function zeroObjectId(projectRoot) {
  const emptyObject = (await runGit(projectRoot, ["hash-object", "--stdin"], {
    input: ""
  })).trim();
  return "0".repeat(emptyObject.length);
}

async function resolveOptionalObjectId(projectRoot, revision) {
  const result = await gitResult(
    projectRoot,
    ["rev-parse", "--verify", "--quiet", revision],
    { reject: false }
  );
  return result.ok ? result.stdout.trim() : null;
}

async function compareAndSwapStateRef({
  nextCommit,
  previousObject,
  projectRoot
}) {
  const expected = previousObject || await zeroObjectId(projectRoot);
  const result = await gitResult(projectRoot, [
    "update-ref",
    PROGSYNC_STATE_REF,
    nextCommit,
    expected
  ], { reject: false });
  if (result.ok) {
    return true;
  }
  const output = `${result.stderr || ""}\n${result.stdout || ""}`;
  if (/cannot lock ref|is at [0-9a-f]+ but expected|reference already exists/iu.test(output)) {
    return false;
  }
  throw new ProgSyncError(
    "PROGSYNC_STATE_WRITE_FAILED",
    "Git could not update ProgSync's private accepted-state ref.",
    { output: output.trim(), stateRef: PROGSYNC_STATE_REF }
  );
}

async function checkpointPair({
  contextHash = null,
  expectedPair = null,
  mode,
  pair,
  runnerProfile = null
}) {
  await assertGitRepository(pair.projectRoot);
  const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
  const [program, implementation, auxiliaries, currentGit] = await Promise.all([
    readWorkingFile(pair.projectRoot, pair.programPath),
    readWorkingFile(pair.projectRoot, pair.implementationPath),
    readWorkingFiles(pair.projectRoot, auxiliaryRoot),
    currentGitContext(pair.projectRoot)
  ]);
  if (!program.exists || !implementation.exists) {
    throw new ProgSyncError(
      "PROGSYNC_CHECKPOINT_PAIR_INCOMPLETE",
      "ProgSync cannot accept a pair until both Program and implementation exist.",
      {
        implementationExists: implementation.exists,
        programExists: program.exists
      }
    );
  }
  if (
    expectedPair &&
    (
      fileChanged(expectedPair.program, program) ||
      fileChanged(expectedPair.implementation, implementation) ||
      ownedFilesChanged(expectedPair.auxiliaries || [], auxiliaries)
    )
  ) {
    throw new ProgSyncError(
      "PAIR_CHANGED_DURING_SYNCHRONIZATION",
      "Program or implementation changed before the accepted checkpoint could be recorded.",
      {
        implementationPath: pair.implementationPath,
        programPath: pair.programPath
      }
    );
  }
  const receiptPath = receiptPathForPair(pair);
  const receipt = {
    acceptedAt: new Date().toISOString(),
    auxiliaryFiles: auxiliaries.map((entry) => ({
      hash: prefixedSourceHash(entry.state),
      mode: entry.state.mode,
      path: entry.relativePath
    })),
    branch: currentGit.branch,
    contextHash,
    head: currentGit.head,
    implementationHash: prefixedSourceHash(implementation),
    implementationMode: implementation.mode,
    implementationPath: pair.implementationPath,
    mode,
    pairId: pairId(pair),
    programHash: prefixedSourceHash(program),
    programMode: program.mode,
    programPath: pair.programPath,
    runnerProfile,
    schemaVersion: PROGSYNC_STATE_SCHEMA_VERSION,
    targetKind: pair.target.kind
  };

  for (let attempt = 1; attempt <= MAX_STATE_WRITE_ATTEMPTS; attempt += 1) {
    const previousObject = await resolveOptionalObjectId(
      pair.projectRoot,
      PROGSYNC_STATE_REF
    );
    const previousCommit = previousObject
      ? await resolveOptionalCommit(pair.projectRoot, previousObject)
      : null;
    const candidate = await createStateCommit({
      auxiliaries,
      implementation,
      pair,
      previousCommit,
      program,
      receipt,
      receiptPath
    });
    if (await compareAndSwapStateRef({
      nextCommit: candidate.commit,
      previousObject,
      projectRoot: pair.projectRoot
    })) {
      return {
        attempt,
        commit: candidate.commit,
        previousCommit,
        receipt,
        receiptPath,
        stateRef: PROGSYNC_STATE_REF,
        tree: candidate.tree
      };
    }
  }
  throw new ProgSyncError(
    "PROGSYNC_STATE_CONFLICT",
    "ProgSync's private accepted state changed repeatedly during this synchronization.",
    { attempts: MAX_STATE_WRITE_ATTEMPTS, stateRef: PROGSYNC_STATE_REF }
  );
}

export {
  checkpointPair,
  pairId,
  readCheckpointPair,
  readPairSnapshot,
  receiptPathForPair
};
