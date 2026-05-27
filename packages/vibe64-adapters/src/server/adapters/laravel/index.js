import {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROMPT_PACK_ROOT,
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  LaravelTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  listLaravelLaunchTargets
} from "./launchTargets.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createLaravelTargetScriptTerminalSpec,
  inspectLaravelCurrentApp,
  inspectLaravelTargetScripts
} from "./currentApp.js";
export {
  LARAVEL_DATABASE_RUNTIME_CONFIG,
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";

const LARAVEL_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createLaravelVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createLaravelTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createLaravelLaunchTargetTerminalSpec,
  launchTargets = listLaravelLaunchTargets
} = {}) {
  return new LaravelTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: LARAVEL_VIBE64_COMMANDS
  });
}

export {
  createLaravelVibe64CommandTerminalSpec,
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  createLaravelTargetAdapter,
  listLaravelLaunchTargets,
  LARAVEL_VIBE64_COMMANDS,
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROMPT_PACK_ROOT,
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  LaravelTargetAdapter
};
