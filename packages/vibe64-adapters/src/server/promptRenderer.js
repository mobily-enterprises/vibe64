import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  vibe64Error,
  isMissingPathError,
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  missingInformationPolicyInstruction
} from "./promptQuestionPolicy.js";

const DEFAULT_PROMPT_ID = "fallback";
const DEFAULT_SYSTEM_PROMPT_PACK_ROOT = fileURLToPath(new URL("./systemPrompts", import.meta.url));
const PROMPT_OVERRIDES_DIR = "prompts";
const PROMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const TEMPLATE_TOKEN_PATTERN = /\{\{([A-Za-z0-9_.-]+)\}\}/gu;
const MANAGED_SERVICE_POLICY = [
  "Use the Managed services section as the only source for Vibe64-managed database access.",
  "Run the listed non-interactive client command directly from the session source terminal: mysql or mariadb for MySQL-compatible services, and psql for PostgreSQL services.",
  "When checking connectivity or inspecting schema from Codex, use `checkCommand`, use `command` with a real SQL statement, or pipe SQL to the client; do not run a bare interactive database client that waits for input.",
  "When framework generators or CLIs ask for database connection tokens or flags, including commands such as `npx jskit ...`, pass the environment-variable references from `generatorTokenHints` instead of discovering replacement values.",
  "Do not inspect Docker, Docker Compose, container names, runtime networks, localhost sockets, getent, mysqladmin, mariadb-admin, pg_isready, or host port probes for normal managed-service work.",
  "If the listed client command cannot connect, report that the managed service is not ready or ask for the missing external detail; do not invent alternate credentials or infrastructure."
].join(" ");
const STATIC_CONTEXT_REFERENCE = "Use the Vibe64 session briefing already provided for adapter prompt context, managed services, managed service policy, project config, and missing-information policy.";
const STATIC_CONTEXT_REFERENCE_MODE = "reference";
const PROMPT_CONTEXT_BRIEFING_SECTIONS = Object.freeze([
  ["agent_guide_contract", "Agent guide contract"],
  ["tooling_contract", "Tooling contract"],
  ["placement_contract", "Placement contract"],
  ["database_contract", "Database contract"],
  ["ui_verification_contract", "UI verification contract"],
  ["generator_discovery_commands", "Generator discovery commands"],
  ["seed_issue_guidance", "Seed issue guidance"],
  ["environment_blueprint", "Environment blueprint"]
]);
const PROMPT_CONTEXT_SUMMARY_OMITTED_KEYS = new Set([
  "adapter",
  "target_root"
]);

function assertPromptId(promptId) {
  const normalizedPromptId = normalizeText(promptId);
  if (!PROMPT_ID_PATTERN.test(normalizedPromptId)) {
    throw vibe64Error(`Invalid Vibe64 prompt id: ${normalizedPromptId || "(empty)"}`, "vibe64_invalid_prompt_id");
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

function promptOverrideRoot(sourceRoot = "") {
  const normalizedSourceRoot = normalizeText(sourceRoot);
  return normalizedSourceRoot
    ? path.join(path.resolve(normalizedSourceRoot), ".vibe64", PROMPT_OVERRIDES_DIR)
    : "";
}

function promptOverrideTemplatePath({
  adapterId = "",
  promptId = "",
  sourceRoot = ""
} = {}) {
  const overrideRoot = promptOverrideRoot(sourceRoot);
  const normalizedAdapterId = assertPromptId(adapterId);
  return path.join(overrideRoot, normalizedAdapterId, `${assertPromptId(promptId)}.txt`);
}

function assertPromptPackRoot(promptPackRoot) {
  const normalizedPromptPackRoot = normalizeText(promptPackRoot);
  if (!normalizedPromptPackRoot) {
    throw vibe64Error("Vibe64 prompt renderer requires a prompt pack root.", "vibe64_prompt_pack_root_missing");
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
  const sourceRoot = context.session.sourcePath;
  const adapterId = context.adapter.id;
  if (!sourceRoot || !adapterId) {
    return null;
  }
  const filePath = promptOverrideTemplatePath({
    adapterId,
    promptId: context.action.promptId || DEFAULT_PROMPT_ID,
    sourceRoot
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
      systemPromptId: normalizeText(context.action?.systemPromptId),
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
    product: normalizeText(context.product || "vibe64"),
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
      stateRoot: normalizeText(context.session?.stateRoot),
      stepMachine: isPlainObject(context.session?.stepMachine) ? context.session.stepMachine : null,
      status: normalizeText(context.session?.status),
      targetRoot: normalizeText(context.session?.targetRoot),
      sourcePath: sessionSourcePath(context.session || {})
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
    source: session.source,
    sourcePath: session.sourcePath,
    stateRoot: session.stateRoot,
    stepMachine: session.stepMachine,
    status: session.status,
    targetRoot: session.targetRoot
  };
}

function staticJsonReference(label = "") {
  return {
    vibe64SessionBriefingReference: normalizeText(label) || STATIC_CONTEXT_REFERENCE
  };
}

function staticScalarReference(tokenName = "") {
  return `See the Vibe64 session briefing for ${tokenName}.`;
}

function contextWithStaticReferences(context = {}) {
  return {
    ...context,
    adapter: {
      ...context.adapter,
      commands: staticJsonReference("Adapter commands are runtime-only Studio metadata and are not included in the Codex briefing."),
      facts: staticJsonReference("Adapter project facts are runtime-only Studio metadata and are not included in the Codex briefing."),
      managedServices: staticJsonReference("Managed service connection details and policy are in the Vibe64 session briefing."),
      promptContext: staticJsonReference("Adapter prompt context is in the Vibe64 session briefing.")
    },
    config: staticJsonReference("Project config is in the Vibe64 session briefing.")
  };
}

function promptSessionBriefingReference() {
  return [
    "Session briefing:",
    STATIC_CONTEXT_REFERENCE,
    "Do not ask the user to restate those static setup details. If this prompt includes an Vibe64 session briefing above, treat that briefing as the source of truth for this Codex session."
  ].join("\n");
}

function agentResultEnvelopeBriefing() {
  return [
    "Vibe64 agent result routing:",
    "- Vibe64 owns workflow state. Do not write Vibe64 workflow artifacts directly.",
    "- Routed workflow prompts include a Vibe64 agent result contract.",
    "- Write normal user-facing Markdown first, then finish routed workflow turns with the requested `VIBE64_AGENT_RESULT_BEGIN` / `VIBE64_AGENT_RESULT_END` envelope.",
    "- Vibe64 reads the provider transcript, validates the envelope, persists the assistant response, and advances workflow state server-side.",
    "- When a routed turn includes `fields.response`, keep the visible Markdown and `fields.response` equivalent.",
    "- Include `kind`, `stepId`, and `stepStatus` exactly for the current workflow state listed in the prompt.",
    "- Use `fields` for structured form values, `message` for questions to the user, and `text` for plain user responses.",
    "- In interactive Vibe64 conversation steps, the envelope is required; terminal-visible text alone is incomplete.",
    "- If the current state does not match the prompt, report that the Vibe64 state changed instead of guessing.",
    "",
    "Direct terminal input:",
    "- If you later receive a user prompt that does not include `VIBE64_ROUTED_TURN`, treat it as direct Codex terminal input.",
    "- For direct terminal input, answer normally.",
    "- Direct terminal input does not advance Vibe64 workflow state unless Vibe64 explicitly routes the turn."
  ].join("\n");
}

function isPromptContextBriefingSection(key = "", value = null) {
  if (value === null || value === undefined) {
    return false;
  }
  if (PROMPT_CONTEXT_BRIEFING_SECTIONS.some(([sectionKey]) => sectionKey === key)) {
    return true;
  }
  return /(?:_contract|_guidance|_commands|_blueprint)$/u.test(key) &&
    (typeof value === "string" || Array.isArray(value) || isPlainObject(value));
}

function promptContextBriefingLabel(key = "") {
  const explicitSection = PROMPT_CONTEXT_BRIEFING_SECTIONS.find(([sectionKey]) => sectionKey === key);
  if (explicitSection) {
    return explicitSection[1];
  }
  return normalizeText(key)
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function promptContextBriefingValue(value) {
  return typeof value === "string"
    ? value
    : stableJson(value);
}

function promptContextSummaryLabel(key = "") {
  return normalizeText(key)
    .split("_")
    .filter(Boolean)
    .join(" ");
}

function promptContextSummaryValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === true || value === false) {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean).join(", ");
  }
  return stableJson(value).replace(/\n\s*/gu, " ");
}

function shouldOmitPromptContextSummaryKey(source = {}, key = "") {
  if (PROMPT_CONTEXT_SUMMARY_OMITTED_KEYS.has(key)) {
    return true;
  }
  return key === "blueprint_path" && normalizeText(source.blueprint_relative_path);
}

function promptContextSummaryLines(source = {}, sectionKeySet = new Set()) {
  return Object.keys(source)
    .filter((key) => !sectionKeySet.has(key))
    .filter((key) => !shouldOmitPromptContextSummaryKey(source, key))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `- ${promptContextSummaryLabel(key)}: ${promptContextSummaryValue(source[key])}`);
}

function briefingAdapterPromptContext(promptContext = {}) {
  const source = isPlainObject(promptContext) ? promptContext : {};
  const sourceKeys = Object.keys(source);
  if (sourceKeys.length === 0) {
    return stableJson({});
  }
  const sectionKeys = [
    ...PROMPT_CONTEXT_BRIEFING_SECTIONS
      .map(([key]) => key)
      .filter((key) => Object.hasOwn(source, key) && isPromptContextBriefingSection(key, source[key])),
    ...sourceKeys
      .sort((left, right) => left.localeCompare(right))
      .filter((key) => !PROMPT_CONTEXT_BRIEFING_SECTIONS.some(([sectionKey]) => sectionKey === key))
    .filter((key) => isPromptContextBriefingSection(key, source[key]))
  ];
  if (sectionKeys.length === 0) {
    return stableJson(source);
  }
  const sectionKeySet = new Set(sectionKeys);
  const summaryLines = promptContextSummaryLines(source, sectionKeySet);
  const lines = [];
  if (summaryLines.length > 0) {
    lines.push("Summary:", ...summaryLines, "");
  }
  for (const key of sectionKeys) {
    lines.push(`${promptContextBriefingLabel(key)}:`, promptContextBriefingValue(source[key]), "");
  }
  return lines.join("\n").trim();
}

function briefingManagedService(service = {}) {
  const source = isPlainObject(service) ? service : {};
  const label = normalizeText(source.label || source.id || "Managed service");
  const descriptors = [
    normalizeText(source.id),
    normalizeText(source.kind),
    normalizeText(source.runtime)
  ].filter(Boolean);
  const lines = [
    descriptors.length > 0
      ? `- ${label} (${descriptors.join(", ")})`
      : `- ${label}`
  ];
  const serviceFields = [
    ["check", source.checkCommand],
    ["run SQL", source.command],
    ["fallback client", source.alternateClient],
    ["fallback check", source.alternateCheckCommand],
    ["fallback run SQL", source.alternateCommand]
  ];
  for (const [labelText, value] of serviceFields) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue) {
      lines.push(`  - ${labelText}: ${normalizedValue}`);
    }
  }
  const environmentKeys = Object.keys(isPlainObject(source.environment) ? source.environment : {})
    .sort((left, right) => left.localeCompare(right));
  if (environmentKeys.length > 0) {
    lines.push(`  - env vars: ${environmentKeys.join(", ")}`);
  }
  const generatorTokens = Object.entries(isPlainObject(source.generatorTokenHints) ? source.generatorTokenHints : {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${normalizeText(value)}`)
    .filter((entry) => !entry.endsWith("="));
  if (generatorTokens.length > 0) {
    lines.push(`  - generator tokens: ${generatorTokens.join(", ")}`);
  }
  return lines.join("\n");
}

function briefingManagedServices(services = []) {
  if (!Array.isArray(services) || services.length === 0) {
    return "No managed services configured.";
  }
  return services.map((service) => briefingManagedService(service)).join("\n");
}

function briefingProjectConfig(config = {}) {
  const source = isPlainObject(config) ? config : {};
  const values = isPlainObject(source.values)
    ? source.values
    : {};
  return {
    invalid: Array.isArray(source.invalid) ? source.invalid : [],
    missing: Array.isArray(source.missing) ? source.missing : [],
    projectType: normalizeText(source.projectType),
    ready: source.ready === true,
    values: stableValue(values)
  };
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
    "Vibe64 session briefing",
    "",
    "This briefing is sent once at the start of this Codex session. Keep using it for later Vibe64 prompts in the same session instead of asking for or rediscovering these static setup facts.",
    "",
    "Fixed session paths:",
    `- session id: ${context.session.id}`,
    `- target root: ${context.session.targetRoot}`,
    `- session source path: ${context.session.sourcePath}`,
    `- artifacts root: ${context.session.artifactsRoot}`,
    "",
    "Adapter:",
    `- id: ${context.adapter.id}`,
    `- label: ${context.adapter.label}`,
    "",
    "Adapter prompt context:",
    briefingAdapterPromptContext(context.adapter.promptContext),
    "",
    "Managed services:",
    briefingManagedServices(context.adapter.managedServices),
    "",
    "Managed service policy:",
    MANAGED_SERVICE_POLICY,
    "",
    "Missing information policy:",
    missingInformationPolicyInstruction(),
    "",
    "Project config:",
    stableJson(briefingProjectConfig(context.config)),
    "",
    "Code index policy:",
    codeIndexPolicy,
    "",
    agentResultEnvelopeBriefing()
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
    "action.systemPromptId": context.action.systemPromptId,
    "adapter.commands.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter commands are runtime-only Studio metadata and are not included in the Codex briefing."))
      : stableJson(context.adapter.commands),
    "adapter.detection.json": stableJson(context.adapter.detection),
    "adapter.facts.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter project facts are runtime-only Studio metadata and are not included in the Codex briefing."))
      : stableJson(context.adapter.facts),
    "adapter.id": context.adapter.id,
    "adapter.label": context.adapter.label,
    "adapter.managedServices.json": referenceStaticContext
      ? stableJson(staticJsonReference("Managed service connection details are in the Vibe64 session briefing."))
      : stableJson(context.adapter.managedServices),
    "adapter.promptContext.json": referenceStaticContext
      ? stableJson(staticJsonReference("Adapter prompt context is in the Vibe64 session briefing."))
      : stableJson(context.adapter.promptContext),
    "adapter.runtimeContainers.json": stableJson([]),
    "config.json": referenceStaticContext
      ? stableJson(staticJsonReference("Project config is in the Vibe64 session briefing."))
      : stableJson(context.config),
    "context.json": stableJson(jsonContext),
    "prompt.managedServicePolicy": referenceStaticContext
      ? "Use the managed service policy from the Vibe64 session briefing."
      : MANAGED_SERVICE_POLICY,
    "prompt.agentResultEnvelopeBriefing": agentResultEnvelopeBriefing(),
    "input.json": stableJson(context.input),
    "prompt.missingInformationPolicy": missingInformationPolicyInstruction(),
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
    "session.sourcePath": context.session.sourcePath
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
      throw vibe64Error(`Unknown Vibe64 prompt token: ${tokenName}`, "vibe64_unknown_prompt_token");
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
    const template = await readPromptTemplate(
      this.systemPromptPackRoot,
      context.action.systemPromptId || context.action.promptId || DEFAULT_PROMPT_ID
    );
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
