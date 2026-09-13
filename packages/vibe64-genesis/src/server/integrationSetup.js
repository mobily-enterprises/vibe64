import {
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  processArguments,
  projectPath,
  runtimeArguments,
  stackOperationHash
} from "./stackOperation.js";

const VIBE64_INTEGRATION_SETUP_CONTRACT = "vibe64.integration-setup.v1";
const VIBE64_INTEGRATION_SETUP_SECTION = "Integration setup";
const ERROR_CODE = "VIBE64_INTEGRATION_SETUP_INVALID";

function parseVibe64IntegrationSetupLines(lines, {
  path: setupPath = "genesis/stack.md#Integration setup"
} = {}) {
  if (!Array.isArray(lines)) {
    invalidStackOperation(ERROR_CODE, setupPath, "Integration setup requires exact Stack section lines.");
  }
  if (isExplicitlyEmptyStackSection(lines)) return null;
  const entries = lines.map((line) => line.trim()).filter(Boolean);
  const entry = entries.length === 1 && entries[0].match(/^- Command with (.+?) in `([^`\r\n]+)`: (.+)$/u);
  if (!entry) {
    invalidStackOperation(ERROR_CODE, setupPath,
      "Integration setup requires exactly one entry: - Command with `runtime` in `workdir`: `command` `argument`...; or - Nothing.");
  }
  return {
    argv: processArguments(entry[3], ERROR_CODE, setupPath, "Integration setup command"),
    workdir: projectPath(entry[2], ERROR_CODE, setupPath, "Integration setup workdir"),
    runtimeRequirements: runtimeArguments(entry[1], ERROR_CODE, setupPath, "Integration setup runtimes")
  };
}

function vibe64IntegrationSetupInspection({ section = {} } = {}) {
  const diagnostics = [...(section.diagnostics || [])];
  const command = section.status === "ready" && diagnostics.length === 0
    ? parseVibe64IntegrationSetupLines(section.lines) : null;
  return {
    contract: VIBE64_INTEGRATION_SETUP_CONTRACT,
    status: diagnostics.length ? "blocked" : command ? "ready" : "unconfigured",
    stackHash: section.stackHash,
    recipeHash: command ? stackOperationHash({ version: 1, command }) : "",
    source: section.source || null,
    components: [...(section.components || [])],
    command,
    diagnostics
  };
}

export {
  VIBE64_INTEGRATION_SETUP_CONTRACT,
  VIBE64_INTEGRATION_SETUP_SECTION,
  parseVibe64IntegrationSetupLines,
  vibe64IntegrationSetupInspection
};
