import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiStudioError,
  isMissingPathError,
  isPlainObject,
  normalizeText
} from "./core.js";
import {
  AI_STUDIO_STATE_DIR
} from "./sessionStore.js";

const DEFAULT_PROMPT_ID = "generic";
const DEFAULT_SYSTEM_PROMPT_PACK_ROOT = fileURLToPath(new URL("./systemPrompts", import.meta.url));
const PROMPT_OVERRIDES_DIR = "prompts";
const PROMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const TEMPLATE_TOKEN_PATTERN = /\{\{([A-Za-z0-9_.-]+)\}\}/gu;
const MISSING_INFORMATION_POLICY = "If required external service details, credentials, project URLs, API keys, provider choices, production-vs-local decisions, or runtime configuration are missing, ask concise questions before planning or implementing work that depends on them. Do not invent placeholder credentials, silently choose unrelated local substitutes, or proceed with fake integrations.";
const MANAGED_SERVICE_POLICY = [
  "Use the Managed services section as the only source for AI Studio-managed database access.",
  "Run the listed non-interactive client command directly from the worktree terminal: mysql or mariadb for MySQL-compatible services, and psql for PostgreSQL services.",
  "When checking connectivity or inspecting schema from Codex, use `checkCommand`, use `command` with a real SQL statement, or pipe SQL to the client; do not run a bare interactive database client that waits for input.",
  "When framework generators or CLIs ask for database connection tokens or flags, including commands such as `npx jskit ...`, pass the environment-variable references from `generatorTokenHints` instead of discovering replacement values.",
  "Do not inspect Docker, Docker Compose, container names, runtime networks, localhost sockets, getent, mysqladmin, mariadb-admin, pg_isready, or host port probes for normal managed-service work.",
  "If the listed client command cannot connect, report that the managed service is not ready or ask for the missing external detail; do not invent alternate credentials or infrastructure."
].join(" ");
const STATIC_CONTEXT_REFERENCE = "Use the AI Studio session briefing already provided for adapter facts, adapter prompt context, managed services, managed service policy, and project config.";
const STATIC_CONTEXT_REFERENCE_MODE = "reference";

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

function staticContextMode(value = "") {
  return normalizeText(value) === STATIC_CONTEXT_REFERENCE_MODE
    ? STATIC_CONTEXT_REFERENCE_MODE
    : "inline";
}

function promptTemplatePath(promptPackRoot, promptId) {
  return path.join(promptPackRoot, `${assertPromptId(promptId)}.txt`);
}

function promptOverrideRoot(targetRoot = "") {
  const normalizedTargetRoot = normalizeText(targetRoot);
  return normalizedTargetRoot
    ? path.join(path.resolve(normalizedTargetRoot), AI_STUDIO_STATE_DIR, PROMPT_OVERRIDES_DIR)
    : "";
}

function promptOverrideTemplatePath({
  adapterId = "",
  promptId = "",
  targetRoot = ""
} = {}) {
  const overrideRoot = promptOverrideRoot(targetRoot);
  const normalizedAdapterId = assertPromptId(adapterId);
  return path.join(overrideRoot, normalizedAdapterId, `${assertPromptId(promptId)}.txt`);
}

function assertPromptPackRoot(promptPackRoot) {
  const normalizedPromptPackRoot = normalizeText(promptPackRoot);
  if (!normalizedPromptPackRoot) {
    throw aiStudioError("AI Studio prompt renderer requires a prompt pack root.", "ai_studio_prompt_pack_root_missing");
  }
  return path.resolve(normalizedPromptPackRoot);
}

function optionalPromptPackRoot(promptPackRoot) {
  if (promptPackRoot === false || promptPackRoot === null) {
    return "";
  }
  return assertPromptPackRoot(promptPackRoot || DEFAULT_SYSTEM_PROMPT_PACK_ROOT);
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

async function readPromptOverrideTemplate(context) {
  const targetRoot = context.session.targetRoot;
  const adapterId = context.adapter.id;
  if (!targetRoot || !adapterId) {
    return null;
  }
  const filePath = promptOverrideTemplatePath({
    adapterId,
    promptId: context.action.promptId || DEFAULT_PROMPT_ID,
    targetRoot
  });
  try {
    return {
      filePath,
      template: await readFile(filePath, "utf8")
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function promptContextForAction({
  action = {},
  config = {},
  input = {},
  session = {}
} = {}) {
  return normalizePromptContext({
    action,
    adapter: session.adapter,
    config: config || session.config,
    input,
    session: sessionPromptContext(session)
  });
}

function normalizePromptContext(context = {}) {
  const adapterContext = context.adapter || context.session?.adapter;
  const promptStaticContextMode = staticContextMode(
    context.prompt?.staticContextMode ||
    context.session?.promptStaticContextMode
  );
  return {
    action: {
      id: normalizeText(context.action?.id),
      label: normalizeText(context.action?.label),
      promptId: normalizeText(context.action?.promptId || context.action?.id),
      type: normalizeText(context.action?.type)
    },
    adapter: {
      commands: Array.isArray(adapterContext?.commands) ? adapterContext.commands : [],
      detection: isPlainObject(adapterContext?.detection) ? adapterContext.detection : {},
      facts: isPlainObject(adapterContext?.facts) ? adapterContext.facts : {},
      id: normalizeText(adapterContext?.id),
      label: normalizeText(adapterContext?.label),
      managedServices: Array.isArray(adapterContext?.managedServices) ? adapterContext.managedServices : [],
      promptContext: isPlainObject(adapterContext?.promptContext) ? adapterContext.promptContext : {}
    },
    config: isPlainObject(context.config) ? context.config : {},
    input: context.input ?? {},
    product: normalizeText(context.product || "ai-studio"),
    prompt: {
      staticContextMode: promptStaticContextMode
    },
    session: {
      artifactsRoot: normalizeText(context.session?.artifactsRoot),
      completedSteps: Array.isArray(context.session?.completedSteps) ? context.session.completedSteps : [],
      currentStep: normalizeText(context.session?.currentStep),
      id: normalizeText(context.session?.id || context.session?.sessionId),
      metadataRoot: normalizeText(context.session?.metadataRoot),
      metadata: isPlainObject(context.session?.metadata) ? context.session.metadata : {},
      sessionRoot: normalizeText(context.session?.sessionRoot),
      stepMachine: isPlainObject(context.session?.stepMachine) ? context.session.stepMachine : null,
      status: normalizeText(context.session?.status),
      targetRoot: normalizeText(context.session?.targetRoot),
      worktreePath: normalizeText(context.session?.metadata?.worktree_path || context.session?.worktree)
    }
  };
}

function sessionPromptContext(session = {}) {
  return {
    artifactsRoot: session.artifactsRoot,
    completedSteps: session.completedSteps,
    currentStepDefinition: session.currentStepDefinition,
    currentStep: session.currentStep,
    id: session.sessionId || session.id,
    metadataRoot: session.metadataRoot,
    metadata: session.metadata,
    promptStaticContextMode: session.promptStaticContextMode,
    sessionRoot: session.sessionRoot,
    stepMachine: session.stepMachine,
    status: session.status,
    targetRoot: session.targetRoot,
    worktree: session.worktree
  };
}

function staticJsonReference(label = "") {
  return {
    aiStudioSessionBriefingReference: normalizeText(label) || STATIC_CONTEXT_REFERENCE
  };
}

function staticScalarReference(tokenName = "") {
  return `See the AI Studio session briefing for ${tokenName}.`;
}

function contextWithStaticReferences(context = {}) {
  return {
    ...context,
    adapter: {
      ...context.adapter,
      commands: staticJsonReference("Adapter commands are in the AI Studio session briefing."),
      facts: staticJsonReference("Adapter project facts are in the AI Studio session briefing."),
      managedServices: staticJsonReference("Managed service connection details and policy are in the AI Studio session briefing."),
      promptContext: staticJsonReference("Adapter prompt context is in the AI Studio session briefing.")
    },
    config: staticJsonReference("Project config is in the AI Studio session briefing.")
  };
}

function promptSessionBriefingReference() {
  return [
    "Session briefing:",
    STATIC_CONTEXT_REFERENCE,
    "Do not ask the user to restate those static setup details. If this prompt includes an AI Studio session briefing above, treat that briefing as the source of truth for this Codex session."
  ].join("\n");
}

function currentStepInputHelperBriefing() {
  return [
    "AI Studio current-step input helper:",
    "- When you need to update AI Studio workflow state, call the helper command instead of writing AI Studio artifacts directly.",
    "- Command: node \"$AI_STUDIO_CURRENT_STEP_INPUT_HELPER\"",
    "- Pass one JSON object on stdin or with --json.",
    "- Include `kind`, `stepId`, and `stepStatus` exactly for the current workflow state.",
    "- The current values are in Action context as `session.currentStep` and `session.stepMachine.status`.",
    "- Use `fields` for structured form values, `message` for questions to the user, and `text` for plain user responses.",
    "- If the helper reports Reload state or a state mismatch, stop and ask the user to reload the current step."
  ].join("\n");
}

function promptSessionBriefing(contextInput = {}) {
  const context = normalizePromptContext(contextInput);
  const codeIndexPath = normalizeText(context.session.metadata?.code_index_path);
  const codeIndexPolicy = codeIndexPath
    ? [
      `Generated code index path: ${codeIndexPath}`,
      "Read that generated code index before adding or reviewing helper-like code. Prefer existing helpers and structures from that index over redefining them."
    ].join("\n")
    : "If later session metadata includes `code_index_path`, read that generated code index before adding or reviewing helper-like code. Prefer existing helpers and structures from that index over redefining them.";
  return [
    "AI Studio session briefing",
    "",
    "This briefing is sent once at the start of this Codex session. Keep using it for later AI Studio prompts in the same session instead of asking for or rediscovering these static setup facts.",
    "",
    "Fixed session paths:",
    `- session id: ${context.session.id}`,
    `- target root: ${context.session.targetRoot}`,
    `- worktree path: ${context.session.worktreePath}`,
    `- artifacts root: ${context.session.artifactsRoot}`,
    "",
    "Adapter:",
    `- id: ${context.adapter.id}`,
    `- label: ${context.adapter.label}`,
    "",
    "Adapter project facts:",
    stableJson(context.adapter.facts),
    "",
    "Adapter prompt context:",
    stableJson(context.adapter.promptContext),
    "",
    "Managed services:",
    stableJson(context.adapter.managedServices),
    "",
    "Managed service policy:",
    MANAGED_SERVICE_POLICY,
    "",
    "Project config:",
    stableJson(context.config),
    "",
    "Code index policy:",
    codeIndexPolicy,
    "",
    currentStepInputHelperBriefing()
  ].join("\n").trim();
}

function promptTemplateTokens(contextInput) {
  const context = normalizePromptContext(contextInput);
  const referenceStaticContext = context.prompt.staticContextMode === STATIC_CONTEXT_REFERENCE_MODE;
  const jsonContext = referenceStaticContext ? contextWithStaticReferences(context) : context;
  return {
    "action.id": context.action.id,
    "action.label": context.action.label,
    "action.promptId": context.action.promptId,
    "adapter.commands.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter commands are in the AI Studio session briefing."))
      : stableJson(context.adapter.commands),
    "adapter.detection.json": stableJson(context.adapter.detection),
    "adapter.facts.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter project facts are in the AI Studio session briefing."))
      : stableJson(context.adapter.facts),
    "adapter.id": context.adapter.id,
    "adapter.label": context.adapter.label,
    "adapter.managedServices.json": referenceStaticContext
      ? stableJson(staticJsonReference("Managed service connection details are in the AI Studio session briefing."))
      : stableJson(context.adapter.managedServices),
    "adapter.promptContext.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter prompt context is in the AI Studio session briefing."))
      : stableJson(context.adapter.promptContext),
    "adapter.runtimeContainers.json": stableJson([]),
    "config.json": referenceStaticContext
      ? stableJson(staticJsonReference("Project config is in the AI Studio session briefing."))
      : stableJson(context.config),
    "context.json": stableJson(jsonContext),
    "prompt.managedServicePolicy": referenceStaticContext
      ? "Use the managed service policy from the AI Studio session briefing."
      : MANAGED_SERVICE_POLICY,
    "prompt.currentStepInputHelperBriefing": currentStepInputHelperBriefing(),
    "input.json": stableJson(context.input),
    "prompt.missingInformationPolicy": MISSING_INFORMATION_POLICY,
    "prompt.sessionBriefingReference": promptSessionBriefingReference(),
    "product": context.product,
    "session.artifactsRoot": context.session.artifactsRoot,
    "session.completedSteps.json": stableJson(context.session.completedSteps),
    "session.currentStep": context.session.currentStep,
    "session.id": context.session.id,
    "session.metadataRoot": context.session.metadataRoot,
    "session.metadata.json": stableJson(context.session.metadata),
    "session.sessionRoot": context.session.sessionRoot,
    "session.stepMachine.json": stableJson(context.session.stepMachine),
    "session.stepMachine.status": normalizeText(context.session.stepMachine?.status),
    "session.status": context.session.status,
    "session.targetRoot": context.session.targetRoot,
    "session.worktreePath": context.session.worktreePath
  };
}

function promptOverrideTokens(originalPrompt = "") {
  return {
    originalPrompt: String(originalPrompt || ""),
    "prompt.original": String(originalPrompt || "")
  };
}

function promptSystemStandardTokens(systemStandard = "") {
  return {
    "prompt.systemStandard": String(systemStandard || ""),
    systemStandard: String(systemStandard || "")
  };
}

function scalarPromptContextTokens(promptContext = {}) {
  const entries = Object.entries(isPlainObject(promptContext) ? promptContext : {})
    .filter(([, value]) => ["boolean", "number", "string"].includes(typeof value))
    .map(([key, value]) => [`adapter.promptContext.${key}`, String(value)]);
  return Object.fromEntries(entries);
}

function scalarPromptContextReferenceTokens(promptContext = {}) {
  const entries = Object.keys(isPlainObject(promptContext) ? promptContext : {})
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [`adapter.promptContext.${key}`, staticScalarReference(`adapter.promptContext.${key}`)]);
  return Object.fromEntries(entries);
}

function renderPromptTemplate(template, context, extraTokens = {}) {
  const normalizedContext = normalizePromptContext(context);
  const promptContextTokens = normalizedContext.prompt.staticContextMode === STATIC_CONTEXT_REFERENCE_MODE
    ? scalarPromptContextReferenceTokens(normalizedContext.adapter.promptContext)
    : scalarPromptContextTokens(normalizedContext.adapter.promptContext);
  const tokens = {
    ...promptContextTokens,
    ...promptTemplateTokens(normalizedContext),
    ...extraTokens
  };
  return String(template || "").replace(TEMPLATE_TOKEN_PATTERN, (match, tokenName) => {
    if (!Object.hasOwn(tokens, tokenName)) {
      throw aiStudioError(`Unknown AI Studio prompt token: ${tokenName}`, "ai_studio_unknown_prompt_token");
    }
    return tokens[tokenName];
  }).trim();
}

async function renderPromptWithOverrides({
  context = {},
  originalPrompt = "",
  systemStandard = ""
} = {}) {
  const normalizedContext = normalizePromptContext(context);
  const normalizedOriginalPrompt = String(originalPrompt || "");
  const override = await readPromptOverrideTemplate(normalizedContext);
  return {
    originalPrompt: normalizedOriginalPrompt,
    prompt: override
      ? renderPromptTemplate(
          override.template,
          normalizedContext,
          {
            ...promptOverrideTokens(normalizedOriginalPrompt),
            ...promptSystemStandardTokens(systemStandard)
          }
        )
      : normalizedOriginalPrompt,
    promptOverridePath: override?.filePath || ""
  };
}

class PromptRenderer {
  constructor({
    promptPackRoot = "",
    systemPromptPackRoot = DEFAULT_SYSTEM_PROMPT_PACK_ROOT
  } = {}) {
    this.promptPackRoot = assertPromptPackRoot(promptPackRoot);
    this.systemPromptPackRoot = optionalPromptPackRoot(systemPromptPackRoot);
  }

  async renderSystemStandardPrompt(context) {
    if (!this.systemPromptPackRoot) {
      return "";
    }
    const template = await readPromptTemplate(this.systemPromptPackRoot, context.action.promptId || DEFAULT_PROMPT_ID);
    return renderPromptTemplate(template, context);
  }

  async renderPrompt({
    action,
    config = {},
    input = {},
    session
  } = {}) {
    const context = promptContextForAction({
      action,
      config,
      input,
      session
    });
    const systemStandard = await this.renderSystemStandardPrompt(context);
    const template = await readPromptTemplate(this.promptPackRoot, context.action.promptId || DEFAULT_PROMPT_ID);
    const originalPrompt = renderPromptTemplate(
      template,
      context,
      promptSystemStandardTokens(systemStandard)
    );
    const renderedPrompt = await renderPromptWithOverrides({
      context,
      originalPrompt,
      systemStandard
    });
    return {
      context,
      ...renderedPrompt,
      promptId: context.action.promptId,
      systemStandard
    };
  }
}

export {
  PromptRenderer,
  promptContextForAction,
  promptSessionBriefing,
  renderPromptTemplate,
  renderPromptWithOverrides
};
