import {
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  projectPath,
  stackOperationHash,
  uniqueSorted
} from "./stackOperation.js";
import { parseVibe64WorkspaceSetupLines } from "./workspaceSetup.js";

const VIBE64_CONNECTED_DEVELOPMENT_SECTION = "Connected development";
const VIBE64_CONNECTED_DEVELOPMENT_CONTRACT = "vibe64.connected-development.v1";
const ERROR_CODE = "VIBE64_CONNECTED_DEVELOPMENT_INVALID";
const OPERATION_PATH = "genesis/stack.md#Connected development";

function vibe64ConnectedDevelopmentInspection(section = {}) {
  let sourcesFile = "";
  const steps = [];
  const diagnostics = [...(section.diagnostics || [])];
  const declared = section.status === "ready";
  if (declared && !isExplicitlyEmptyStackSection(section.lines)) {
    let verifying = false;
    for (const [index, text] of section.lines.entries()) {
      const source = text.trim();
      if (!source) continue;
      const line = index + 1;
      const file = source.match(/^- Sources file: `([^`\r\n]+)`$/u);
      if (file) {
        if (sourcesFile) invalidStackOperation(ERROR_CODE, OPERATION_PATH, "Declare exactly one Sources file.", line);
        sourcesFile = projectPath(file[1], ERROR_CODE, OPERATION_PATH, "Connected sources file", line, { allowRoot: false });
        if (sourcesFile.split("/").some(part => part.toLowerCase() === ".git")) {
          invalidStackOperation(ERROR_CODE, OPERATION_PATH, "The Sources file must be outside Git metadata.", line);
        }
        continue;
      }
      const entry = source.match(/^- (Prepare|Verify) /u);
      if (!entry) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "Declare a Sources file and Prepare/Verify entries using the Workspace setup command grammar.", line);
      const phase = entry[1] === "Verify" ? "verify" : "prepare";
      if (verifying && phase === "prepare") invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "All Prepare entries must precede Verify entries.", line);
      verifying ||= phase === "verify";
      let step;
      try {
        [step] = parseVibe64WorkspaceSetupLines([source.replace(/^- Verify /u, "- Prepare ")], { path: OPERATION_PATH });
      } catch (error) {
        if (error.code !== "VIBE64_WORKSPACE_SETUP_INVALID") throw error;
        invalidStackOperation(ERROR_CODE, OPERATION_PATH, error.message, line);
      }
      if (step.condition) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "Connected development steps must run unconditionally; a skipped step cannot prove source consumption.", line);
      steps.push({ ...step, phase });
    }
    if (!sourcesFile || !steps.some(step => step.phase === "verify")) {
      invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "Connected development requires a Sources file and at least one Verify entry, or exactly `- Nothing.`.");
    }
  }
  const status = section.status === "blocked" || diagnostics.length
    ? "blocked" : steps.length ? "ready" : "unconfigured";
  return {
    contract: VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
    declared,
    status,
    stackHash: section.stackHash,
    recipeHash: status === "ready" ? stackOperationHash({ version: 1, sourcesFile, steps }) : "",
    components: [...(section.components || [])],
    source: section.source || null,
    sourcesFile,
    steps,
    runtimeRequirements: uniqueSorted(steps.flatMap(step => step.runtimeRequirements)),
    diagnostics
  };
}

export {
  VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
  VIBE64_CONNECTED_DEVELOPMENT_SECTION,
  vibe64ConnectedDevelopmentInspection
};
