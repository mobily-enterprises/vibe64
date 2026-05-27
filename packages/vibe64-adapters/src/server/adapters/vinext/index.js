import {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  VinextTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
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

const VINEXT_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createVinextVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createVinextTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createVinextLaunchTargetTerminalSpec,
  launchTargets = listVinextLaunchTargets
} = {}) {
  return new VinextTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: VINEXT_VIBE64_COMMANDS
  });
}

export {
  createVinextVibe64CommandTerminalSpec,
  createVinextAppReviewTerminalSpec,
  createVinextLaunchDescriptor,
  createVinextLaunchTargetTerminalSpec,
  createVinextReviewDescriptor,
  createVinextTargetAdapter,
  listVinextLaunchTargets,
  VINEXT_VIBE64_COMMANDS,
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VINEXT_PREPARE_WORKTREE_SCRIPT_PATH,
  VinextTargetAdapter
};
