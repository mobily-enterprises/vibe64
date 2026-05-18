import {
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROMPT_PACK_ROOT,
  NextjsTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createNextjsAppReviewTerminalSpec,
  createNextjsLaunchTargetTerminalSpec,
  createNextjsReviewDescriptor,
  listNextjsLaunchTargets
} from "./appReviewTerminal.js";

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
  NEXTJS_REVIEW_MODE_CONFIG,
  NEXTJS_SEED_BUNDLER_CONFIG,
  NEXTJS_SEED_IMPORT_ALIAS_CONFIG,
  NEXTJS_SEED_LANGUAGE_CONFIG,
  NEXTJS_SEED_LINTER_CONFIG,
  NEXTJS_SEED_SOURCE_LAYOUT_CONFIG,
  NEXTJS_SEED_STYLING_CONFIG
} from "./constants.js";

const NEXTJS_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createNextjsAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createNextjsTargetAdapter({
  appReviewTerminalSpecFactory = createNextjsAppReviewTerminalSpec,
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createNextjsLaunchTargetTerminalSpec,
  launchTargets = listNextjsLaunchTargets
} = {}) {
  return new NextjsTargetAdapter({
    appReviewTerminalSpecFactory,
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: NEXTJS_AI_STUDIO_COMMANDS
  });
}

export {
  createNextjsAiStudioCommandTerminalSpec,
  createNextjsAppReviewTerminalSpec,
  createNextjsLaunchTargetTerminalSpec,
  createNextjsReviewDescriptor,
  createNextjsTargetAdapter,
  listNextjsLaunchTargets,
  NEXTJS_AI_STUDIO_COMMANDS,
  NEXTJS_CONFIG_FIELDS,
  NEXTJS_MARKERS,
  NEXTJS_PROMPT_PACK_ROOT,
  NextjsTargetAdapter
};
