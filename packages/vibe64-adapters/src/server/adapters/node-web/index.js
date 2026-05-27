import {
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_MARKERS,
  GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  GenericNodeWebTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
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

const GENERIC_NODE_WEB_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createGenericNodeWebVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createGenericNodeWebTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createGenericNodeWebLaunchTargetTerminalSpec,
  launchTargets = listGenericNodeWebLaunchTargets
} = {}) {
  return new GenericNodeWebTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: GENERIC_NODE_WEB_VIBE64_COMMANDS
  });
}

export {
  GENERIC_NODE_WEB_VIBE64_COMMANDS,
  GENERIC_NODE_WEB_CONFIG_FIELDS,
  GENERIC_NODE_WEB_MARKERS,
  GENERIC_NODE_WEB_PROMPT_PACK_ROOT,
  GENERIC_NODE_WEB_PREPARE_WORKTREE_SCRIPT_PATH,
  GenericNodeWebTargetAdapter,
  createGenericNodeWebVibe64CommandTerminalSpec,
  createGenericNodeWebLaunchDescriptor,
  createGenericNodeWebLaunchTargetTerminalSpec,
  createGenericNodeWebTargetAdapter,
  listGenericNodeWebLaunchTargets
};
