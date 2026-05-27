import {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROMPT_PACK_ROOT,
  NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
  NextjsTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createNextjsLaunchTargetTerminalSpec,
  createNextjsLaunchDescriptor,
  listNextjsLaunchTargets
} from "./launchTargets.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts
} from "./currentApp.js";
export {
  NEXTJS_DATABASE_RUNTIME_CONFIG,
  NEXTJS_DATA_LAYER_CONFIG,
  NEXTJS_PACKAGE_MANAGER_CONFIG,
  NEXTJS_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  NEXTJS_SEED_BUNDLER_CONFIG,
  NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
  NEXTJS_SEED_LANGUAGE_CONFIG,
  NEXTJS_SEED_LINTER_CONFIG,
  NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
  NEXTJS_SEED_STYLING_CONFIG
} from "./constants.js";

const NEXTJS_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createNextjsVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createNextjsTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createNextjsLaunchTargetTerminalSpec,
  launchTargets = listNextjsLaunchTargets
} = {}) {
  return new NextjsTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: NEXTJS_VIBE64_COMMANDS
  });
}

export {
  createNextjsVibe64CommandTerminalSpec,
  createNextjsLaunchDescriptor,
  createNextjsLaunchTargetTerminalSpec,
  createNextjsTargetAdapter,
  listNextjsLaunchTargets,
  NEXTJS_VIBE64_COMMANDS,
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROMPT_PACK_ROOT,
  NEXTJS_PREPARE_WORKTREE_SCRIPT_PATH,
  NextjsTargetAdapter
};
