import {
  aiStudioError,
  normalizeText
} from "./core.js";

const ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

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
    promptId: normalizeText(input.promptId),
    visiblePrompt: normalizeText(input.visiblePrompt)
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

function promptIdForAction(action = {}) {
  return normalizeText(action.promptId || action.id);
}

function visiblePromptForAction(action = {}, promptId = "") {
  return normalizeText(action.label || promptId);
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

function fakePromptContext({
  action = {},
  input = {},
  session = {}
} = {}) {
  return {
    action,
    adapter: session.adapter || {},
    input,
    session
  };
}

function fakePromptText({
  input = {},
  promptId = "",
  session = {}
} = {}) {
  return [
    `Fake adapter prompt for ${promptId}.`,
    "",
    "Adapter facts:",
    promptJson(session.adapter?.facts || {}),
    "",
    "Adapter prompt context:",
    promptJson(session.adapter?.promptContext || {}),
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

  async runCommand(commandId) {
    return adapterActionResult({
      message: `Recorded adapter command ${assertCommandId(commandId)}.`
    });
  }

  async renderPrompt({
    action = {},
    input = {}
  } = {}) {
    const promptId = promptIdForAction(action);
    return adapterPromptResult({
      prompt: defaultPromptText(action, input),
      promptId,
      visiblePrompt: visiblePromptForAction(action, promptId)
    });
  }

  async getEditableArtifacts() {
    return [];
  }
}

class FakeTargetAdapter extends TargetAdapter {
  constructor({
    actionResults = {},
    capabilities = {},
    commands = [],
    detection = {},
    facts = {},
    id = "fake",
    label = "Fake adapter",
    promptContext = {},
    promptResults = {}
  } = {}) {
    super({
      id,
      label
    });
    this.actionResults = actionResults;
    this.capabilities = capabilities;
    this.commands = commands;
    this.detection = detection;
    this.facts = facts;
    this.promptContext = promptContext;
    this.promptResults = promptResults;
  }

  async detect() {
    return adapterDetection(this.detection);
  }

  async inspect() {
    return adapterProjectFacts({
      ...this.facts,
      capabilities: this.capabilities,
      commands: this.commands,
      promptContext: this.promptContext
    });
  }

  async getPromptContext() {
    return normalizeStringMap(this.promptContext);
  }

  async listCommands() {
    return this.commands.map(adapterCommand);
  }

  async runCommand(commandId) {
    const normalizedCommandId = assertCommandId(commandId);
    return adapterActionResult(this.actionResults[normalizedCommandId] || {
      message: `Fake adapter ran ${normalizedCommandId}.`
    });
  }

  async renderPrompt({
    action = {},
    input = {},
    session = {}
  } = {}) {
    const promptId = promptIdForAction(action);
    const visiblePrompt = visiblePromptForAction(action, promptId);
    const promptResult = this.promptResults[promptId];
    if (promptResult) {
      return adapterPromptResult({
        promptId,
        visiblePrompt,
        ...promptResult
      });
    }
    const context = fakePromptContext({
      action,
      input,
      session
    });
    return adapterPromptResult({
      context,
      prompt: fakePromptText({
        input,
        promptId,
        session
      }),
      promptId,
      visiblePrompt
    });
  }
}

export {
  FakeTargetAdapter,
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterPromptResult,
  adapterProjectFacts,
  adapterView
};
