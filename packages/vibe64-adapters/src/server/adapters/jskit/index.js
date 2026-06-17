import {
  JSKIT_CONFIG_FIELDS,
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  JskitTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createJskitLaunchTargetTerminalSpec,
  listJskitLaunchTargets
} from "./launchTargets.js";
export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  targetScriptCommandPreview
} from "./currentApp.js";

const JSKIT_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createJskitVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createJskitTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createJskitLaunchTargetTerminalSpec,
  launchTargets = listJskitLaunchTargets
} = {}) {
  return new JskitTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: JSKIT_VIBE64_COMMANDS
  });
}

export {
  createJskitTargetAdapter,
  createJskitVibe64CommandTerminalSpec,
  createJskitLaunchTargetTerminalSpec,
  listJskitLaunchTargets,
  JSKIT_CONFIG_FIELDS,
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_PREPARE_WORKTREE_SCRIPT_PATH,
  JSKIT_VIBE64_COMMANDS,
  JskitTargetAdapter
};
