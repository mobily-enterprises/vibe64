import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionConnectedContribution, sessionConnectedSources } from "@local/vibe64-core/server/projectRepository";
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
  if (!isConnectedPackageType(type)) throw vibe64Error(
    `Choose a package type for ${connection.name}, or declare Default package type in Connected development.`,
    "vibe64_connected_package_type_required");
  if (connectedPackageTypeUsesScript(type) && !connection.script) throw vibe64Error(
    `Choose a project script for custom connection ${connection.name}.`, "vibe64_connected_custom_script_required");
  if (!connectedPackageTypeUsesScript(type) && connection.script) throw vibe64Error(
    `The ${type} connection ${connection.name} cannot select a custom script.`, "vibe64_connected_custom_script_invalid");
  return type;
}

// The caller holds the originating session/source admission and supplies only
// freshly authorized receiving sessions. This projection grants no access.
async function readConnectedDevelopmentInputs({ session, projects, inspection, env,
  runCommand = runVibe64Command } = {}) {
  const sourceRoot = sessionSourcePath(session);
  if (!sourceRoot || inspection?.status !== "ready") throw vibe64Error(
    "Declare Connected development in this project's Stack before preparing its connected source inputs.",
    "vibe64_connected_development_required");
  const configured = await readConnectedProjects(sourceRoot);
  const bindings = sessionConnectedSources(session);
  if (!Array.isArray(projects) || projects.length !== configured.projects.length) throw vibe64Error(
    "The connected project list changed. Prepare its current sources again.", "vibe64_connected_sources_changed");
  const resolved = [];
  for (const connection of configured.projects) {
    const receiving = projects.find(project => project.repository === connection.repository);
    const binding = bindings.find(item => item.contribution.repository === githubRepositoryFullName(connection.repository));
    const contribution = sessionConnectedContribution(receiving?.session);
    const receivingRoot = sessionSourcePath(receiving?.session);
    if (!binding || !receiving || receiving.projectSlug !== binding.projectSlug ||
        !isDeepStrictEqual(contribution, binding.contribution) || !receivingRoot ||
        receiving.session.sourceReady !== true) throw vibe64Error(
      `The authorized source for ${connection.repository} no longer matches this task. Prepare it again.`,
      "vibe64_connected_sources_changed");
    if (!(await lstat(receivingRoot)).isDirectory()) throw vibe64Error(
      `The receiving source for ${connection.repository} must be an ordinary directory.`, "vibe64_connected_source_unavailable");
    resolved.push({ ...connection, type: connectedPackageType(connection, inspection),
      sourceRoot: receivingRoot, contributionId: contribution.id });
  }
  const relativePath = inspection.sourcesFile;
  const { filePath, existing } = await readConnectedSourceProjection({
    sourceRoot, sessionId: session.sessionId, relativePath, env, runCommand
  });
  const value = { contract: CONNECTED_SOURCES_CONTRACT, sessionId: session.sessionId, projects: resolved };
  return { sourceRoot, relativePath, filePath, existing, value,
    result: { sourcesFile: relativePath, recipeHash: inspection.recipeHash, status: "inputs-prepared" } };
}

// Reading a projection never grants access to its paths. Execution separately
// resolves each receiving session through the original authenticated action.
async function readConnectedSourceProjection({ sourceRoot, sessionId, relativePath, env,
  runCommand = runVibe64Command }) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath) || relativePath.includes("\\") ||
      relativePath.split(/[\\/]/u).some(part => ["", ".", "..", ".git"].includes(part.toLowerCase()))) {
    throw vibe64Error("The connected sources file must be a safe project-relative path outside Git metadata.",
      "vibe64_connected_source_file_invalid");
  }
  const filePath = await assertProjectionPath(sourceRoot, relativePath, {
    label: "Connected sources file", code: "vibe64_connected_source_file"
  });
  const tracked = await runCommand({ actor: "app", command: "git",
    args: ["ls-files", "--stage", "-z", "--", relativePath], cwd: sourceRoot,
    allowedRoots: [sourceRoot], ...(env ? { baseEnv: env } : {}), envPolicy: "session",
    mode: "capture", purpose: "source", runtimes: ["git"], timeout: 30_000 });
  if (!tracked.ok) throw vibe64Error("Could not check whether the connected sources file is tracked. Preserve it and retry.",
    "vibe64_connected_source_file_git_unavailable");
  if (tracked.stdout) throw vibe64Error("The connected sources file is tracked. Choose a development-only location in Stack; source files were preserved.",
    "vibe64_connected_source_file_tracked");

  let existing;
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("Not an ordinary bounded source input file.");
    existing = JSON.parse(await file.readFile("utf8"));
    if (existing.contract !== CONNECTED_SOURCES_CONTRACT || existing.sessionId !== sessionId) {
      throw new Error("The file does not belong to this session.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw vibe64Error(
      "The connected sources file contains unrelated or invalid content. Preserve it and choose another location in Stack.",
      "vibe64_connected_source_file_owned");
  } finally {
    await file?.close();
  }
  return { filePath, existing };
}

async function inspectConnectedWorkspaceSetup({ session, setup, inspection, env,
  runCommand = runVibe64Command } = {}) {
  const sourceRoot = sessionSourcePath(session);
  const configured = await readConnectedProjects(sourceRoot);
  if (configured.projects.length === 0 && inspection.status === "unconfigured") return setup;
  if (!["ready", "unconfigured"].includes(setup.status)) return setup;
  try {
    if (inspection.status !== "ready") throw vibe64Error(
      "Declare Connected development in Stack to prepare this task's connected sources.",
      "vibe64_connected_development_required");
    const { existing } = await readConnectedSourceProjection({ sourceRoot, sessionId: session.sessionId,
      relativePath: inspection.sourcesFile, env, runCommand });
    const bindings = sessionConnectedSources(session);
    const expected = configured.projects.map(connection => {
      const binding = bindings.find(item => item.contribution.repository === githubRepositoryFullName(connection.repository));
      const entry = existing?.projects?.find(item => item.repository === connection.repository);
      if (!binding || typeof entry?.sourceRoot !== "string" || !path.isAbsolute(entry.sourceRoot)) return null;
      return { ...connection, type: connectedPackageType(connection, inspection),
        contributionId: binding.contribution.id, sourceRoot: entry.sourceRoot };
    });
    if (!existing || expected.some(entry => entry === null) || !isDeepStrictEqual(existing.projects, expected)) {
      throw vibe64Error("Prepare connected sources for this task's current connection list.", "vibe64_connected_inputs_required");
    }
    const inputsHash = connectedDevelopmentHash(existing);
    const custom = expected.filter(connection => connection.type === "custom");
    if (custom.length && !inspection.customRunner) throw vibe64Error(
      "Declare a Custom runner in Connected development to run this project's custom scripts.",
      "vibe64_connected_custom_runner_required");
    // Vibe64 runs no package manager for a declared type; the project's own
    // Verify command must prove each non-custom ecosystem's treatment.
    const declaredTypes = [...new Set(expected.map(connection => connection.type)
      .filter(type => !connectedPackageTypeUsesScript(type)))];
    if (declaredTypes.length && !inspection.steps.some(step => step.phase === "verify")) {
      throw vibe64Error(`Declare a Verify command for the connected ${declaredTypes.join(" and ")} packages.`,
        "vibe64_connected_verification_required");
    }
    const customSteps = [];
    for (const connection of custom) {
      const script = await assertProjectionPath(sourceRoot, connection.script, {
        label: "Custom connection script", code: "vibe64_connected_custom_script"
      });
      if (!(await lstat(script)).isFile()) throw vibe64Error(
        `Custom connection script must be a project file: ${connection.script}.`, "vibe64_connected_custom_script_invalid");
      for (const phase of ["prepare", "verify"]) customSteps.push({ ...inspection.customRunner, phase,
        label: `${phase === "prepare" ? "Prepare" : "Verify"} custom connection: ${connection.name}`,
        argv: [...inspection.customRunner.argv, script, "--phase", phase, "--source-root", connection.sourceRoot,
          "--project-root", sourceRoot, "--sources-file", path.join(sourceRoot, inspection.sourcesFile),
          "--repository", connection.repository] });
    }
    const connectedSteps = [...inspection.steps, ...customSteps];
    const steps = [...setup.steps, ...connectedSteps.filter(step => step.phase === "prepare"),
      ...connectedSteps.filter(step => step.phase === "verify")];
    return { ...setup, status: "ready", steps,
      runtimeRequirements: [...new Set(steps.flatMap(step => step.runtimeRequirements))].sort(),
      recipeHash: connectedDevelopmentHash({ workspace: setup.recipeHash, connected: inspection.recipeHash, inputs: inputsHash }),
      connectedDevelopment: { sourcesFile: inspection.sourcesFile, inputsHash, recipeHash: inspection.recipeHash }
    };
  } catch (error) {
    return { ...setup, status: "blocked", recipeHash: "", steps: [],
      ...(inspection.status === "ready" ? { connectedDevelopment: {
        sourcesFile: inspection.sourcesFile, recipeHash: inspection.recipeHash
      } } : {}),
      diagnostics: [...setup.diagnostics, { code: error.code || "vibe64_connected_inputs_required", message: error.message }] };
  }
}

async function materializeConnectedDevelopmentInputs(input = {}) {
  const { sourceRoot, relativePath, filePath, existing, value, result } = await readConnectedDevelopmentInputs(input);
  await writeManagedGitExcludes(sourceRoot, [relativePath], { section: "connected source", atomicJson: true });
  if (!isDeepStrictEqual(existing, value)) {
    await writeJsonFileAtomic(filePath, value, { directoryMode: vibe64SharedModes().inheritingDirectory, fileMode: vibe64SharedModes().file });
  }
  return result;
}

async function inspectConnectedDevelopmentInputs(input = {}) {
  const { existing, value, result } = await readConnectedDevelopmentInputs(input);
  if (!isDeepStrictEqual(existing, value)) throw vibe64Error(
    "The connected source map is missing or no longer matches this task. Prepare connected sources again before running development commands.",
    "vibe64_connected_inputs_required");
  return { ...result,
    inputsHash: connectedDevelopmentHash(value),
    sourceRoots: input.projects.map(project => sessionSourcePath(project.session))
  };
}

export { inspectConnectedDevelopmentInputs, inspectConnectedWorkspaceSetup, materializeConnectedDevelopmentInputs };
