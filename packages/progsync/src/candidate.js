import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runProgSyncCommand } from "./command.js";
import { SHARED_TYPES_PATH } from "./constants.js";
import { validatePairConformance } from "./conformance.js";
import { validateRunnerResult } from "./codexRunner.js";
import { ProgSyncError } from "./errors.js";
import { stageFileWrite } from "./files.js";
import { parseNulPaths, readWorkingFile } from "./git.js";
import {
  absoluteProjectPath,
  projectionPathForProgram,
  slashPath
} from "./paths.js";
import {
  assertValidProgram,
  buildProgramProjection,
  parseProgram,
  symbolAnchor,
  stableJson
} from "./program.js";
import { fileChanged } from "./state.js";
import { extractSourceFacts } from "./structural.js";

function workingFileChanged(expected, current) {
  return fileChanged(expected, current) || Boolean(
    expected?.exists &&
    current?.exists &&
    expected.permissions !== null &&
    expected.permissions !== undefined &&
    expected.permissions !== current.permissions
  );
}

async function readAbsoluteFile(absolutePath) {
  try {
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new ProgSyncError(
        "REGULAR_FILE_REQUIRED",
        `ProgSync can only replace regular files: ${absolutePath}`
      );
    }
    return {
      exists: true,
      mode: (stat.mode & 0o111) === 0 ? 0o644 : 0o755,
      permissions: stat.mode & 0o777,
      source: await fs.readFile(absolutePath, "utf8")
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, mode: null, permissions: null, source: null };
    }
    throw error;
  }
}

function siblingRecoveryPath(absolutePath) {
  return path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.progsync-backup-${crypto.randomBytes(8).toString("hex")}`
  );
}

async function restoreDisplacedFile({ backupPath, targetPath }) {
  try {
    await fs.link(backupPath, targetPath);
    await fs.rm(backupPath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function installStagedWrite({ original, stagedPath, targetPath }) {
  let backupPath = null;
  try {
    if (original.exists) {
      backupPath = siblingRecoveryPath(targetPath);
      try {
        await fs.rename(targetPath, backupPath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new ProgSyncError(
            "PAIR_CHANGED_DURING_SYNCHRONIZATION",
            `The file disappeared before ProgSync could replace it: ${targetPath}`
          );
        }
        throw error;
      }
      const displaced = await readAbsoluteFile(backupPath);
      if (workingFileChanged(original, displaced)) {
        const restored = await restoreDisplacedFile({ backupPath, targetPath });
        if (restored) {
          backupPath = null;
        }
        throw new ProgSyncError(
          "PAIR_CHANGED_DURING_SYNCHRONIZATION",
          "A project file changed immediately before candidate installation; the candidate was not installed.",
          restored ? {} : { recoveryPath: backupPath }
        );
      }
    } else if ((await readAbsoluteFile(targetPath)).exists) {
      throw new ProgSyncError(
        "PAIR_CHANGED_DURING_SYNCHRONIZATION",
        `The file was created before ProgSync could install its candidate: ${targetPath}`
      );
    }

    try {
      await fs.link(stagedPath, targetPath);
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (backupPath) {
        const backup = await readAbsoluteFile(backupPath);
        if (!workingFileChanged(original, backup)) {
          await fs.rm(backupPath, { force: true });
          backupPath = null;
        }
      }
      throw new ProgSyncError(
        "PAIR_CHANGED_DURING_SYNCHRONIZATION",
        "A project file was created while ProgSync was installing its candidate; the external file was preserved.",
        backupPath ? { recoveryPath: backupPath } : {}
      );
    }
    await fs.rm(stagedPath, { force: true }).catch(() => {});
    return backupPath;
  } catch (error) {
    if (backupPath && !(await readAbsoluteFile(targetPath)).exists) {
      const restored = await restoreDisplacedFile({ backupPath, targetPath });
      if (restored) {
        backupPath = null;
      }
    }
    if (backupPath && error instanceof ProgSyncError) {
      error.details = { ...error.details, recoveryPath: backupPath };
    }
    throw error;
  }
}

async function writeWorkspaceFile(workspaceRoot, relativePath, source, permissions = 0o644) {
  const absolutePath = path.join(workspaceRoot, ...slashPath(relativePath).split("/"));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, source, { encoding: "utf8", mode: permissions });
  await fs.chmod(absolutePath, permissions);
}

async function initializeCandidateRepository(workspaceRoot) {
  await runProgSyncCommand("git", ["init", "--quiet"], {
    cwd: workspaceRoot
  });
  await runProgSyncCommand("git", ["add", "--all"], {
    cwd: workspaceRoot
  });
  await runProgSyncCommand("git", ["commit", "--quiet", "--allow-empty", "-m", "candidate baseline"], {
    cwd: workspaceRoot
  });
}

async function collectCandidateChanges(workspaceRoot) {
  await runProgSyncCommand("git", ["add", "--all"], { cwd: workspaceRoot });
  const [names, diff] = await Promise.all([
    runProgSyncCommand("git", ["diff", "--cached", "--name-only", "-z", "HEAD", "--"], {
      cwd: workspaceRoot,
      maxBuffer: 32 * 1024 * 1024,
      outputEncoding: "base64"
    }),
    runProgSyncCommand("git", ["diff", "--cached", "--no-ext-diff", "--binary", "HEAD", "--"], {
      cwd: workspaceRoot,
      maxBuffer: 64 * 1024 * 1024,
      outputEncoding: "base64"
    })
  ]);
  return {
    changedPaths: parseNulPaths(names.stdout),
    diff: diff.stdout
  };
}

async function validateImplementationCandidate({
  absolutePath,
  implementationPath = path.basename(absolutePath),
  projectRoot = path.dirname(absolutePath),
  targetKind
}) {
  if (targetKind === "javascript") {
    try {
      await runProgSyncCommand(process.execPath, ["--check", absolutePath], {
        cwd: path.dirname(absolutePath),
        maxBuffer: 4 * 1024 * 1024
      });
    } catch (error) {
      throw new ProgSyncError(
        "INVALID_IMPLEMENTATION",
        "JavaScript candidate does not parse.",
        { stderr: String(error?.stderr || error?.message || "").trim() }
      );
    }
  }
  const source = await fs.readFile(absolutePath, "utf8");
  await extractSourceFacts({
    implementationPath,
    projectRoot,
    source,
    targetKind
  });
}

function typeReferences(parsedProgram) {
  return parsedProgram.typeReferences || [];
}

function providedTypes(source) {
  if (!source) {
    return new Map();
  }
  const parsed = assertValidProgram(source, { programPath: SHARED_TYPES_PATH });
  return new Map(parsed.provides.map((provided) => [
    symbolAnchor(provided.name),
    provided
  ]));
}

function validateSharedTypeCandidate({
  currentTypesSource,
  finalProgramSource,
  finalTypesSource,
  previousProgramSource,
  typesChanged
}) {
  const finalProgram = assertValidProgram(finalProgramSource);
  const finalReferences = typeReferences(finalProgram);
  const finalUseAnchors = new Set(finalReferences.map((reference) => (
    symbolAnchor(reference.name)
  )));
  const finalTypes = providedTypes(finalTypesSource);
  const missing = [...finalUseAnchors].filter((anchor) => !finalTypes.has(anchor));
  if (missing.length > 0) {
    throw new ProgSyncError(
      "INVALID_PROGRAM",
      "Every [Type name] reference must be provided by program/types.md.",
      { missing }
    );
  }
  if (!typesChanged) {
    return;
  }

  const currentTypes = providedTypes(currentTypesSource);
  const previousUses = previousProgramSource
    ? typeReferences(parseProgram(previousProgramSource)).map((reference) => (
      symbolAnchor(reference.name)
    ))
    : [];
  const permittedChanges = new Set([...previousUses, ...finalUseAnchors]);
  const diagnostics = [];
  for (const [anchor, current] of currentTypes) {
    const candidate = finalTypes.get(anchor);
    if (!candidate) {
      diagnostics.push(`Shared type ${current.name} cannot be removed during module synchronization.`);
      continue;
    }
    if (
      candidate.name !== current.name ||
      candidate.description !== current.description
    ) {
      if (!permittedChanges.has(anchor)) {
        diagnostics.push(`Unrelated shared type ${current.name} was modified.`);
      }
    }
  }
  for (const [anchor, candidate] of finalTypes) {
    if (!currentTypes.has(anchor) && !finalUseAnchors.has(anchor)) {
      diagnostics.push(`New shared type ${candidate.name} is not used by this Program module.`);
    }
  }
  if (diagnostics.length > 0) {
    throw new ProgSyncError(
      "INVALID_PROGRAM",
      "The shared type candidate exceeds this module's synchronization boundary.",
      { diagnostics }
    );
  }
}

async function runCandidateSynchronization({
  capsule,
  onEvent,
  pair,
  prompt,
  runner,
  snapshot
}) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });

  try {
    if (snapshot.P1.exists) {
      await writeWorkspaceFile(
        workspaceRoot,
        pair.programPath,
        snapshot.P1.source,
        snapshot.P1.permissions
      );
    }
    if (snapshot.I1.exists) {
      await writeWorkspaceFile(
        workspaceRoot,
        pair.implementationPath,
        snapshot.I1.source,
        snapshot.I1.permissions
      );
    }
    if (capsule.sharedTypes.exists) {
      await writeWorkspaceFile(
        workspaceRoot,
        SHARED_TYPES_PATH,
        capsule.sharedTypes.source,
        capsule.sharedTypes.permissions
      );
    }
    try {
      const packageSource = await fs.readFile(
        absoluteProjectPath(pair.projectRoot, "package.json"),
        "utf8"
      );
      await writeWorkspaceFile(workspaceRoot, "package.json", packageSource);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await writeWorkspaceFile(
      workspaceRoot,
      ".progsync/context.json",
      `${JSON.stringify(capsule, null, 2)}\n`
    );
    await initializeCandidateRepository(workspaceRoot);

    const report = validateRunnerResult(await runner({
      allowedPaths: capsule.target.allowedPaths,
      mode: capsule.mode,
      onEvent,
      prompt,
      workspaceRoot
    }));
    if (report.mode !== capsule.mode) {
      throw new ProgSyncError(
        "CODEX_MODE_MISMATCH",
        `Codex reported ${report.mode} while ProgSync selected ${capsule.mode}.`
      );
    }

    const changes = await collectCandidateChanges(workspaceRoot);
    const allowed = new Set(capsule.target.allowedPaths);
    const forbidden = changes.changedPaths.filter((filePath) => !allowed.has(filePath));
    if (forbidden.length > 0) {
      throw new ProgSyncError(
        "ATOMIC_WRITE_BOUNDARY_VIOLATION",
        "Codex changed files outside the atomic write boundary.",
        { forbidden }
      );
    }
    if (report.status === "blocked") {
      return {
        candidates: [],
        changedPaths: [],
        diff: "",
        report
      };
    }
    if (report.status === "unchanged" && changes.changedPaths.length > 0) {
      throw new ProgSyncError(
        "CODEX_REPORT_MISMATCH",
        "Codex reported unchanged but modified candidate files.",
        { changedPaths: changes.changedPaths }
      );
    }
    if (
      report.status === "unchanged" &&
      capsule.mode !== "NO_CHANGE" &&
      report.verificationPerformed.length === 0
    ) {
      throw new ProgSyncError(
        "CODEX_REPORT_MISMATCH",
        "Codex reported unchanged without identifying how conformance was verified."
      );
    }
    if (report.status === "updated" && changes.changedPaths.length === 0) {
      throw new ProgSyncError(
        "CODEX_REPORT_MISMATCH",
        "Codex reported updated but produced no candidate changes."
      );
    }

    const candidates = [];
    for (const relativePath of changes.changedPaths) {
      const absolutePath = path.join(workspaceRoot, ...relativePath.split("/"));
      let stat;
      try {
        stat = await fs.lstat(absolutePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new ProgSyncError(
            "EXPLICIT_DELETION_REQUIRED",
            `Codex deleted ${relativePath}; deletion must be explicit.`
          );
        }
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new ProgSyncError(
          "REGULAR_FILE_REQUIRED",
          `Codex candidate must be a regular file: ${relativePath}`
        );
      }
      let source;
      try {
        source = await fs.readFile(absolutePath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new ProgSyncError(
            "EXPLICIT_DELETION_REQUIRED",
            `Codex deleted ${relativePath}; deletion must be explicit.`
          );
        }
        throw error;
      }
      if (relativePath === pair.implementationPath) {
        await validateImplementationCandidate({
          absolutePath,
          implementationPath: pair.implementationPath,
          projectRoot: workspaceRoot,
          targetKind: pair.target.kind
        });
      }
      if (relativePath === SHARED_TYPES_PATH) {
        assertValidProgram(source, { programPath: SHARED_TYPES_PATH });
      }
      candidates.push({
        mode: (stat.mode & 0o111) === 0 ? 0o644 : 0o755,
        permissions: stat.mode & 0o777,
        relativePath,
        source
      });
    }

    const programCandidate = candidates.find((entry) => entry.relativePath === pair.programPath);
    const implementationCandidate = candidates.find((entry) => (
      entry.relativePath === pair.implementationPath
    ));
    const finalProgram = programCandidate?.source || snapshot.P1.source;
    const finalImplementation = implementationCandidate?.source || snapshot.I1.source;
    if (!finalProgram || !finalImplementation) {
      throw new ProgSyncError(
        "PAIR_INCOMPLETE",
        "A successful candidate must leave both Program and implementation present."
      );
    }
    if (capsule.sharedTypes.editable) {
      const sharedTypesCandidate = candidates.find((entry) => (
        entry.relativePath === SHARED_TYPES_PATH
      ));
      validateSharedTypeCandidate({
        currentTypesSource: capsule.sharedTypes.source,
        finalProgramSource: finalProgram,
        finalTypesSource: sharedTypesCandidate?.source || capsule.sharedTypes.source,
        previousProgramSource: snapshot.P1.source,
        typesChanged: Boolean(sharedTypesCandidate)
      });
    }
    await validatePairConformance({
      implementationSource: finalImplementation,
      mode: capsule.mode,
      pair,
      programSource: finalProgram
    });

    return {
      candidates,
      changedPaths: changes.changedPaths,
      diff: changes.diff,
      report
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function applyCandidates({
  candidates,
  expectedFiles = [],
  expectedPair = null,
  pair,
  programSourceForProjection = null
}) {
  const writes = [...candidates];
  const programCandidate = candidates.find((candidate) => candidate.relativePath === pair.programPath);
  const projectionSource = programCandidate?.source || programSourceForProjection;
  if (projectionSource) {
    const projection = buildProgramProjection({
      programPath: pair.programPath,
      programSource: projectionSource
    });
    const projectionPath = projectionPathForProgram(pair.programPath);
    writes.push({
      relativePath: projectionPath,
      source: stableJson(projection)
    });
  }
  const sharedTypesCandidate = candidates.find((candidate) => (
    candidate.relativePath === SHARED_TYPES_PATH
  ));
  if (sharedTypesCandidate) {
    const projection = buildProgramProjection({
      programPath: SHARED_TYPES_PATH,
      programSource: sharedTypesCandidate.source
    });
    writes.push({
      relativePath: projectionPathForProgram(SHARED_TYPES_PATH),
      source: stableJson(projection)
    });
  }
  const originals = new Map();
  for (const write of writes) {
    originals.set(write.relativePath, await readWorkingFile(pair.projectRoot, write.relativePath));
  }
  for (const expected of expectedFiles) {
    const current = originals.get(expected.relativePath) ||
      await readWorkingFile(pair.projectRoot, expected.relativePath);
    if (workingFileChanged(expected.state, current)) {
      throw new ProgSyncError(
        "PAIR_CHANGED_DURING_SYNCHRONIZATION",
        `${expected.relativePath} changed while the candidate was being prepared; no candidate was applied.`,
        { relativePath: expected.relativePath }
      );
    }
  }
  if (expectedPair) {
    const currentProgram = originals.get(pair.programPath) ||
      await readWorkingFile(pair.projectRoot, pair.programPath);
    const currentImplementation = originals.get(pair.implementationPath) ||
      await readWorkingFile(pair.projectRoot, pair.implementationPath);
    if (
      workingFileChanged(expectedPair.program, currentProgram) ||
      workingFileChanged(expectedPair.implementation, currentImplementation)
    ) {
      throw new ProgSyncError(
        "PAIR_CHANGED_DURING_SYNCHRONIZATION",
        "Program or implementation changed while the candidate was being prepared; no candidate was applied.",
        {
          implementationPath: pair.implementationPath,
          programPath: pair.programPath
        }
      );
    }
  }
  const effectiveWrites = writes.filter((write) => {
    const original = originals.get(write.relativePath);
    const permissions = write.permissions ?? original?.permissions ?? 0o644;
    return !original.exists ||
      original.source !== write.source ||
      original.permissions !== permissions;
  });
  const staged = new Map();
  try {
    for (const write of effectiveWrites) {
      const original = originals.get(write.relativePath);
      const permissions = write.permissions ?? original?.permissions ?? 0o644;
      staged.set(write.relativePath, await stageFileWrite(
        absoluteProjectPath(pair.projectRoot, write.relativePath),
        write.source,
        permissions
      ));
    }
  } catch (error) {
    await Promise.all([...staged.values()].map((temporaryPath) => (
      fs.rm(temporaryPath, { force: true })
    )));
    throw error;
  }

  const completed = [];
  try {
    for (const write of effectiveWrites) {
      const original = originals.get(write.relativePath);
      const targetPath = absoluteProjectPath(pair.projectRoot, write.relativePath);
      const backupPath = await installStagedWrite({
        original,
        stagedPath: staged.get(write.relativePath),
        targetPath
      });
      staged.delete(write.relativePath);
      completed.push({ backupPath, original, targetPath, write });
    }
    for (const completedWrite of completed) {
      if (!completedWrite.backupPath) {
        continue;
      }
      const backup = await readAbsoluteFile(completedWrite.backupPath);
      if (workingFileChanged(completedWrite.original, backup)) {
        throw new ProgSyncError(
          "PAIR_CHANGED_DURING_SYNCHRONIZATION",
          "A project file changed through an open handle while ProgSync was applying its candidate.",
          { recoveryPath: completedWrite.backupPath }
        );
      }
    }
  } catch (error) {
    const rollbackDiagnostics = [];
    for (const completedWrite of completed.reverse()) {
      const { backupPath, original, targetPath, write } = completedWrite;
      try {
        const current = await readAbsoluteFile(targetPath);
        const attemptedState = {
          exists: true,
          mode: (write.permissions ?? original?.permissions ?? 0o644) & 0o111
            ? 0o755
            : 0o644,
          permissions: write.permissions ?? original?.permissions ?? 0o644,
          source: write.source
        };
        if (workingFileChanged(attemptedState, current)) {
          rollbackDiagnostics.push(
            `${write.relativePath} changed again during rollback and was left untouched.`
          );
          continue;
        }
        await fs.rm(targetPath, { force: true });
        if (backupPath) {
          const restored = await restoreDisplacedFile({ backupPath, targetPath });
          if (!restored) {
            rollbackDiagnostics.push(
              `${write.relativePath} was recreated during rollback; its backup remains at ${backupPath}.`
            );
          }
        }
      } catch (rollbackError) {
        rollbackDiagnostics.push(`${write.relativePath}: ${rollbackError.message}`);
      }
    }
    await Promise.all([...staged.values()].map((temporaryPath) => (
      fs.rm(temporaryPath, { force: true })
    )));
    if (rollbackDiagnostics.length > 0) {
      throw new ProgSyncError(
        "APPLY_ROLLBACK_INCOMPLETE",
        "ProgSync could not fully roll back a failed candidate application.",
        {
          cause: error.message,
          diagnostics: rollbackDiagnostics
        }
      );
    }
    throw error;
  } finally {
    await Promise.all([...staged.values()].map((temporaryPath) => (
      fs.rm(temporaryPath, { force: true })
    )));
  }
  await Promise.all(completed.map(({ backupPath }) => (
    backupPath ? fs.rm(backupPath, { force: true }) : Promise.resolve()
  )));
  return effectiveWrites.map((write) => write.relativePath);
}

export {
  applyCandidates,
  installStagedWrite,
  runCandidateSynchronization,
  validateImplementationCandidate
};
