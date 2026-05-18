import {
  JSKIT_ALLOW_SELF_TARGET_CONFIG,
  JSKIT_CONFIG_FIELDS,
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter,
  jskitConfigAllowsStudioSelfTarget
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
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

const JSKIT_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createJskitAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createJskitTargetAdapter({
  commandTerminalSpecFactory = null,
  launchTargetTerminalSpecFactory = createJskitLaunchTargetTerminalSpec,
  launchTargets = listJskitLaunchTargets
} = {}) {
  return new JskitTargetAdapter({
    commandTerminalSpecFactory,
    launchTargetTerminalSpecFactory,
    launchTargets,
    commands: JSKIT_AI_STUDIO_COMMANDS
  });
}

export {
  createJskitTargetAdapter,
  createJskitAiStudioCommandTerminalSpec,
  createJskitLaunchTargetTerminalSpec,
  listJskitLaunchTargets,
  JSKIT_ALLOW_SELF_TARGET_CONFIG,
  JSKIT_CONFIG_FIELDS,
  JSKIT_DEFAULT_CONFIG,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_AI_STUDIO_COMMANDS,
  JskitTargetAdapter,
  jskitConfigAllowsStudioSelfTarget
};
