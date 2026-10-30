import { realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import {
  backtickedArguments,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  processArguments,
  projectPath,
  runtimeArguments,
  stackOperationHash
} from "./stackOperation.js";

const VIBE64_ARCHITECTURE_INSPECTION_CONTRACT = "vibe64.architecture-inspection.v1";
const VIBE64_ARCHITECTURE_INSPECTION_SECTION = "Architecture inspection";
const ERROR_CODE = "VIBE64_ARCHITECTURE_INSPECTION_INVALID";
const SECTION_PATH = "genesis/stack.md#Architecture inspection";
const MAX_TIMEOUT_SECONDS = 120;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES = 64 * 1024;
const REQUIRED_FIELDS = Object.freeze(["runtimeRequirements", "workdir", "argv", "timeout", "maxBuffer"]);
// Entry label -> [inspector field, value form]; shared by the parser, its errors and the agent spec.
const ARCHITECTURE_INSPECTOR_FIELDS = Object.freeze({
  Runtime: ["runtimeRequirements", "`runtime`..."],
  Directory: ["workdir", "`path`"],
  Command: ["argv", "`command` `argument`..."],
  "Timeout seconds": ["timeout", `\`1\` through \`${MAX_TIMEOUT_SECONDS}\``],
  "Max output bytes": ["maxBuffer", `\`1\` through \`${MAX_OUTPUT_BYTES}\``],
  "Entry files": ["entryFiles", "`path`... (optional)"],
  "Required files": ["requiredFiles", "`path`... (optional)"],
  "Preview locator": ["previewLocator", "`path` (optional .js file)"]
});
const FIELD_LINE = new RegExp(`^- (${Object.keys(ARCHITECTURE_INSPECTOR_FIELDS).join("|")}): (.+)$`, "u");

function parseVibe64ArchitectureInspectionLines(lines, { path = SECTION_PATH } = {}) {
  if (!Array.isArray(lines)) invalidStackOperation(ERROR_CODE, path, "Architecture inspection requires exact Stack section lines.");
  if (isExplicitlyEmptyStackSection(lines)) return [];
  const inspectors = [];
  const ids = new Set();
  let current;
  function finish() {
    if (!current) return;
    for (const name of REQUIRED_FIELDS) {
      if (current[name] === undefined) invalidStackOperation(ERROR_CODE, path, `${current.id} is missing ${name}.`);
    }
    inspectors.push(current);
    current = null;
  }
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^### Inspector `([a-z0-9]+(?:-[a-z0-9]+)*)`: (.+)$/u);
    if (heading) {
      finish();
      if (ids.has(heading[1])) invalidStackOperation(ERROR_CODE, path, "Duplicate inspector id.", index + 1);
      ids.add(heading[1]);
      current = { id: heading[1], title: heading[2] };
      continue;
    }
    if (!current) invalidStackOperation(ERROR_CODE, path, "Expected an Inspector heading.", index + 1);
    const field = line.match(FIELD_LINE);
    if (!field) {
      const forms = Object.entries(ARCHITECTURE_INSPECTOR_FIELDS).map(([label, [, value]]) => `- ${label}: ${value}`).join("; ");
      invalidStackOperation(ERROR_CODE, path, `Unknown architecture inspector field. Use one of: ${forms}.`, index + 1);
    }
    const [key] = ARCHITECTURE_INSPECTOR_FIELDS[field[1]];
    if (current[key] !== undefined) invalidStackOperation(ERROR_CODE, path, `Duplicate ${field[1]}.`, index + 1);
    if (key === "runtimeRequirements") {
      current[key] = runtimeArguments(field[2], ERROR_CODE, path, "Inspector runtime", index + 1);
    } else if (key === "argv") {
      current[key] = processArguments(field[2], ERROR_CODE, path, "Inspector command", index + 1);
    } else if (key === "entryFiles" || key === "requiredFiles") {
      current[key] = backtickedArguments(field[2], ERROR_CODE, path, field[1], index + 1)
        .map(value => projectPath(value, ERROR_CODE, path, field[1], index + 1));
    } else {
      const [value] = backtickedArguments(field[2], ERROR_CODE, path, field[1], index + 1, { count: 1 });
      if (key === "workdir") {
        current[key] = projectPath(value, ERROR_CODE, path, "Inspector directory", index + 1);
      } else if (key === "previewLocator") {
        current[key] = previewLocatorPath(value, path, index + 1);
      } else {
        const number = Number(value);
        const max = key === "timeout" ? MAX_TIMEOUT_SECONDS : MAX_OUTPUT_BYTES;
        if (!/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(number) || number > max) {
          invalidStackOperation(ERROR_CODE, path, `${field[1]} must be from 1 to ${max}.`, index + 1);
        }
        current[key] = key === "timeout" ? number * 1000 : number;
      }
    }
  }
  finish();
  if (!inspectors.length) invalidStackOperation(ERROR_CODE, path, "Use an Inspector entry or - Nothing.");
  return inspectors;
}

function previewLocatorPath(value, operationPath, line) {
  projectPath(value, ERROR_CODE, operationPath, "Preview locator", line, { allowRoot: false });
  if (!value.endsWith(".js")) invalidStackOperation(ERROR_CODE, operationPath, "Preview locator must name a .js file.", line);
  return value;
}

// Reads a recipe's Preview locator for the Preview page: a regular .js file of
// at most 64 KiB inside the source root (node_modules included), reached
// without symlinks so it cannot name a file outside the project.
async function readArchitecturePreviewLocator(sourceRoot, locatorPath) {
  previewLocatorPath(locatorPath, SECTION_PATH);
  const refuse = (problem) => invalidStackOperation(ERROR_CODE, SECTION_PATH, `Preview locator \`${locatorPath}\` ${problem}.`);
  let handle;
  try {
    const expected = path.join(await realpath(sourceRoot), locatorPath);
    if (await realpath(expected) !== expected) refuse("must not be or pass through a symlink");
    handle = await open(expected, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = await handle.stat();
    if (!stats.isFile()) refuse("must be a regular file");
    if (stats.size > ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES) refuse(`must be at most ${ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES} bytes`);
    return { path: locatorPath, source: await handle.readFile("utf8") };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") refuse("is not a file in this project");
    if (error?.code === "ELOOP") refuse("must not be or pass through a symlink");
    throw error;
  } finally {
    await handle?.close();
  }
}

function vibe64ArchitectureInspection(section) {
  const inspectors = section.status === "ready" ? parseVibe64ArchitectureInspectionLines(section.lines) : [];
  for (const inspector of inspectors) {
    if (inspector.runtimeRequirements.some(id => !section.components.includes(id))) {
      invalidStackOperation(ERROR_CODE, SECTION_PATH, "Inspector runtimes must be selected in Stack.");
    }
  }
  return {
    contract: VIBE64_ARCHITECTURE_INSPECTION_CONTRACT,
    status: section.status,
    stackHash: section.stackHash,
    inspectors,
    recipeHash: stackOperationHash(inspectors),
    diagnostics: section.diagnostics || []
  };
}

export {
  ARCHITECTURE_INSPECTOR_FIELDS,
  ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES,
  VIBE64_ARCHITECTURE_INSPECTION_CONTRACT,
  VIBE64_ARCHITECTURE_INSPECTION_SECTION,
  parseVibe64ArchitectureInspectionLines,
  readArchitecturePreviewLocator,
  vibe64ArchitectureInspection
};
