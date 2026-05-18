import {
  JSKIT_CONFIG_FIELDS,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createJskitAppReviewTerminalSpec,
  createJskitLaunchTargetTerminalSpec,
  listJskitLaunchTargets
} from "./appReviewTerminal.js";
export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createJskitTargetScriptTerminalSpec,
  inspectJskitCurrentApp,
  inspectJskitTargetScripts,
  targetScriptCommandPreview
} from "./currentApp.js";

const JSKIT_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createJskitAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createJskitTargetAdapter({
  appReviewTerminalSpecFactory = createJskitAppReviewTerminalSpec,
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createJskitLaunchTargetTerminalSpec,
  launchTargets = listJskitLaunchTargets
} = {}) {
  return new JskitTargetAdapter({
    appReviewTerminalSpecFactory,
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: JSKIT_AI_STUDIO_COMMANDS
  });
}

export {
  createJskitTargetAdapter,
  createJskitAppReviewTerminalSpec,
  createJskitAiStudioCommandTerminalSpec,
  createJskitLaunchTargetTerminalSpec,
  listJskitLaunchTargets,
  JSKIT_CONFIG_FIELDS,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_AI_STUDIO_COMMANDS,
  JskitTargetAdapter
};
