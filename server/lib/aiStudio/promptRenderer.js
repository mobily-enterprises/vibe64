import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  aiStudioError,
  isMissingPathError,
  normalizeText
} from "./core.js";

const DEFAULT_PROMPT_ID = "generic";
const PROMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const TEMPLATE_TOKEN_PATTERN = /\{\{([A-Za-z0-9_.-]+)\}\}/gu;

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertPromptId(promptId) {
  const normalizedPromptId = normalizeText(promptId);
  if (!PROMPT_ID_PATTERN.test(normalizedPromptId)) {
    throw aiStudioError(`Invalid AI Studio prompt id: ${normalizedPromptId || "(empty)"}`, "ai_studio_invalid_prompt_id");
  }
  return normalizedPromptId;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, stableValue(value[key])])
    );
  }
  return value ?? null;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value), null, 2);
}

function promptTemplatePath(promptPackRoot, promptId) {
  return path.join(promptPackRoot, `${assertPromptId(promptId)}.txt`);
}

function assertPromptPackRoot(promptPackRoot) {
  const normalizedPromptPackRoot = normalizeText(promptPackRoot);
  if (!normalizedPromptPackRoot) {
    throw aiStudioError("AI Studio prompt renderer requires a prompt pack root.", "ai_studio_prompt_pack_root_missing");
  }
  return path.resolve(normalizedPromptPackRoot);
}

async function readPromptTemplate(promptPackRoot, promptId) {
  const requestedPromptId = assertPromptId(promptId || DEFAULT_PROMPT_ID);
  try {
    return await readFile(promptTemplatePath(promptPackRoot, requestedPromptId), "utf8");
  } catch (error) {
    if (!isMissingPathError(error) || requestedPromptId === DEFAULT_PROMPT_ID) {
      throw error;
    }
    return readPromptTemplate(promptPackRoot, DEFAULT_PROMPT_ID);
  }
}

function promptContextForAction({
  action = {},
  input = {},
  session = {}
} = {}) {
  return normalizePromptContext({
    action,
    adapter: session.adapter,
    input,
    session: sessionPromptContext(session)
  });
}

function normalizePromptContext(context = {}) {
  return {
    action: {
      id: normalizeText(context.action?.id),
      label: normalizeText(context.action?.label),
      promptId: normalizeText(context.action?.promptId || context.action?.id),
      type: normalizeText(context.action?.type)
    },
    adapter: {
      commands: Array.isArray(context.adapter?.commands) ? context.adapter.commands : [],
      detection: isPlainObject(context.adapter?.detection) ? context.adapter.detection : {},
      facts: isPlainObject(context.adapter?.facts) ? context.adapter.facts : {},
      id: normalizeText(context.adapter?.id),
      label: normalizeText(context.adapter?.label),
      promptContext: isPlainObject(context.adapter?.promptContext) ? context.adapter.promptContext : {}
    },
    input: context.input ?? {},
    product: normalizeText(context.product || "ai-studio"),
    session: {
      completedSteps: Array.isArray(context.session?.completedSteps) ? context.session.completedSteps : [],
      currentStep: normalizeText(context.session?.currentStep),
      id: normalizeText(context.session?.id),
      metadata: isPlainObject(context.session?.metadata) ? context.session.metadata : {},
      status: normalizeText(context.session?.status),
      targetRoot: normalizeText(context.session?.targetRoot)
    }
  };
}

function sessionPromptContext(session = {}) {
  return {
    completedSteps: session.completedSteps,
    currentStep: session.currentStep,
    id: session.sessionId || session.id,
    metadata: session.metadata,
    status: session.status,
    targetRoot: session.targetRoot
  };
}

function promptTemplateTokens(contextInput) {
  const context = normalizePromptContext(contextInput);
  return {
    "action.id": context.action.id,
    "action.label": context.action.label,
    "action.promptId": context.action.promptId,
    "adapter.commands.json": stableJson(context.adapter.commands),
    "adapter.detection.json": stableJson(context.adapter.detection),
    "adapter.facts.json": stableJson(context.adapter.facts),
    "adapter.id": context.adapter.id,
    "adapter.label": context.adapter.label,
    "adapter.promptContext.json": stableJson(context.adapter.promptContext),
    "context.json": stableJson(context),
    "input.json": stableJson(context.input),
    "product": context.product,
    "session.completedSteps.json": stableJson(context.session.completedSteps),
    "session.currentStep": context.session.currentStep,
    "session.id": context.session.id,
    "session.metadata.json": stableJson(context.session.metadata),
    "session.status": context.session.status,
    "session.targetRoot": context.session.targetRoot
  };
}

function renderPromptTemplate(template, context) {
  const tokens = promptTemplateTokens(context);
  return String(template || "").replace(TEMPLATE_TOKEN_PATTERN, (match, tokenName) => {
    if (!Object.hasOwn(tokens, tokenName)) {
      throw aiStudioError(`Unknown AI Studio prompt token: ${tokenName}`, "ai_studio_unknown_prompt_token");
    }
    return tokens[tokenName];
  }).trim();
}

class PromptRenderer {
  constructor({
    promptPackRoot = ""
  } = {}) {
    this.promptPackRoot = assertPromptPackRoot(promptPackRoot);
  }

  async renderPrompt({
    action,
    input = {},
    session
  } = {}) {
    const context = promptContextForAction({
      action,
      input,
      session
    });
    const template = await readPromptTemplate(this.promptPackRoot, context.action.promptId || DEFAULT_PROMPT_ID);
    return {
      context,
      prompt: renderPromptTemplate(template, context),
      promptId: context.action.promptId
    };
  }
}

export {
  PromptRenderer,
  promptContextForAction,
  renderPromptTemplate
};
