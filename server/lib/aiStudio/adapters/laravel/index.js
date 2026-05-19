import {
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROMPT_PACK_ROOT,
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  LaravelTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
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
  LARAVEL_AUTHENTICATION_CONFIG,
  LARAVEL_BOOST_CONFIG,
  LARAVEL_CUSTOM_STARTER_CONFIG,
  LARAVEL_DATABASE_RUNTIME_CONFIG,
  LARAVEL_LIVEWIRE_COMPONENTS_CONFIG,
  LARAVEL_PACKAGE_MANAGER_CONFIG,
  LARAVEL_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  LARAVEL_STARTER_KIT_CONFIG,
  LARAVEL_TEAMS_CONFIG,
  LARAVEL_TESTING_CONFIG
} from "./constants.js";

const LARAVEL_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createLaravelAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createLaravelTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createLaravelLaunchTargetTerminalSpec,
  launchTargets = listLaravelLaunchTargets
} = {}) {
  return new LaravelTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: LARAVEL_AI_STUDIO_COMMANDS
  });
}

export {
  createLaravelAiStudioCommandTerminalSpec,
  createLaravelLaunchDescriptor,
  createLaravelLaunchTargetTerminalSpec,
  createLaravelTargetAdapter,
  listLaravelLaunchTargets,
  LARAVEL_AI_STUDIO_COMMANDS,
  LARAVEL_CONFIG_FIELDS,
  LARAVEL_MARKERS,
  LARAVEL_PROMPT_PACK_ROOT,
  LARAVEL_PREPARE_WORKTREE_SCRIPT_PATH,
  LaravelTargetAdapter
};
