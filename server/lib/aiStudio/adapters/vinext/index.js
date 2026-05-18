import {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VinextTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createVinextAppReviewTerminalSpec,
  createVinextLaunchTargetTerminalSpec,
  createVinextReviewDescriptor,
  listVinextLaunchTargets
} from "./appReviewTerminal.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createVinextTargetScriptTerminalSpec,
  inspectVinextCurrentApp,
  inspectVinextTargetScripts
} from "./currentApp.js";
export {
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";

const VINEXT_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createVinextAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createVinextTargetAdapter({
  appReviewTerminalSpecFactory = createVinextAppReviewTerminalSpec,
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createVinextLaunchTargetTerminalSpec,
  launchTargets = listVinextLaunchTargets
} = {}) {
  return new VinextTargetAdapter({
    appReviewTerminalSpecFactory,
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: VINEXT_AI_STUDIO_COMMANDS
  });
}

export {
  createVinextAiStudioCommandTerminalSpec,
  createVinextAppReviewTerminalSpec,
  createVinextLaunchTargetTerminalSpec,
  createVinextReviewDescriptor,
  createVinextTargetAdapter,
  listVinextLaunchTargets,
  VINEXT_AI_STUDIO_COMMANDS,
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VinextTargetAdapter
};
