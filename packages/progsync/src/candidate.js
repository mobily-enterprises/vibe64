import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runProgSyncCommand } from "./command.js";
import { validatePairConformance } from "./conformance.js";
import { validateRunnerResult } from "./codexRunner.js";
import { ProgSyncError } from "./errors.js";
import { stageFileWrite, writeFileAtomic } from "./files.js";
import { parseNulPaths, readWorkingFile } from "./git.js";
import {
  absoluteProjectPath,
  projectionPathForProgram,
  slashPath
} from "./paths.js";
import {
  buildProgramProjection,
  stableJson
} from "./program.js";
import { fileChanged } from "./state.js";
import { extractSourceFacts } from "./structural.js";

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

async function validateImplementationCandidate({ absolutePath, targetKind }) {
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
    implementationPath: path.basename(absolutePath),
    projectRoot: path.dirname(absolutePath),
    source,
    targetKind
  });
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
          targetKind: pair.target.kind
        });
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
  const originals = new Map();
  for (const write of writes) {
    originals.set(write.relativePath, await readWorkingFile(pair.projectRoot, write.relativePath));
  }
  if (expectedPair) {
    const currentProgram = originals.get(pair.programPath) ||
      await readWorkingFile(pair.projectRoot, pair.programPath);
    const currentImplementation = originals.get(pair.implementationPath) ||
      await readWorkingFile(pair.projectRoot, pair.implementationPath);
    if (
      fileChanged(expectedPair.program, currentProgram) ||
      fileChanged(expectedPair.implementation, currentImplementation)
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
      await fs.rename(
        staged.get(write.relativePath),
        absoluteProjectPath(pair.projectRoot, write.relativePath)
      );
      staged.delete(write.relativePath);
      completed.push(write.relativePath);
    }
  } catch (error) {
    const rollbackDiagnostics = [];
    for (const relativePath of completed.reverse()) {
      const original = originals.get(relativePath);
      const absolutePath = absoluteProjectPath(pair.projectRoot, relativePath);
      const attempted = effectiveWrites.find((write) => write.relativePath === relativePath);
      try {
        const current = await readWorkingFile(pair.projectRoot, relativePath);
        const attemptedState = {
          exists: true,
          mode: (attempted.permissions ?? original?.permissions ?? 0o644) & 0o111
            ? 0o755
            : 0o644,
          source: attempted.source
        };
        if (fileChanged(attemptedState, current)) {
          rollbackDiagnostics.push(
            `${relativePath} changed again during rollback and was left untouched.`
          );
          continue;
        }
        if (original.exists) {
          await writeFileAtomic(absolutePath, original.source, original.permissions);
        } else {
          await fs.rm(absolutePath, { force: true });
        }
      } catch (rollbackError) {
        rollbackDiagnostics.push(`${relativePath}: ${rollbackError.message}`);
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
  return effectiveWrites.map((write) => write.relativePath);
}

export {
  applyCandidates,
  runCandidateSynchronization,
  validateImplementationCandidate
};
