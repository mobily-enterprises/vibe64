import {
  CPP_CONFIG_FIELDS,
  CPP_MARKERS,
  CPP_PROMPT_PACK_ROOT,
  CppTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_WORKFLOW_COMMANDS,
  createVibe64WorkflowCommandTerminalSpec
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
  seedCppProjectScript
} from "./seedProject.js";

export {
  createCppSetupDoctorPlugin
} from "./setupDoctorPlugin.js";

const CPP_VIBE64_COMMANDS = deepFreeze(VIBE64_WORKFLOW_COMMANDS);
const createCppVibe64CommandTerminalSpec = createVibe64WorkflowCommandTerminalSpec;

function createCppTargetAdapter({
  commandTerminalSpecFactory = null
} = {}) {
  return new CppTargetAdapter({
    commandTerminalSpecFactory,
    commands: CPP_VIBE64_COMMANDS
  });
}

export {
  createCppVibe64CommandTerminalSpec,
  createCppTargetAdapter,
  CPP_VIBE64_COMMANDS,
  CPP_CONFIG_FIELDS,
  CPP_MARKERS,
  CPP_PROMPT_PACK_ROOT,
  CppTargetAdapter
};
