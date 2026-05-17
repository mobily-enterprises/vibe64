import {
  normalizeText
} from "./core.js";
import {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterProjectFacts,
  adapterPromptResult
} from "./adapter.js";

function normalizeStringMap(value = {}) {
  return Object.fromEntries(
    Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [normalizeText(key), normalizeText(entry)])
  );
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

  async finishSession({
    action = {}
  } = {}) {
    const actionId = normalizeText(action.id || "finish_session");
    return adapterActionResult(this.actionResults[actionId] || {
      message: "Fake adapter finished the AI Studio session."
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
    return adapterPromptResult({
      context: fakePromptContext({
        action,
        input,
        session
      }),
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

export { FakeTargetAdapter };
