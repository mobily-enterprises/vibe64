import {
  CPP_CONFIG_FIELDS,
  CPP_MARKERS,
  CPP_PROMPT_PACK_ROOT,
  CppTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/ai-studio-core/server/deepFreeze";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  cmakeBuildCommand,
  cmakeConfigureCommand,
  createCppTargetScriptTerminalSpec,
  ctestCommand,
  inspectCppCurrentApp,
  inspectCppTargetScripts
} from "./currentApp.js";

export {
  CPP_BUILD_SYSTEM_CONFIG,
  CPP_BUILD_TYPE_CONFIG,
  CPP_CXX_STANDARD_CONFIG,
  CPP_PROJECT_KIND_CONFIG,
  CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  CPP_TESTING_CONFIG
} from "./constants.js";

export {
  CPP_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

export {
  seedCppProjectScript
} from "./seedProject.js";

export {
  createCppSetupDoctorPlugin
} from "./setupDoctorPlugin.js";

const CPP_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createCppAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createCppTargetAdapter({
  commandTerminalSpecFactory = null
} = {}) {
  return new CppTargetAdapter({
    commandTerminalSpecFactory,
    commands: CPP_AI_STUDIO_COMMANDS
  });
}

export {
  createCppAiStudioCommandTerminalSpec,
  createCppTargetAdapter,
  CPP_AI_STUDIO_COMMANDS,
  CPP_CONFIG_FIELDS,
  CPP_MARKERS,
  CPP_PROMPT_PACK_ROOT,
  CppTargetAdapter
};
