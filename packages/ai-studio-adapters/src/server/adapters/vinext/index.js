import {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  VinextTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/ai-studio-core/server/deepFreeze";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createVinextAppReviewTerminalSpec,
  createVinextLaunchTargetTerminalSpec,
  createVinextLaunchDescriptor,
  createVinextReviewDescriptor,
  listVinextLaunchTargets
} from "./launchTargets.js";

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
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createVinextLaunchTargetTerminalSpec,
  launchTargets = listVinextLaunchTargets
} = {}) {
  return new VinextTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: VINEXT_AI_STUDIO_COMMANDS
  });
}

export {
  createVinextAiStudioCommandTerminalSpec,
  createVinextAppReviewTerminalSpec,
  createVinextLaunchDescriptor,
  createVinextLaunchTargetTerminalSpec,
  createVinextReviewDescriptor,
  createVinextTargetAdapter,
  listVinextLaunchTargets,
  VINEXT_AI_STUDIO_COMMANDS,
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  VinextTargetAdapter
};
