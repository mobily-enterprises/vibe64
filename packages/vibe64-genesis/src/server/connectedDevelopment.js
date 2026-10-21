import {
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  projectPath,
  stackOperationHash,
  uniqueSorted,
  unknownEntryMessage
} from "./stackOperation.js";
import { parseVibe64WorkspaceSetupLines } from "./workspaceSetup.js";
import { connectedPackageTypeListText, isConnectedPackageType } from "../shared/connectedPackageTypes.js";

const VIBE64_CONNECTED_DEVELOPMENT_SECTION = "Connected development";
const VIBE64_CONNECTED_DEVELOPMENT_CONTRACT = "vibe64.connected-development.v1";
const ERROR_CODE = "VIBE64_CONNECTED_DEVELOPMENT_INVALID";
const OPERATION_PATH = "genesis/stack.md#Connected development";
const COMMAND_FORM = "with `runtime` [in `workdir`]: `command` `argument`...";
const CONNECTED_DEVELOPMENT_ENTRY_FORMS = Object.freeze([
  "- Default package type: `type`",
  "- Sources file: `path`",
  `- Prepare \`label\` ${COMMAND_FORM}`,
  `- Verify \`label\` ${COMMAND_FORM}`,
  `- Custom runner ${COMMAND_FORM}`
]);

function vibe64ConnectedDevelopmentInspection(section = {}) {
  let sourcesFile = "";
  let defaultPackageType = "";
  let customRunner = null;
  const steps = [];
  const diagnostics = [...(section.diagnostics || [])];
  const declared = section.status === "ready";
  if (declared && !isExplicitlyEmptyStackSection(section.lines)) {
    let verifying = false;
    for (const [index, text] of section.lines.entries()) {
      const source = text.trim();
      if (!source) continue;
      const line = index + 1;
      const packageType = source.match(/^- Default package type: `([^`\r\n]*)`$/u);
      if (packageType) {
        if (defaultPackageType) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
          "Declare exactly one default package type.", line);
        if (!isConnectedPackageType(packageType[1])) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
          `Default package type must be ${connectedPackageTypeListText()}.`, line);
        defaultPackageType = packageType[1];
        continue;
      }
      const file = source.match(/^- Sources file: `([^`\r\n]+)`$/u);
      if (file) {
        if (sourcesFile) invalidStackOperation(ERROR_CODE, OPERATION_PATH, "Declare exactly one Sources file.", line);
        sourcesFile = projectPath(file[1], ERROR_CODE, OPERATION_PATH, "Connected sources file", line, { allowRoot: false });
        if (sourcesFile.split("/").some(part => part.toLowerCase() === ".git")) {
          invalidStackOperation(ERROR_CODE, OPERATION_PATH, "The Sources file must be outside Git metadata.", line);
        }
        continue;
      }
      const custom = source.startsWith("- Custom runner ");
      const entry = source.match(/^- (Prepare|Verify) /u);
      if (!custom && !entry) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        unknownEntryMessage("Connected development entry", source, CONNECTED_DEVELOPMENT_ENTRY_FORMS), line);
      const phase = entry?.[1] === "Verify" ? "verify" : "prepare";
      if (!custom && verifying && phase === "prepare") invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "All Prepare entries must precede Verify entries.", line);
      verifying ||= !custom && phase === "verify";
      let step;
      try {
        const command = custom ? source.replace("- Custom runner ", "- Prepare `Custom connected source` ")
          : source.replace(/^- Verify /u, "- Prepare ");
        [step] = parseVibe64WorkspaceSetupLines([command], { path: OPERATION_PATH });
      } catch (error) {
        if (error.code !== "VIBE64_WORKSPACE_SETUP_INVALID") throw error;
        invalidStackOperation(ERROR_CODE, OPERATION_PATH, error.message, line);
      }
      if (step.condition) invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "Connected development steps must run unconditionally; a skipped step cannot prove source consumption.", line);
      if (custom) {
        if (customRunner) invalidStackOperation(ERROR_CODE, OPERATION_PATH, "Declare exactly one Custom runner.", line);
        customRunner = step;
      } else steps.push({ ...step, phase });
    }
    const defaultOnly = defaultPackageType && !sourcesFile && !steps.length && !customRunner;
    if (!defaultOnly && (!sourcesFile || (!steps.some(step => step.phase === "verify") && !customRunner))) {
      invalidStackOperation(ERROR_CODE, OPERATION_PATH,
        "Declare a default package type alone, or a Sources file with Verify entries or a Custom runner; use `- Nothing.` for no declaration.");
    }
  }
  const status = section.status === "blocked" || diagnostics.length
    ? "blocked" : steps.length || customRunner ? "ready" : "unconfigured";
  return {
    contract: VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
    declared,
    status,
    stackHash: section.stackHash,
    recipeHash: status === "ready" ? stackOperationHash({ version: 1, sourcesFile, defaultPackageType, customRunner, steps }) : "",
    components: [...(section.components || [])],
    source: section.source || null,
    sourcesFile,
    defaultPackageType,
    customRunner,
    steps,
    runtimeRequirements: uniqueSorted([...steps, ...(customRunner ? [customRunner] : [])].flatMap(step => step.runtimeRequirements)),
    diagnostics
  };
}

export {
  CONNECTED_DEVELOPMENT_ENTRY_FORMS,
  VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
  VIBE64_CONNECTED_DEVELOPMENT_SECTION,
  vibe64ConnectedDevelopmentInspection
};
