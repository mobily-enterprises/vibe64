import {
  aiStudioError,
  isPlainObject,
  normalizeText
} from "./core.js";

const ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function sortedEntries(value = {}) {
  return Object.entries(isPlainObject(value) ? value : {})
    .sort(([left], [right]) => left.localeCompare(right));
}

function assertAdapterId(adapterId) {
  const normalizedAdapterId = normalizeText(adapterId);
  if (!ADAPTER_ID_PATTERN.test(normalizedAdapterId)) {
    throw aiStudioError(`Invalid AI Studio adapter id: ${normalizedAdapterId || "(empty)"}`, "ai_studio_invalid_adapter_id");
  }
  return normalizedAdapterId;
}

function assertCommandId(commandId) {
  const normalizedCommandId = normalizeText(commandId);
  if (!COMMAND_ID_PATTERN.test(normalizedCommandId)) {
    throw aiStudioError(`Invalid AI Studio adapter command id: ${normalizedCommandId || "(empty)"}`, "ai_studio_invalid_adapter_command_id");
  }
  return normalizedCommandId;
}

function normalizeCapabilityMap(capabilities = {}) {
  if (Array.isArray(capabilities)) {
    return Object.fromEntries(
      capabilities
        .map(normalizeText)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((capability) => [capability, true])
    );
  }
  return Object.fromEntries(
    sortedEntries(capabilities).map(([capability, enabled]) => [normalizeText(capability), Boolean(enabled)])
  );
}

function normalizeStringMap(value = {}) {
  return Object.fromEntries(
    sortedEntries(value).map(([key, entry]) => [normalizeText(key), normalizeText(entry)])
  );
}

function adapterDetection(input = {}) {
  return {
    detected: input.detected !== false,
    reason: normalizeText(input.reason)
  };
}

function adapterCommand(input = {}) {
  return {
    available: input.available !== false,
    disabledReason: normalizeText(input.disabledReason),
    id: assertCommandId(input.id),
    label: normalizeText(input.label || input.id)
  };
}

function adapterActionResult(input = {}) {
  return {
    artifacts: normalizeStringMap(input.artifacts),
    metadata: normalizeStringMap(input.metadata),
    message: normalizeText(input.message),
    status: normalizeText(input.status || "completed")
  };
}

function adapterPromptResult(input = {}) {
  return {
    context: isPlainObject(input.context) ? input.context : {},
    prompt: normalizeText(input.prompt),
    promptId: normalizeText(input.promptId)
  };
}

function adapterProjectFacts(input = {}) {
  return {
    capabilities: normalizeCapabilityMap(input.capabilities),
    commands: Array.isArray(input.commands) ? input.commands.map(adapterCommand) : [],
    promptContext: normalizeStringMap(input.promptContext),
    summary: normalizeText(input.summary)
  };
}

function emptyTargetScripts() {
  return {
    config: {
      exists: false,
      path: ""
    },
    ok: true,
    scriptCount: 0,
    scripts: [],
    starredScriptIds: []
  };
}

function promptIdForAction(action = {}) {
  return normalizeText(action.promptId || action.id);
}

function promptJson(value = {}) {
  return JSON.stringify(value ?? {}, null, 2);
}

function defaultPromptText(action = {}, input = {}) {
  return [
    `Run the AI Studio prompt action: ${normalizeText(action.label || promptIdForAction(action))}.`,
    "",
    "Action input:",
    promptJson(input)
  ].join("\n");
}

function adapterView({
  adapter,
  commands = [],
  detection = {},
  facts = {},
  promptContext = {}
} = {}) {
  const normalizedFacts = adapterProjectFacts(facts);
  return {
    commands: commands.map(adapterCommand),
    detection: adapterDetection(detection),
    facts: normalizedFacts,
    id: adapter.id,
    label: adapter.label,
    promptContext: normalizeStringMap(promptContext)
  };
}

class TargetAdapter {
  constructor({
    id = "generic",
    label = "Generic target"
  } = {}) {
    this.id = assertAdapterId(id);
    this.label = normalizeText(label || id);
  }

  async detect() {
    return adapterDetection({
      detected: true
    });
  }

  async inspect() {
    return adapterProjectFacts();
  }

  async getPromptContext() {
    return {};
  }

  async listCommands() {
    return [];
  }

  async getConfigFields() {
    return [];
  }

  async getDefaultConfig() {
    return {};
  }

  async createCommandTerminalSpec(commandId) {
    return {
      ok: false,
      message: `Command ${assertCommandId(commandId)} does not have a terminal runner.`
    };
  }

  async createAppReviewTerminalSpec() {
    return {
      ok: false,
      message: `${this.label} does not provide an app review terminal.`
    };
  }

  async finishSession() {
    return adapterActionResult({
      message: "Finished AI Studio session."
    });
  }

  async renderPrompt({
    action = {},
    config = {},
    input = {}
  } = {}) {
    void config;
    const promptId = promptIdForAction(action);
    return adapterPromptResult({
      prompt: defaultPromptText(action, input),
      promptId
    });
  }

  async getEditableArtifacts() {
    return [];
  }

  async getSetupDoctorPlugins() {
    return [];
  }

  async allowsStudioSelfTarget() {
    return false;
  }

  async inspectCurrentApp({ targetRoot = "" } = {}) {
    return {
      adapter: this.id,
      appPath: "/",
      config: {},
      directories: [],
      git: {
        enabled: false
      },
      localPackages: {
        appPackageName: "",
        packages: []
      },
      markers: [],
      ok: true,
      ready: true,
      root: normalizeText(targetRoot)
    };
  }

  async listCurrentAppTargetScripts() {
    return emptyTargetScripts();
  }

  async createCurrentAppTargetScriptTerminalSpec() {
    return {
      message: `${this.label} does not provide target script terminals.`,
      ok: false
    };
  }
}

export {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterPromptResult,
  adapterProjectFacts,
  adapterView,
  normalizeStringMap,
  promptIdForAction,
  promptJson
};
