import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  CONNECTED_SOURCES_CONTRACT,
  connectedPackageTypeHasAdapter,
  connectedPackageTypeUsesScript,
  isConnectedPackageType
} from "@local/vibe64-genesis/shared/connectedPackageTypes";
import { connectedAdapterSteps, restoreDisconnected } from "./connectedAdapters/index.js";
import { githubRepositoryFullName, readConnectedProjects } from "./connectedProjects.js";
import { assertProjectionPath, writeManagedGitExcludes, writeSourceFileAtomic } from "./projectEnvironmentFiles.js";
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
 * Whether preparation has connected work: a listed repository, or project commands the Stack
 * declares. A Stack piece's default package type alone, with nothing listed, changes nothing.
 * @param {object} inspection the Connected development inspection
 * @param {Array<object>} repositories the listed connections
 */
function connectedDevelopmentApplies(inspection, repositories) {
  return repositories.length > 0 || (inspection?.status === "ready" &&
    (inspection.steps?.length > 0 || inspection.saveSteps?.length > 0 || Boolean(inspection.customRunner)));
}

/**
 * The Sources file value for this session: every listed connected repository
 * with its effective package type and this session's own copy as its source.
 * A Stack without a Sources file gets no file; the value still identifies the selection.
 */
async function readConnectedDevelopmentInputs({
  session,
  inspection,
  env,
  runCommand = runVibe64Command
} = {}) {
  const sourceRoot = sessionSourcePath(session);
  const configured = sourceRoot ? await readConnectedProjects(sourceRoot) : { repositories: [] };
  if (!sourceRoot || !(inspection?.status === "ready" || (inspection?.status === "unconfigured" && configured.repositories.length))) {
    throw vibe64Error(
      "Declare Connected development in this project's Stack before preparing its connected repositories.",
      "vibe64_connected_development_required"
    );
  }
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
  const relativePath = inspection.sourcesFile || "";
  const value = { schema: CONNECTED_SOURCES_CONTRACT, sessionId: session.sessionId, repositories: resolved };
  const { filePath, existing } = relativePath ? await readConnectedSourceProjection({
    sourceRoot,
    sessionId: session.sessionId,
    relativePath,
    env,
    runCommand
  }) : { filePath: "", existing: value };
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
  if (!connectedDevelopmentApplies(inspection, configured.repositories)) return setup;
  if (!["ready", "unconfigured"].includes(setup.status)) return setup;
  const steps = inspection.status === "ready" ? inspection.steps : [];
  const customRunner = inspection.status === "ready" ? inspection.customRunner : null;
  // Save runs these, not preparation; their runtimes join the recipe's so Save has them.
  const saveSteps = inspection.status === "ready" ? inspection.saveSteps : [];
  try {
    if (!["ready", "unconfigured"].includes(inspection.status)) {
      throw vibe64Error(
        "Declare Connected development in Stack to prepare this session's connected repositories.",
        "vibe64_connected_development_setup_required"
      );
    }
    const expected = configured.repositories.map(connection => {
      const copy = connectedCopyFor(session, connection);
      return copy ? { ...connection, type: connectedPackageType(connection, inspection), sourceRoot: copy.path } : null;
    });
    const value = { schema: CONNECTED_SOURCES_CONTRACT, sessionId: session.sessionId, repositories: expected };
    const { existing } = inspection.sourcesFile ? await readConnectedSourceProjection({
      sourceRoot,
      sessionId: session.sessionId,
      relativePath: inspection.sourcesFile,
      env,
      runCommand
    }) : { existing: value };
    if (!existing || expected.some(entry => entry === null) || !isDeepStrictEqual(existing.repositories, expected)) {
      throw vibe64Error("Prepare this session's connected repositories for its current list.", "vibe64_connected_inputs_required");
    }
    const inputsHash = connectedDevelopmentHash(existing);
    const custom = expected.filter(connection => connection.type === "custom");
    if (custom.length && !customRunner) {
      throw vibe64Error(
        "Declare a Custom runner in Connected development to run this project's custom scripts.",
        "vibe64_connected_custom_runner_required"
      );
    }
    // Vibe64 puts each typed dependency in effect itself. A composition is raw
    // source the project assembles, so its own Verify command must prove it.
    const compositionTypes = [...new Set(expected.filter(connection => connection.relationship === "composition")
      .map(connection => connection.type).filter(type => !connectedPackageTypeUsesScript(type)))];
    if (compositionTypes.length && !steps.some(step => step.phase === "verify")) {
      throw vibe64Error(
        `Declare a Verify command for the connected ${compositionTypes.join(" and ")} composition.`,
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
          ...customRunner,
          phase,
          label: `${phase === "prepare" ? "Prepare" : "Verify"} custom connection: ${connection.name}`,
          argv: [...customRunner.argv, script, "--phase", phase, "--source-root", connection.sourceRoot,
            "--project-root", sourceRoot, "--sources-file", path.join(sourceRoot, inspection.sourcesFile),
            "--repository", connection.repository]
        });
      }
    }
    // Each typed dependency gets Vibe64's own steps: kept in effect after each Prepare step but the
    // last, Workspace setup's and the connected ones, so no step runs the project on a published
    // copy an install before it put back (a database preparation migrates with it); put in effect
    // after the last; proved after the Verify steps.
    const adapterSteps = connectedAdapterSteps(expected.filter(connection =>
      connection.relationship === "dependency" && connectedPackageTypeHasAdapter(connection.type)));
    const adapterStepsFor = action => adapterSteps.filter(step => step.connectedAdapter.action === action);
    const projectSteps = [...steps, ...customSteps];
    const prepareSteps = [...setup.steps, ...projectSteps.filter(step => step.phase === "prepare")];
    const recipeSteps = [
      ...prepareSteps.flatMap((step, index) => [step, ...(index < prepareSteps.length - 1 ? adapterStepsFor("keep") : [])]),
      ...adapterStepsFor("apply"),
      ...projectSteps.filter(step => step.phase === "verify"),
      ...adapterStepsFor("proof")];
    return {
      ...setup,
      status: "ready",
      steps: recipeSteps,
      runtimeRequirements: [...new Set([...recipeSteps, ...saveSteps].flatMap(step => step.runtimeRequirements))].sort(),
      recipeHash: connectedDevelopmentHash({ workspace: setup.recipeHash, connected: inspection.recipeHash || "", inputs: inputsHash }),
      connectedDevelopment: {
        sourcesFile: inspection.sourcesFile || "",
        inputsHash,
        recipeHash: inspection.recipeHash || "",
        adapters: adapterStepsFor("proof").length > 0,
        saveSteps
      }
    };
  } catch (error) {
    return {
      ...setup,
      status: "blocked",
      recipeHash: "",
      steps: [],
      // Preparation makes the copies a blocked recipe is missing, then inspects it again.
      ...(["ready", "unconfigured"].includes(inspection.status) ? {
        connectedDevelopment: {
          sourcesFile: inspection.sourcesFile || "",
          recipeHash: inspection.recipeHash || ""
        }
      } : {}),
      diagnostics: [...setup.diagnostics, { code: error.code || "vibe64_connected_inputs_required", message: error.message }]
    };
  }
}

/**
 * Writes this session's Sources file, when the Stack declares one, and puts back what an adapter
 * changed for a repository that is no longer a typed dependency. `lines` are the preparation's.
 */
async function materializeConnectedDevelopmentInputs(input = {}) {
  const { sourceRoot, relativePath, filePath, existing, value, result } = await readConnectedDevelopmentInputs(input);
  const lines = await restoreDisconnected({ repositories: value.repositories, sessionSourceRoot: sourceRoot });
  if (!relativePath) return { ...result, lines };
  await writeManagedGitExcludes(sourceRoot, [relativePath], { section: "connected source" });
  if (!isDeepStrictEqual(existing, value)) {
    await writeSourceFileAtomic(sourceRoot, filePath, `${JSON.stringify(value, null, 2)}\n`, {
      directoryMode: vibe64SharedModes().inheritingDirectory,
      fileMode: vibe64SharedModes().file
    });
  }
  return { ...result, lines };
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
    repositories: value.repositories,
    sourceRoots: value.repositories.map(entry => entry.sourceRoot)
  };
}

export {
  connectedDevelopmentApplies,
  inspectConnectedDevelopmentInputs,
  inspectConnectedWorkspaceSetup,
  materializeConnectedDevelopmentInputs
};
