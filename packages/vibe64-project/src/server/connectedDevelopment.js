import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  CONNECTED_SOURCES_CONTRACT,
  connectedPackageTypeUsesScript,
  isConnectedPackageType
} from "@local/vibe64-genesis/shared/connectedPackageTypes";
import { githubRepositoryFullName, readConnectedProjects } from "./connectedProjects.js";
import { assertProjectionPath, writeManagedGitExcludes } from "./projectEnvironmentFiles.js";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

function connectedDevelopmentHash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function connectedPackageType(connection, inspection) {
  const type = connection.type || inspection.defaultPackageType;
  if (!isConnectedPackageType(type)) {
    throw vibe64Error(
      `Choose a package type for ${connection.name}, or declare Default package type in Connected development.`,
      "vibe64_connected_package_type_required"
    );
  }
  if (connectedPackageTypeUsesScript(type) && !connection.script) throw vibe64Error(`Choose a project script for custom connection ${connection.name}.`, "vibe64_connected_custom_script_required");
  if (!connectedPackageTypeUsesScript(type) && connection.script) {
    throw vibe64Error(`The ${type} connection ${connection.name} cannot select a custom script.`, "vibe64_connected_custom_script_invalid", {
      params: {
        type,
        name: connection.name
      }
    });
  }
  return type;
}

/**
 * This session's own copy of one listed connected repository, if Prepare made it.
 * @param {object} session
 * @param {{ repository: string }} connection
 */
function connectedCopyFor(session, connection) {
  const repository = githubRepositoryFullName(connection.repository);
  return sessionConnectedCopies(session).find(copy => copy.repository === repository) || null;
}

/**
 * The Sources file value for this session: every listed connected repository
 * with its effective package type and this session's own copy as its source.
 */
async function readConnectedDevelopmentInputs({
  session,
  inspection,
  env,
  runCommand = runVibe64Command
} = {}) {
  const sourceRoot = sessionSourcePath(session);
  if (!sourceRoot || inspection?.status !== "ready") {
    throw vibe64Error(
      "Declare Connected development in this project's Stack before preparing its connected repositories.",
      "vibe64_connected_development_required"
    );
  }
  const configured = await readConnectedProjects(sourceRoot);
  const resolved = [];
  for (const connection of configured.repositories) {
    const copy = connectedCopyFor(session, connection);
    if (!copy || !(await lstat(copy.path).catch(() => null))?.isDirectory()) {
      throw vibe64Error(
        `This session has no copy of ${connection.repository} yet. Prepare the workspace again.`,
        "vibe64_connected_copy_missing",
        { params: { repository: connection.repository } }
      );
    }
    resolved.push({
      ...connection,
      type: connectedPackageType(connection, inspection),
      sourceRoot: copy.path
    });
  }
  const relativePath = inspection.sourcesFile;
  const { filePath, existing } = await readConnectedSourceProjection({
    sourceRoot,
    sessionId: session.sessionId,
    relativePath,
    env,
    runCommand
  });
  const value = { schema: CONNECTED_SOURCES_CONTRACT, sessionId: session.sessionId, repositories: resolved };
  return {
    sourceRoot,
    relativePath,
    filePath,
    existing,
    value,
    result: { sourcesFile: relativePath, recipeHash: inspection.recipeHash, status: "inputs-prepared" }
  };
}

/**
 * Reading a projection never grants access to its paths. Execution separately
 * checks them against this session's own connected copies.
 */
async function readConnectedSourceProjection({
  sourceRoot,
  sessionId,
  relativePath,
  env,
  runCommand = runVibe64Command
}) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\") ||
      relativePath.split(/[\\/]/u).some(part => ["", ".", "..", ".git"].includes(part.toLowerCase()))) {
    throw vibe64Error(
      "The connected sources file must be a safe project-relative path outside Git metadata.",
      "vibe64_connected_source_file_invalid"
    );
  }
  const filePath = await assertProjectionPath(sourceRoot, relativePath, {
    label: "Connected sources file",
    code: "vibe64_connected_source_file"
  });
  const tracked = await runCommand({
    actor: "app",
    command: "git",
    args: ["ls-files", "--stage", "-z", "--", relativePath],
    cwd: sourceRoot,
    allowedRoots: [sourceRoot],
    ...(env ? { baseEnv: env } : {}),
    envPolicy: "session",
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 30_000
  });
  if (!tracked.ok) {
    throw vibe64Error(
      "Could not check whether the connected sources file is tracked. Preserve it and retry.",
      "vibe64_connected_source_file_git_unavailable"
    );
  }
  if (tracked.stdout) {
    throw vibe64Error(
      "The connected sources file is tracked. Choose a development-only location in Stack; source files were preserved.",
      "vibe64_connected_source_file_tracked"
    );
  }

  let existing;
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("Not an ordinary bounded source input file.");
    existing = JSON.parse(await file.readFile("utf8"));
    if (existing.schema !== CONNECTED_SOURCES_CONTRACT || existing.sessionId !== sessionId) {
      throw new Error("The file does not belong to this session.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw vibe64Error(
        "The connected sources file contains unrelated or invalid content. Preserve it and choose another location in Stack.",
        "vibe64_connected_source_file_owned"
      );
    }
  } finally {
    await file?.close();
  }
  return { filePath, existing };
}

async function inspectConnectedWorkspaceSetup({
  session,
  setup,
  inspection,
  env,
  runCommand = runVibe64Command
} = {}) {
  const sourceRoot = sessionSourcePath(session);
  const configured = await readConnectedProjects(sourceRoot);
  if (configured.repositories.length === 0 && inspection.status === "unconfigured") return setup;
  if (!["ready", "unconfigured"].includes(setup.status)) return setup;
  try {
    if (inspection.status !== "ready") {
      throw vibe64Error(
        "Declare Connected development in Stack to prepare this session's connected repositories.",
        "vibe64_connected_development_setup_required"
      );
    }
    const { existing } = await readConnectedSourceProjection({
      sourceRoot,
      sessionId: session.sessionId,
      relativePath: inspection.sourcesFile,
      env,
      runCommand
    });
    const expected = configured.repositories.map(connection => {
      const copy = connectedCopyFor(session, connection);
      return copy ? { ...connection, type: connectedPackageType(connection, inspection), sourceRoot: copy.path } : null;
    });
    if (!existing || expected.some(entry => entry === null) || !isDeepStrictEqual(existing.repositories, expected)) {
      throw vibe64Error("Prepare this session's connected repositories for its current list.", "vibe64_connected_inputs_required");
    }
    const inputsHash = connectedDevelopmentHash(existing);
    const custom = expected.filter(connection => connection.type === "custom");
    if (custom.length && !inspection.customRunner) {
      throw vibe64Error(
        "Declare a Custom runner in Connected development to run this project's custom scripts.",
        "vibe64_connected_custom_runner_required"
      );
    }
    // Vibe64 runs no package manager for a declared type; the project's own
    // Verify command must prove each non-custom ecosystem's treatment.
    const declaredTypes = [...new Set(expected.map(connection => connection.type)
      .filter(type => !connectedPackageTypeUsesScript(type)))];
    if (declaredTypes.length && !inspection.steps.some(step => step.phase === "verify")) {
      throw vibe64Error(
        `Declare a Verify command for the connected ${declaredTypes.join(" and ")} packages.`,
        "vibe64_connected_verification_required"
      );
    }
    const customSteps = [];
    for (const connection of custom) {
      const script = await assertProjectionPath(sourceRoot, connection.script, {
        label: "Custom connection script",
        code: "vibe64_connected_custom_script"
      });
      if (!(await lstat(script)).isFile()) {
        throw vibe64Error(`Custom connection script must be a project file: ${connection.script}.`, "vibe64_connected_custom_script_not_file", {
          params: {
            script: connection.script
          }
        });
      }
      for (const phase of ["prepare", "verify"]) {
        customSteps.push({
          ...inspection.customRunner,
          phase,
          label: `${phase === "prepare" ? "Prepare" : "Verify"} custom connection: ${connection.name}`,
          argv: [...inspection.customRunner.argv, script, "--phase", phase, "--source-root", connection.sourceRoot,
            "--project-root", sourceRoot, "--sources-file", path.join(sourceRoot, inspection.sourcesFile),
            "--repository", connection.repository]
        });
      }
    }
    const connectedSteps = [...inspection.steps, ...customSteps];
    const steps = [...setup.steps, ...connectedSteps.filter(step => step.phase === "prepare"),
      ...connectedSteps.filter(step => step.phase === "verify")];
    return {
      ...setup,
      status: "ready",
      steps,
      runtimeRequirements: [...new Set(steps.flatMap(step => step.runtimeRequirements))].sort(),
      recipeHash: connectedDevelopmentHash({ workspace: setup.recipeHash, connected: inspection.recipeHash, inputs: inputsHash }),
      connectedDevelopment: { sourcesFile: inspection.sourcesFile, inputsHash, recipeHash: inspection.recipeHash }
    };
  } catch (error) {
    return {
      ...setup,
      status: "blocked",
      recipeHash: "",
      steps: [],
      ...(inspection.status === "ready" ? {
        connectedDevelopment: {
          sourcesFile: inspection.sourcesFile,
          recipeHash: inspection.recipeHash
        }
      } : {}),
      diagnostics: [...setup.diagnostics, { code: error.code || "vibe64_connected_inputs_required", message: error.message }]
    };
  }
}

async function materializeConnectedDevelopmentInputs(input = {}) {
  const { sourceRoot, relativePath, filePath, existing, value, result } = await readConnectedDevelopmentInputs(input);
  await writeManagedGitExcludes(sourceRoot, [relativePath], { section: "connected source", atomicJson: true });
  if (!isDeepStrictEqual(existing, value)) {
    await writeJsonFileAtomic(filePath, value, {
      directoryMode: vibe64SharedModes().inheritingDirectory,
      fileMode: vibe64SharedModes().file
    });
  }
  return result;
}

async function inspectConnectedDevelopmentInputs(input = {}) {
  const { existing, value, result } = await readConnectedDevelopmentInputs(input);
  if (!isDeepStrictEqual(existing, value)) {
    throw vibe64Error(
      "The connected source map is missing or no longer matches this session. Prepare the workspace again before running development commands.",
      "vibe64_connected_source_map_stale"
    );
  }
  return {
    ...result,
    inputsHash: connectedDevelopmentHash(value),
    sourceRoots: value.repositories.map(entry => entry.sourceRoot)
  };
}

export { inspectConnectedDevelopmentInputs, inspectConnectedWorkspaceSetup, materializeConnectedDevelopmentInputs };
