import fs from "node:fs/promises";
import path from "node:path";

import { applyCandidates, runCandidateSynchronization } from "./candidate.js";
import { checkpointPair, readPairSnapshot } from "./checkpoint.js";
import { validatePairConformance } from "./conformance.js";
import { buildContextCapsule } from "./context.js";
import { createCodexExecRunner } from "./codexRunner.js";
import { ProgSyncError, asDiagnostic } from "./errors.js";
import {
  assertGitRepository,
  changedGitPaths,
  readWorkingFile,
  readWorkingFiles
} from "./git.js";
import { acquirePairLock } from "./lock.js";
import { manifestBoundaryForTarget } from "./manifest.js";
import {
  absoluteProjectPath,
  auxiliaryRootForImplementationPath,
  isSupportedImplementationPath,
  isTargetBoundProgramPath,
  projectionPathForProgram,
  projectRelativePath,
  projectRootPath,
  resolveModulePair,
  slashPath
} from "./paths.js";
import {
  buildProgramProjection,
  assertValidProgram,
  parseProgram,
  projectionStatus,
  symbolAnchor,
  writeProgramProjection
} from "./program.js";
import { composeAtomicPrompt } from "./prompts.js";
import { SHARED_TYPES_PATH } from "./constants.js";
import { classifyPair, ownedFilesChanged } from "./state.js";

function assertResolvedCapsule(capsule) {
  if (capsule.resolutionDiagnostics.length > 0) {
    throw new ProgSyncError(
      "UNRESOLVED_CONTEXT",
      "ProgSync could not assemble a closed atomic context.",
      { diagnostics: capsule.resolutionDiagnostics }
    );
  }
}

function expectedFinalPair(pair, snapshot, candidates, finalAuxiliaries = snapshot.A1 || []) {
  const programCandidate = candidates.find((entry) => entry.relativePath === pair.programPath);
  const implementationCandidate = candidates.find((entry) => (
    entry.relativePath === pair.implementationPath
  ));
  return {
    auxiliaries: finalAuxiliaries,
    implementation: implementationCandidate
      ? { exists: true, ...implementationCandidate }
      : snapshot.I1,
    program: programCandidate
      ? { exists: true, ...programCandidate }
      : snapshot.P1
  };
}

function discoveryRecord(code, message, details = {}) {
  return {
    code,
    details,
    message,
    type: "progsync.discovery"
  };
}

function changeDescription(value) {
  if (value === "untracked") {
    return "new";
  }
  return value;
}

function buildPairDiscovery({ inputPath, mode, pair, snapshot }) {
  const relativeInput = projectRelativePath(pair.projectRoot, inputPath);
  const inputIsProgram = relativeInput === pair.programPath;
  const counterpartPath = inputIsProgram
    ? pair.implementationPath
    : pair.programPath;
  const counterpartExists = inputIsProgram
    ? snapshot.I1.exists
    : snapshot.P1.exists;
  const records = [
    discoveryRecord(
      "INPUT_RESOLVED",
      `Input ${relativeInput} is ${inputIsProgram ? "a Program module" : "a managed implementation"}.`,
      { inputPath: relativeInput, side: inputIsProgram ? "program" : "implementation" }
    ),
    discoveryRecord(
      counterpartExists ? "COUNTERPART_FOUND" : "COUNTERPART_MISSING",
      `Counterpart ${counterpartPath} ${counterpartExists ? "found" : "is missing"}.`,
      { counterpartExists, counterpartPath }
    ),
    discoveryRecord(
      "TARGET_SUPPORTED",
      `${pair.target.extension} is supported by the ${pair.target.kind} translator.`,
      { extension: pair.target.extension, targetKind: pair.target.kind }
    )
  ];

  if (snapshot.baselineKind === "checkpoint") {
    records.push(discoveryRecord(
      "CHECKPOINT_SELECTED",
      `Accepted pair found at private checkpoint ${snapshot.checkpoint.stateCommit}.`,
      {
        reason: snapshot.checkpoint.reason,
        stateCommit: snapshot.checkpoint.stateCommit
      }
    ));
  } else if (snapshot.checkpoint.found) {
    records.push(discoveryRecord(
      "CHECKPOINT_REJECTED",
      `Private pair checkpoint was not applicable (${snapshot.checkpoint.reason}); using Git ${snapshot.baseCommit || "empty baseline"}.`,
      {
        reason: snapshot.checkpoint.reason,
        stateCommit: snapshot.checkpoint.stateCommit
      }
    ));
  } else {
    records.push(discoveryRecord(
      "GIT_BASELINE_SELECTED",
      snapshot.checkpoint.reason === "explicit-git-base"
        ? `Explicit Git baseline ${snapshot.baseCommit || "empty baseline"} selected.`
        : `No accepted pair checkpoint was found; using Git ${snapshot.baseCommit || "empty baseline"}.`,
      {
        baseCommit: snapshot.baseCommit,
        reason: snapshot.checkpoint.reason
      }
    ));
  }

  records.push(discoveryRecord(
    "GIT_CHANGES",
    `Git — Program ${changeDescription(snapshot.gitChanges.program)}, implementation ${changeDescription(snapshot.gitChanges.implementation)} relative to ${snapshot.baseCommit || "an empty repository"}.`,
    { ...snapshot.gitChanges }
  ));
  records.push(discoveryRecord(
    "ACCEPTED_PAIR_CHANGES",
    `Accepted pair — Program ${changeDescription(snapshot.acceptedChanges.program)}, implementation ${changeDescription(snapshot.acceptedChanges.implementation)}.`,
    { ...snapshot.acceptedChanges }
  ));
  records.push(discoveryRecord(
    "AUXILIARY_CHANGES",
    `Owned auxiliary implementation is ${changeDescription(snapshot.acceptedChanges.auxiliaries)} relative to the accepted state.`,
    {
      accepted: snapshot.acceptedChanges.auxiliaries,
      git: snapshot.gitChanges.auxiliaries,
      root: auxiliaryRootForImplementationPath(pair.implementationPath)
    }
  ));
  if (snapshot.contextChanged) {
    records.push(discoveryRecord(
      "CONTEXT_CHANGED",
      "A referenced interface or retained package context changed since this pair was accepted.",
      { previousContextHash: snapshot.checkpoint.receipt?.contextHash || null }
    ));
  }
  records.push(discoveryRecord(
    "MODE_SELECTED",
    `Selected ${mode}.`,
    { mode }
  ));
  return records;
}

function emitDiscovery(records, onEvent) {
  for (const record of records) {
    onEvent?.(record);
  }
}

function checkpointDiscovery(checkpoint) {
  return discoveryRecord(
    "CHECKPOINT_ACCEPTED",
    `Accepted resulting pair at private checkpoint ${checkpoint.commit}.`,
    {
      commit: checkpoint.commit,
      previousCommit: checkpoint.previousCommit,
      stateRef: checkpoint.stateRef
    }
  );
}

function unchangedReport(mode) {
  return {
    status: "unchanged",
    mode,
    summary: "Program and managed implementation already match their accepted baseline.",
    programChanges: [],
    implementationChanges: [],
    preservedImplementationDetails: [],
    sharedDefinitionProposals: [],
    diagnostics: [],
    verificationPerformed: [],
    verificationStillRequired: []
  };
}

function commandModeCandidate(pair, snapshot) {
  if (pair.target.kind !== "javascript" || !snapshot.P1.exists || !snapshot.I1.exists) {
    return null;
  }
  const parsedProgram = assertValidProgram(snapshot.P1.source, {
    programPath: pair.programPath
  });
  const providesCommand = parsedProgram.provides.some((provided) => (
    !provided.owner && provided.kind === "command"
  ));
  const permissions = snapshot.I1.permissions ?? snapshot.I1.mode ?? 0o644;
  if (!providesCommand || (permissions & 0o111) !== 0) {
    return null;
  }
  return {
    mode: 0o755,
    permissions: permissions | 0o111,
    relativePath: pair.implementationPath,
    source: snapshot.I1.source
  };
}

function commandModeReport(mode, implementationPath) {
  return {
    ...unchangedReport(mode),
    status: "updated",
    summary: `Made Program command ${implementationPath} executable.`,
    implementationChanges: [`Set executable permissions on ${implementationPath}.`],
    verificationPerformed: ["Confirmed that the Program provides a command entrypoint."]
  };
}

async function prepareSynchronization({
  base,
  dependencyChanged = false,
  inputPath,
  operation,
  projectRoot
}) {
  const pair = resolveModulePair(projectRoot, inputPath);
  const snapshot = await readPairSnapshot({
    base,
    pair,
    projectRoot
  });
  if (snapshot.P1.exists) {
    assertValidProgram(snapshot.P1.source, { programPath: pair.programPath });
  }
  let mode = selectedMode(operation, snapshot);
  let capsule = await buildContextCapsule({ mode, pair, snapshot });
  assertResolvedCapsule(capsule);
  const checkpointContextChanged = snapshot.baselineKind === "checkpoint" &&
    snapshot.checkpoint.receipt?.contextHash !== capsule.contextHash;
  const contextRequiresWork = checkpointContextChanged || (
    dependencyChanged && snapshot.baselineKind !== "checkpoint"
  );
  if (contextRequiresWork) {
    if (mode === "NO_CHANGE") {
      mode = "PROGRAM_TO_IMPLEMENTATION";
    } else if (dependencyChanged && mode === "IMPLEMENTATION_TO_PROGRAM") {
      mode = "RECONCILE_BOTH";
    }
    snapshot.contextChanged = true;
    capsule = await buildContextCapsule({ mode, pair, snapshot });
    assertResolvedCapsule(capsule);
  }
  if (mode === "NO_CHANGE") {
    await validatePairConformance({
      auxiliaryImplementations: snapshot.A1,
      implementationSource: snapshot.I1.source,
      mode,
      pair,
      programSource: snapshot.P1.source
    });
  }
  return {
    capsule,
    discovery: buildPairDiscovery({ inputPath, mode, pair, snapshot }),
    mode,
    pair,
    snapshot
  };
}

function selectedMode(operation, snapshot) {
  if (operation === "import") {
    if (!snapshot.I1.exists) {
      throw new ProgSyncError(
        "IMPLEMENTATION_REQUIRED",
        "Cannot import Program because the managed implementation is missing."
      );
    }
    if (snapshot.P1.exists) {
      throw new ProgSyncError(
        "PROGRAM_ALREADY_EXISTS",
        "Program already exists. Use sync instead of import."
      );
    }
    if (snapshot.P0.exists) {
      throw new ProgSyncError(
        "EXPLICIT_PROGRAM_DELETION_REQUIRED",
        "Program existed at the accepted baseline and is now missing."
      );
    }
    return "CREATE_PROGRAM";
  }
  if (operation === "compile") {
    if (!snapshot.P1.exists) {
      throw new ProgSyncError(
        "PROGRAM_REQUIRED",
        "Cannot compile because the Program module is missing."
      );
    }
  }
  return classifyPair(snapshot);
}

function finalProgramSource(pair, snapshot, candidates) {
  const candidate = candidates.find((entry) => entry.relativePath === pair.programPath);
  return candidate?.source || snapshot.P1.source || null;
}

async function synchronizeFile({
  base,
  dependencyChanged = false,
  inputPath,
  onEvent,
  operation = "sync",
  projectRoot,
  runner,
  write = true
}) {
  const root = projectRootPath(projectRoot);
  const pair = resolveModulePair(root, inputPath);
  await assertGitRepository(root);
  const releasePairLock = await acquirePairLock(pair);
  try {
    const prepared = await prepareSynchronization({
      base,
      dependencyChanged,
      inputPath,
      operation,
      projectRoot: root
    });
    const { capsule, discovery, mode, snapshot } = prepared;
    emitDiscovery(discovery, onEvent);
    if (mode === "NO_CHANGE") {
      const modeCandidate = commandModeCandidate(pair, snapshot);
      const candidates = modeCandidate ? [modeCandidate] : [];
      let changedFiles = [];
      let checkpoint = null;
      if (write) {
        changedFiles = await applyCandidates({
          candidates,
          expectedFiles: snapshot.A1.map((entry) => ({
            relativePath: entry.relativePath,
            state: entry.state
          })),
          expectedPair: {
            auxiliaries: snapshot.A1,
            implementation: snapshot.I1,
            program: snapshot.P1
          },
          pair,
          programSourceForProjection: snapshot.P1.source
        });
        if (snapshot.baselineKind !== "checkpoint" || modeCandidate) {
          const finalPair = expectedFinalPair(pair, snapshot, candidates, snapshot.A1);
          checkpoint = await checkpointPair({
            contextHash: capsule.contextHash,
            expectedPair: finalPair,
            mode,
            pair,
            runnerProfile: capsule.runnerProfile
          });
          const record = checkpointDiscovery(checkpoint);
          discovery.push(record);
          onEvent?.(record);
        }
      }
      return {
        applied: Boolean(write && modeCandidate),
        baseCommit: snapshot.baseCommit,
        baselineKind: snapshot.baselineKind,
        changedFiles,
        checkpoint,
        checkpointed: Boolean(checkpoint),
        discovery,
        diff: "",
        gitChanges: snapshot.gitChanges,
        mode,
        pair,
        progsyncChanges: snapshot.acceptedChanges,
        report: modeCandidate
          ? commandModeReport(mode, pair.implementationPath)
          : unchangedReport(mode),
        status: modeCandidate ? "updated" : "unchanged"
      };
    }

    const prompt = await composeAtomicPrompt({
      allowedPathPrefixes: capsule.target.allowedPathPrefixes,
      allowedPaths: capsule.target.allowedPaths,
      capsule,
      mode,
      target: pair.target
    });
    const selectedRunner = runner || createCodexExecRunner();
    const candidate = await runCandidateSynchronization({
      capsule,
      onEvent,
      pair,
      prompt,
      runner: selectedRunner,
      snapshot
    });
    if (candidate.report.status === "blocked") {
      return {
        applied: false,
        baseCommit: snapshot.baseCommit,
        baselineKind: snapshot.baselineKind,
        changedFiles: [],
        checkpoint: null,
        checkpointed: false,
        discovery,
        diff: "",
        gitChanges: snapshot.gitChanges,
        mode,
        pair,
        progsyncChanges: snapshot.acceptedChanges,
        report: candidate.report,
        status: "blocked"
      };
    }

    const expectedPair = expectedFinalPair(
      pair,
      snapshot,
      candidate.candidates,
      candidate.finalAuxiliaries
    );
    let changedFiles = [...candidate.changedPaths];
    if (write) {
      changedFiles = await applyCandidates({
        candidates: candidate.candidates,
        expectedFiles: [
          ...snapshot.A1.map((entry) => ({
            relativePath: entry.relativePath,
            state: entry.state
          })),
          ...(candidate.candidates.some((entry) => (
            entry.relativePath === SHARED_TYPES_PATH
          )) ? [{
            relativePath: SHARED_TYPES_PATH,
            state: capsule.sharedTypes
          }] : [])
        ],
        expectedPair: {
          auxiliaries: snapshot.A1,
          implementation: snapshot.I1,
          program: snapshot.P1
        },
        pair,
        programSourceForProjection: finalProgramSource(pair, snapshot, candidate.candidates)
      });
    }
    let checkpoint = null;
    if (write) {
      const [finalProgram, finalImplementation, finalAuxiliaries] = await Promise.all([
        readWorkingFile(root, pair.programPath),
        readWorkingFile(root, pair.implementationPath),
        readWorkingFiles(root, auxiliaryRootForImplementationPath(pair.implementationPath))
      ]);
      if (
        finalProgram.source !== expectedPair.program.source ||
        finalProgram.mode !== expectedPair.program.mode ||
        finalImplementation.source !== expectedPair.implementation.source ||
        finalImplementation.mode !== expectedPair.implementation.mode ||
        ownedFilesChanged(expectedPair.auxiliaries, finalAuxiliaries)
      ) {
        throw new ProgSyncError(
          "PAIR_CHANGED_DURING_SYNCHRONIZATION",
          "The final pair differs from the validated candidate; it was not checkpointed."
        );
      }
      await validatePairConformance({
        auxiliaryImplementations: finalAuxiliaries,
        implementationSource: finalImplementation.source,
        mode,
        pair,
        programSource: finalProgram.source
      });
      const finalSnapshot = {
        ...snapshot,
        A1: finalAuxiliaries,
        I1: finalImplementation,
        P1: finalProgram
      };
      const finalCapsule = await buildContextCapsule({ mode: "NO_CHANGE", pair, snapshot: finalSnapshot });
      assertResolvedCapsule(finalCapsule);
      checkpoint = await checkpointPair({
        contextHash: finalCapsule.contextHash,
        expectedPair: {
          auxiliaries: finalAuxiliaries,
          implementation: finalImplementation,
          program: finalProgram
        },
        mode,
        pair,
        runnerProfile: finalCapsule.runnerProfile
      });
      const record = checkpointDiscovery(checkpoint);
      discovery.push(record);
      onEvent?.(record);
    }
    return {
      applied: Boolean(write && candidate.candidates.length > 0),
      baseCommit: snapshot.baseCommit,
      baselineKind: snapshot.baselineKind,
      changedFiles,
      checkpoint,
      checkpointed: Boolean(checkpoint),
      discovery,
      diff: candidate.diff,
      gitChanges: snapshot.gitChanges,
      mode,
      pair,
      progsyncChanges: snapshot.acceptedChanges,
      report: candidate.report,
      status: candidate.report.status
    };
  } finally {
    await releasePairLock();
  }
}

async function statusFile({ base, inputPath, projectRoot }) {
  const root = projectRootPath(projectRoot);
  await assertGitRepository(root);
  const { discovery, mode, pair, snapshot } = await prepareSynchronization({
    base,
    inputPath,
    operation: "sync",
    projectRoot: root
  });
  return {
    baseCommit: snapshot.baseCommit,
    baselineKind: snapshot.baselineKind,
    checkpoint: snapshot.checkpoint,
    discovery,
    gitChanges: snapshot.gitChanges,
    mode,
    pair,
    progsyncChanges: snapshot.acceptedChanges,
    reconciled: mode === "NO_CHANGE",
    status: mode === "NO_CHANGE" ? "synchronized" : "pending"
  };
}

function pairInputForChangedPath(filePath) {
  if (isTargetBoundProgramPath(filePath) || isSupportedImplementationPath(filePath)) {
    return filePath;
  }
  return null;
}

function internalProgramProviderPath(provider) {
  const match = String(provider || "").match(/^@\/([^#]+\.md)#[a-z0-9][a-z0-9-]*$/u);
  return match ? `program/${match[1]}` : null;
}

function localAssetProviderPath(provider, consumerProgramPath) {
  const identity = String(provider || "").startsWith("asset:")
    ? String(provider).slice("asset:".length)
    : null;
  if (!identity) {
    return null;
  }
  if (!identity.startsWith("url:")) {
    if (identity.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(identity)) {
      return null;
    }
    return slashPath(identity);
  }
  const url = identity.slice("url:".length).split(/[?#]/u)[0];
  if (
    !url ||
    url.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(url)
  ) {
    return null;
  }
  if (url.startsWith("@/")) {
    return slashPath(url.slice(2));
  }
  if (url.startsWith("/")) {
    return slashPath(url.slice(1));
  }
  if (!isTargetBoundProgramPath(consumerProgramPath)) {
    return null;
  }
  const consumerTarget = consumerProgramPath
    .slice("program/".length, -".md".length);
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(consumerTarget),
    url
  ));
  return resolved === ".." || resolved.startsWith("../") ? null : resolved;
}

function programUseDependencyPath(use, consumerProgramPath) {
  return internalProgramProviderPath(use.provider) ||
    localAssetProviderPath(use.provider, consumerProgramPath);
}

function addReverseDependency(reverse, providerPath, consumerPath) {
  if (!providerPath) {
    return;
  }
  if (!reverse.has(providerPath)) {
    reverse.set(providerPath, new Set());
  }
  reverse.get(providerPath).add(consumerPath);
}

async function reverseProgramDependencies(root) {
  const reverse = new Map();
  const programFiles = await walkMarkdown(path.join(root, "program"), root);
  for (const consumerPath of programFiles) {
    let parsed;
    try {
      const source = await fs.readFile(
        absoluteProjectPath(root, consumerPath),
        "utf8"
      );
      parsed = parseProgram(source, { programPath: consumerPath });
    } catch {
      continue;
    }
    for (const use of parsed.uses) {
      addReverseDependency(
        reverse,
        programUseDependencyPath(use, consumerPath),
        consumerPath
      );
    }
    if ((parsed.typeReferences || []).length > 0) {
      addReverseDependency(reverse, "program/types.md", consumerPath);
    }
    if (isTargetBoundProgramPath(consumerPath)) {
      addReverseDependency(reverse, "package.json", consumerPath);
    }
  }
  return reverse;
}

function dependentProgramPaths(changedProgramPaths, reverseDependencies) {
  const discovered = new Set();
  const queue = [...changedProgramPaths];
  while (queue.length > 0) {
    const providerPath = queue.shift();
    for (const consumerPath of reverseDependencies.get(providerPath) || []) {
      if (discovered.has(consumerPath)) {
        continue;
      }
      discovered.add(consumerPath);
      queue.push(consumerPath);
    }
  }
  return discovered;
}

async function syncChanged({
  base,
  onEvent,
  projectRoot,
  runner,
  write = true
}) {
  const root = projectRootPath(projectRoot);
  const changed = await changedGitPaths(root, { base });
  const pairInputs = new Map();
  const unresolvedChangedPaths = [];
  const changedDependencyPaths = new Set();
  for (const filePath of changed.paths) {
    if (filePath.startsWith(".program/index/")) {
      continue;
    }
    changedDependencyPaths.add(filePath);
    const input = pairInputForChangedPath(filePath);
    if (!input) {
      if (filePath.startsWith("program/") && filePath.endsWith(".md")) {
        continue;
      } else {
        unresolvedChangedPaths.push(filePath);
      }
      continue;
    }
    try {
      const pair = resolveModulePair(root, input);
      pairInputs.set(pair.programPath, {
        dependencyChanged: false,
        inputPath: input
      });
    } catch {
      unresolvedChangedPaths.push(filePath);
    }
  }
  const reverseDependencies = await reverseProgramDependencies(root);
  for (const programPath of dependentProgramPaths(
    changedDependencyPaths,
    reverseDependencies
  )) {
    if (!isTargetBoundProgramPath(programPath)) {
      continue;
    }
    if (pairInputs.has(programPath)) {
      pairInputs.get(programPath).dependencyChanged = true;
    } else {
      pairInputs.set(programPath, {
        dependencyChanged: true,
        inputPath: programPath
      });
    }
  }
  const skippedPaths = unresolvedChangedPaths.filter((filePath) => (
    !reverseDependencies.has(filePath)
  ));
  const results = [];
  const pending = [...pairInputs.values()];
  const queuedProgramPaths = new Set(pairInputs.keys());
  for (let index = 0; index < pending.length; index += 1) {
    const { dependencyChanged, inputPath } = pending[index];
    const result = await synchronizeFile({
      base,
      dependencyChanged,
      inputPath,
      onEvent,
      operation: "sync",
      projectRoot: root,
      runner,
      write
    });
    results.push(result);
    if (result.status === "blocked") {
      break;
    }
    if (!result.changedFiles.includes(result.pair.programPath)) {
      continue;
    }
    for (const consumerPath of dependentProgramPaths(
      [result.pair.programPath],
      reverseDependencies
    )) {
      if (
        isTargetBoundProgramPath(consumerPath) &&
        !queuedProgramPaths.has(consumerPath)
      ) {
        queuedProgramPaths.add(consumerPath);
        pending.push({
          dependencyChanged: true,
          inputPath: consumerPath
        });
      }
    }
  }
  return {
    baseCommit: changed.baseCommit,
    results,
    skippedPaths,
    status: results.some((result) => result.status === "blocked")
      ? "blocked"
      : results.some((result) => result.status === "updated")
        ? "updated"
        : "unchanged"
  };
}

async function walkFiles(directory, projectRoot, accept, output = []) {
  const relativeDirectory = slashPath(path.relative(projectRoot, directory));
  const safeDirectory = absoluteProjectPath(projectRoot, relativeDirectory);
  let entries;
  try {
    entries = await fs.readdir(safeDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return output;
    }
    throw error;
  }
  for (const entry of entries) {
    const entryPath = absoluteProjectPath(
      projectRoot,
      slashPath(path.join(relativeDirectory, entry.name))
    );
    if (entry.isDirectory()) {
      await walkFiles(entryPath, projectRoot, accept, output);
    } else if (entry.isFile() && accept(entry.name)) {
      output.push(slashPath(path.relative(projectRoot, entryPath)));
    }
  }
  return output;
}

async function walkMarkdown(directory, projectRoot) {
  return walkFiles(directory, projectRoot, (name) => name.endsWith(".md"));
}

function isTestProgramPath(programPath) {
  return /(?:^|\/)(?:test|tests)(?:\/|$)|\.(?:test|spec)\.[^.]+\.md$/u.test(programPath);
}

async function externallyInvokedProgramTarget(root, targetFile, provided, cache) {
  if (["command", "component", "document"].includes(provided.kind)) {
    return true;
  }
  if (path.posix.basename(targetFile || "") === "package.descriptor.mjs") {
    return true;
  }
  if (!targetFile) {
    return false;
  }
  return (await manifestBoundaryForTarget(root, targetFile, cache)).externallyInvoked;
}

async function checkProgram({ projectRoot }) {
  const root = projectRootPath(projectRoot);
  const programRoot = path.join(root, "program");
  const programFiles = (await walkMarkdown(programRoot, root))
    .sort((left, right) => left.localeCompare(right));
  const expectedProjectionPaths = new Set(
    programFiles.map((programPath) => projectionPathForProgram(programPath))
  );
  const files = [];
  const providedById = new Map();
  const parsedByPath = new Map();

  for (const programPath of programFiles) {
    const source = await fs.readFile(absoluteProjectPath(root, programPath), "utf8");
    try {
      const parsed = parseProgram(source, { programPath });
      const projection = buildProgramProjection({
        parsedProgram: parsed,
        programPath,
        programSource: source
      });
      const projectionCheck = await projectionStatus({
        parsedProgram: parsed,
        projectRoot: root,
        programPath,
        programSource: source,
        projection
      });
      if (!projectionCheck.current) {
        await writeProgramProjection({
          parsedProgram: parsed,
          projectRoot: root,
          programPath,
          programSource: source,
          projection
        });
      }
      if (parsed.valid) {
        for (const provided of projection.provides) {
          providedById.set(provided.id, {
            file: null,
            programPath,
            provided,
            targetFile: projection.targetFile
          });
        }
      }
      parsedByPath.set(programPath, parsed);
      files.push({
        programPath,
        diagnostics: [...parsed.diagnostics],
        projectionCurrent: true,
        projectionUpdated: !projectionCheck.current,
        projectionPath: projectionCheck.projectionPath,
        provides: projection.provides,
        typeReferences: projection.typeReferences,
        uses: projection.uses
      });
    } catch (error) {
      files.push({
        programPath,
        diagnostics: [asDiagnostic(error)],
        projectionCurrent: false,
        projectionUpdated: false,
        projectionPath: null,
        provides: [],
        typeReferences: [],
        uses: []
      });
    }
  }

  for (const file of files) {
    const parsed = parsedByPath.get(file.programPath);
    if (!parsed) {
      continue;
    }
    for (const use of parsed.uses) {
      if (!use.provider.startsWith("@/")) {
        continue;
      }
      const [providerFile, providerAnchor = ""] = use.provider.slice(2).split("#");
      const normalizedId = `@/${providerFile}#${symbolAnchor(providerAnchor)}`;
      if (!providedById.has(normalizedId)) {
        file.diagnostics.push({
          code: "UNRESOLVED_PROGRAM_USE",
          line: use.source.line,
          message: `${use.symbol} does not resolve to ${use.provider}.`
        });
      }
    }
    for (const reference of parsed.typeReferences || []) {
      const id = `@/types.md#${symbolAnchor(reference.name)}`;
      if (!providedById.has(id)) {
        file.diagnostics.push({
          code: "UNRESOLVED_PROGRAM_TYPE",
          line: reference.source.line,
          message: `[${reference.name}] is not provided by program/types.md.`
        });
      }
    }
  }

  const productionConsumers = new Map();
  const testConsumers = new Map();
  for (const [consumerPath, parsed] of parsedByPath) {
    for (const use of parsed.uses || []) {
      if (!use.provider.startsWith("@/")) {
        continue;
      }
      const [providerFile, providerAnchor = ""] = use.provider.slice(2).split("#");
      const id = `@/${providerFile}#${symbolAnchor(providerAnchor)}`;
      const map = isTestProgramPath(consumerPath)
        ? testConsumers
        : productionConsumers;
      if (!map.has(id)) {
        map.set(id, new Set());
      }
      map.get(id).add(consumerPath);
    }
  }

  const manifestCache = new Map();
  for (const [id, record] of providedById) {
    const file = files.find((entry) => entry.programPath === record.programPath);
    record.file = file;
    const production = [...(productionConsumers.get(id) || [])].sort();
    const tests = [...(testConsumers.get(id) || [])].sort();
    const external = await externallyInvokedProgramTarget(
      root,
      record.targetFile,
      record.provided,
      manifestCache
    );
    record.provided.productionConsumers = production;
    record.provided.testConsumers = tests;
    record.provided.externallyInvoked = external;
    if (isTestProgramPath(record.programPath)) {
      file.diagnostics.push({
        code: "PROGRAM_TEST_MODULE_FORBIDDEN",
        line: record.provided.source.line,
        message: "Tests are independent verification and must not receive Program counterparts."
      });
      continue;
    }
    if (!["class", "function", "method"].includes(record.provided.kind) || external) {
      continue;
    }
    if (production.length === 0 && tests.length > 0) {
      file.diagnostics.push({
        code: "TEST_ONLY_PROGRAM_SYMBOL",
        line: record.provided.source.line,
        message: `${record.provided.name} is used only by tests and should be private implementation.`
      });
    } else if (production.length < 2) {
      file.diagnostics.push({
        code: "PROGRAM_SYMBOL_HAS_TOO_FEW_PRODUCTION_CONSUMERS",
        line: record.provided.source.line,
        message: `${record.provided.name} has ${production.length} production Program consumer${production.length === 1 ? "" : "s"}; it should normally be absorbed by its owning module.`
      });
    }
  }

  const projectionRoot = path.join(root, ".program", "index");
  const projectionFiles = await walkFiles(
    projectionRoot,
    root,
    (name) => name.endsWith(".md.json")
  );
  const removedProjectionPaths = [];
  for (const projectionPath of projectionFiles) {
    if (expectedProjectionPaths.has(projectionPath)) {
      continue;
    }
    await fs.rm(absoluteProjectPath(root, projectionPath), { force: true });
    removedProjectionPaths.push(projectionPath);
  }

  return {
    files,
    removedProjectionPaths,
    status: files.some((file) => file.diagnostics.length > 0) ? "invalid" : "ok"
  };
}

export {
  checkProgram,
  syncChanged,
  statusFile,
  synchronizeFile
};
