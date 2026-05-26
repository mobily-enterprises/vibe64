import {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_MARKERS,
  GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  GenericNodeWebTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/ai-studio-core/server/deepFreeze";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createGenericNodeWebLaunchTargetTerminalSpec,
  createGenericNodeWebLaunchDescriptor,
  listGenericNodeWebLaunchTargets
} from "./launchTargets.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createGenericNodeWebTargetScriptTerminalSpec,
  inspectGenericNodeWebCurrentApp,
  inspectGenericNodeWebTargetScripts
} from "./currentApp.js";
export {
  GENERIC_NODE_WEB_CLIENT_LIBRARY_CONFIG,
  GENERIC_NODE_WEB_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";

const GENERIC_NODE_WEB_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createGenericNodeWebAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createGenericNodeWebTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createGenericNodeWebLaunchTargetTerminalSpec,
  launchTargets = listGenericNodeWebLaunchTargets
} = {}) {
  return new GenericNodeWebTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: GENERIC_NODE_WEB_AI_STUDIO_COMMANDS
  });
}

export {
  GENERIC_NODE_WEB_AI_STUDIO_COMMANDS,
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_MARKERS,
  GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  GenericNodeWebTargetAdapter,
  createGenericNodeWebAiStudioCommandTerminalSpec,
  createGenericNodeWebLaunchDescriptor,
  createGenericNodeWebLaunchTargetTerminalSpec,
  createGenericNodeWebTargetAdapter,
  listGenericNodeWebLaunchTargets
};
