import { access } from "node:fs/promises";
import path from "node:path";

import {
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  stackCommand,
  stackOperationHash,
  uniqueSorted
} from "./stackOperation.js";

const VIBE64_WORKSPACE_SETUP_CONTRACT = "vibe64.workspace-setup.v1";
const VIBE64_WORKSPACE_SETUP_SECTION = "Workspace setup";
const ERROR_CODE = "VIBE64_WORKSPACE_SETUP_INVALID";
const WORKSPACE_SETUP_ENTRY_FORM = "- Prepare `label` with `runtime` [in `workdir`] [when|if `path` exists]: `command` `argument`...";
const PREPARE_LINE = /^- Prepare `([^`\r\n]+)` (.+)$/u;

function invalid(setupPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, setupPath, message, line, details);
}

function parseVibe64WorkspaceSetupLines(lines, {
  path: setupPath = "genesis/stack.md#Workspace setup"
} = {}) {
  if (!Array.isArray(lines)) {
    invalid(setupPath, "Workspace setup must be supplied as exact Stack section lines.");
  }
  if (isExplicitlyEmptyStackSection(lines)) return [];

  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
    const entry = source.match(PREPARE_LINE);
    if (!entry) {
      invalid(
        setupPath,
        `Every Workspace setup entry must use: ${WORKSPACE_SETUP_ENTRY_FORM}`,
        line,
        { observed: source }
      );
    }

    steps.push({
      label: oneLineText(entry[1], ERROR_CODE, setupPath, "Workspace setup step label", line),
      ...stackCommand(entry[2], ERROR_CODE, setupPath, "Workspace setup", line, {
        form: WORKSPACE_SETUP_ENTRY_FORM,
        observed: source
      })
    });
  }
  if (steps.length === 0) {
    invalid(setupPath, "## Workspace setup needs at least one Prepare entry or exactly `- Nothing.`.");
  }
  return steps;
}

async function pathExists(projectRoot, relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return false;
    throw error;
  }
}

async function vibe64WorkspaceSetupInspection({ projectRoot, section = {} } = {}) {
  const diagnostics = [...(section.diagnostics || [])];
  let steps = [];
  if (section.status === "ready") steps = parseVibe64WorkspaceSetupLines(section.lines);
  const applicableSteps = [];
  const waitingFor = [];
  const root = path.resolve(projectRoot);
  if (diagnostics.length === 0) {
    for (const step of steps) {
      if (!step.condition || await pathExists(root, step.condition.pathExists)) {
        applicableSteps.push(step);
        continue;
      }
      if (step.condition.onMissing === "wait") waitingFor.push(step.condition.pathExists);
    }
  }
  if (waitingFor.length > 0) {
    const paths = uniqueSorted(waitingFor);
    diagnostics.push({
      code: "VIBE64_WORKSPACE_SETUP_WAITING",
      message: `Workspace setup is waiting for project ${paths.length === 1 ? "path" : "paths"}: ${paths.join(", ")}.`,
      details: { paths }
    });
  }
  const waiting = diagnostics.some(({ code }) => code === "VIBE64_WORKSPACE_SETUP_WAITING");
  const blocked = diagnostics.some(({ code }) => code !== "VIBE64_WORKSPACE_SETUP_WAITING");
  let status = "unconfigured";
  if (blocked) status = "blocked";
  else if (!waiting && applicableSteps.length > 0) status = "ready";
  const normalizedSteps = applicableSteps.map(({ condition: _condition, ...step }) => step);
  const recipe = { version: 1, steps: normalizedSteps };
  return {
    contract: VIBE64_WORKSPACE_SETUP_CONTRACT,
    status,
    stackHash: section.stackHash,
    recipeHash: status === "ready" ? stackOperationHash(recipe) : "",
    components: [...(section.components || [])],
    source: section.source || null,
    runtimeRequirements: uniqueSorted(
      normalizedSteps.flatMap((step) => step.runtimeRequirements)
    ),
    steps: normalizedSteps,
    diagnostics
  };
}

export {
  WORKSPACE_SETUP_ENTRY_FORM,
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  parseVibe64WorkspaceSetupLines,
  vibe64WorkspaceSetupInspection
};
