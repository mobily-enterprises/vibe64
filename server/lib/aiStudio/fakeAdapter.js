import {
  normalizeText
} from "./core.js";
import {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterProjectFacts,
  adapterPromptResult,
  normalizeStringMap,
  promptIdForAction,
  promptJson
} from "./adapter.js";

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
    const promptResult = this.promptResults[promptId];
    if (promptResult) {
      return adapterPromptResult({
        promptId,
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
      promptId
    });
  }
}

export { FakeTargetAdapter };
