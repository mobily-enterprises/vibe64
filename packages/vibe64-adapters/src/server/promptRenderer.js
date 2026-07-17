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
const PROMPT_WORK_PROFILE_STANDARD = "standard";
const PROMPT_WORK_PROFILE_SEED = "seed";
const NOVICE_WORKFLOW_CREATION_AUDIENCE = "novice";
const SIMPLE_COMMUNICATION_POLICY = [
  "Simple communication profile:",
  "Keep all user-visible communication especially simple, including live thought and progress updates, status messages, reasoning summaries, questions, and final answers.",
  "Use short, concrete sentences. Introduce one decision at a time. Avoid implementation jargon and internal machinery unless the user asks for technical detail.",
  "Do not narrate speculative investigation. Say what you know, what you are doing now, and what the user needs to decide."
].join("\n");
const SEED_PROMPT_CONTEXT_BRIEFING_HIDDEN_KEYS = new Set([
  "agent_guide_contract",
  "generator_discovery_commands",
  "placement_contract",
  "seed_deslop_contract"
]);
const SEED_WORK_PROFILE_PREAMBLE = [
  "Seed work profile:",
  "This session is seed work. Keep this pass anchored to the accepted seed recipe, the generated runnable foundation, the smallest visible app workflow, and the checks that prove that workflow. Do not turn seed work into broad framework research, catalog browsing, package-internal audits, dependency advisory remediation, or product expansion unless a concrete local failure points there."
].join("\n");
const MANAGED_SERVICE_POLICY = [
  "Use the Managed services section as the only source for Vibe64-managed database access.",
  "Run the listed non-interactive client command directly from the session source terminal: mariadb for MariaDB services, and psql for PostgreSQL services.",
  "When checking connectivity or inspecting schema from Codex, use `checkCommand`, use `command` with a real SQL statement, or pipe SQL to the client; do not run a bare interactive database client that waits for input.",
  "When framework generators or CLIs ask for database connection tokens or flags, including commands such as `npx jskit ...`, pass the environment-variable references from `generatorTokenHints` instead of discovering replacement values.",
  "Do not discover replacement credentials, alternate hosts, local sockets, system accounts, or service probes for normal managed-service work.",
  "If the listed client command cannot connect, report that the managed service is not ready or ask for the missing external detail; do not invent alternate credentials or infrastructure."
].join(" ");
const STATIC_CONTEXT_REFERENCE = "Use the Vibe64 session briefing already provided for adapter prompt context, managed services, managed service policy, Git command policy, project config, and missing-information policy.";
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

function workflowDefinitionIsSeed(workflowDefinition = "") {
  const normalizedWorkflowDefinition = normalizeText(workflowDefinition);
  return normalizedWorkflowDefinition === "seed_application" ||
    normalizedWorkflowDefinition.endsWith("_seed_application");
}

function promptWorkProfile(context = {}) {
  const metadata = isPlainObject(context.session?.metadata) ? context.session.metadata : {};
  if (normalizeText(metadata.work_source) === PROMPT_WORK_PROFILE_SEED) {
    return PROMPT_WORK_PROFILE_SEED;
  }
  if (workflowDefinitionIsSeed(metadata.workflow_definition)) {
    return PROMPT_WORK_PROFILE_SEED;
  }
  return PROMPT_WORK_PROFILE_STANDARD;
}

function promptWorkProfilePreamble(context = {}) {
  return promptWorkProfile(context) === PROMPT_WORK_PROFILE_SEED
    ? SEED_WORK_PROFILE_PREAMBLE
    : "";
}

function promptContextBriefingHiddenKeys(context = {}) {
  return promptWorkProfile(context) === PROMPT_WORK_PROFILE_SEED
    ? SEED_PROMPT_CONTEXT_BRIEFING_HIDDEN_KEYS
    : new Set();
}

function adapterPromptTemplateId(context = {}) {
  const promptId = context.action?.promptId || DEFAULT_PROMPT_ID;
  if (promptWorkProfile(context) === PROMPT_WORK_PROFILE_SEED && promptId === "run_deslop") {
    return "run_seed_deslop";
  }
  return promptId;
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

async function readPromptTemplateVariant(promptPackRoot, promptId, {
  fallbackPromptId = ""
} = {}) {
  const requestedPromptId = assertPromptId(promptId || DEFAULT_PROMPT_ID);
  try {
    return await readFile(promptTemplatePath(promptPackRoot, requestedPromptId), "utf8");
  } catch (error) {
    const normalizedFallbackPromptId = normalizeText(fallbackPromptId);
    if (isMissingPathError(error) && normalizedFallbackPromptId && normalizedFallbackPromptId !== requestedPromptId) {
      return readPromptTemplate(promptPackRoot, normalizedFallbackPromptId);
    }
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
      workflowCreationAudience: normalizeText(
        context.session?.workflowCreationAudience ||
        context.session?.workflowDefinition?.creationAudience
      ),
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
    targetRoot: session.targetRoot,
    workflowCreationAudience: session.workflowDefinition?.creationAudience
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

function agentResultRoutingBriefing() {
  return [
    "Vibe64 agent result routing:",
    "- Vibe64 owns workflow state. Do not write Vibe64 workflow artifacts directly.",
    "- Ordinary interactive conversation turns use the normal assistant response; do not add transport markers or duplicate the answer.",
    "- Workflow turns that need structured fields provide a Vibe64 workflow-result control. Submit those fields through that control before replying normally.",
    "- Keep every visible assistant response as ordinary Markdown. Never print workflow-result arguments, JSON, or transport metadata in the response.",
    "- Use `fields` in the control for workflow values, `message` for required user questions, and `inputFields` only for structured text, textarea, or password input.",
    "- If the current state does not match the prompt, report that the Vibe64 state changed instead of guessing.",
    "",
    "Direct terminal input:",
    "- If you later receive a user prompt that does not include `VIBE64_ROUTED_TURN`, treat it as direct Codex terminal input.",
    "- For direct terminal input, answer normally.",
    "- Direct terminal input does not advance Vibe64 workflow state unless Vibe64 explicitly routes the turn."
  ].join("\n");
}

function managedPreviewPolicyInstruction() {
  return [
    "- For every app, UI, browser, or runtime diagnosis, use only the session's Vibe64-managed preview. Never start another development server, choose another port, or replace that preview.",
    "- A request only to view, inspect, or describe the current page is a direct visual-browser request. Immediately run `vibe64-preview screenshot`, read its JSON capture metadata, then inspect the immutable image at `outputPath` with the image-viewing tool. This one command idempotently ensures the preview and captures its authenticated current page with Vibe64's managed Playwright. Do this before reading AGENTS.md, project source, package manifests, or UI documentation.",
    "- An interaction request such as click, type, select, submit, back, or forward takes precedence over the initial-screenshot rule: do not capture before acting. Use one `vibe64-preview browser eval` call to perform the requested action and wait for the requested URL or visible element, then return the resulting URL, title, and relevant visible text.",
    "- Once the requested interaction is confirmed, report it and stop. Take exactly one post-action screenshot only when the user asked what the result looks like or when URL and DOM evidence are ambiguous. Do not use arbitrary fixed sleeps, repeat captures, or investigate unrelated transient frames.",
    "- Every screenshot result includes a unique immutable `outputPath`, `sha256`, URL, title, DOM text summary, luminance, and dark-pixel percentage. Treat those capture facts as authoritative evidence for that exact PNG.",
    "- Never claim that the application is black, blank, obscured, or visually broken when the capture luminance and dark-pixel percentage contradict that claim. If the image-viewing tool appears to contradict the capture facts, run `sha256sum` on the same `outputPath`, confirm it still matches `sha256`, and reopen that exact file once without taking another screenshot. Any remaining or intermittent disagreement is an image-handoff failure; report it as such and do not blame the application.",
    "- For browser work that needs interaction, use the persistent managed browser: send JavaScript on stdin to `vibe64-preview browser eval`. The script receives the real Playwright `browser`, `context`, and `page` objects plus persistent `state`; use the ordinary Playwright API directly. The page, cookies, tabs, and state survive across commands in this session.",
    "- Use `vibe64-preview browser ensure` to start or reconnect it without requiring the user to open it first, `vibe64-preview browser status` to inspect it, and `vibe64-preview browser reset` only when a clean context is intentional. Vibe64 automatically recovers a killed preview or browser worker and reattaches when the managed preview process changes.",
    "- Codex's internal managed browser has its own application session, separate from the user's visible Preview. Use `vibe64-preview browser identity you` to sign it in as the Vibe64 user who authorized the turn, `vibe64-preview browser identity <existing-user-identifier>` to inspect another real application user by the identifier type that app supports, or `vibe64-preview browser identity guest` to sign it out. These commands never change the user's visible Preview.",
    "- When reporting authentication state, always name the browser explicitly: say `Codex's internal managed browser is signed in as <identity>` or `Codex's internal managed browser is signed out`. Never say only that `the application` or `the preview` is signed in, and never imply that the internal browser's identity is also active in the user's visible Preview.",
    "- Treat the returned `endpoints.agent`, `terminal`, and `currentPage` as authoritative. Use `vibe64-preview status --json` to refresh them. When the user says “this page”, use `currentPage.agentUrl` and `currentPage.route`.",
    "- `currentPage` can be absent until a browser has visited the preview. For browser verification, navigate to `endpoints.agent.url`; do not treat an unobserved current page as a missing preview.",
    "- `vibe64-preview` owns interactive Playwright and already has its matching Chromium. Never use `npx playwright`, project `require(\"playwright\")`, `playwright install`, another browser CLI, or any browser download for inspection or interaction.",
    "- Keep ordinary portable Playwright tests in the project with its normal `@playwright/test` dev dependency and a `PLAYWRIGHT_BASE_URL` override. Inside Vibe64, immediately run them through `vibe64-playwright test [arguments]` or `vibe64-playwright npm-run <script> [-- arguments]`. These commands automatically ensure the current managed preview, supply its agent origin as `PLAYWRIGHT_BASE_URL`, and pair the project test package with the exact managed browser version. Do not inspect or hard-code managed ports, add Vibe64 URL-discovery helpers to the project, or pass the managed preview URL manually. Never install browser payloads in the project or user cache.",
    "- Describe only what the rendered browser actually shows. Never infer page appearance from source code. If the browser renders a sign-in page, error, or blank screen, report that exact result instead of describing the intended page.",
    "- Read managed server output with `vibe64-preview logs --lines 200`. Do not launch a second server to obtain cleaner output.",
    "- Do not ask the user to start or open the preview. If `vibe64-preview ensure --wait --json` fails, report its diagnostics as the managed-preview blocker.",
    "- Never substitute `npm run dev`, `npm start`, Vite, Next, JSKIT server commands, PHP development servers, or any other process that serves the app—even if a different port appears free.",
    "- If `vibe64-preview` or its endpoint is unavailable, report that managed-preview blocker clearly. Do not work around it by spinning up another server."
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

function promptContextSummaryLines(source = {}, sectionKeySet = new Set(), hiddenKeySet = new Set()) {
  return Object.keys(source)
    .filter((key) => !hiddenKeySet.has(key))
    .filter((key) => !sectionKeySet.has(key))
    .filter((key) => !shouldOmitPromptContextSummaryKey(source, key))
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `- ${promptContextSummaryLabel(key)}: ${promptContextSummaryValue(source[key])}`);
}

function briefingAdapterPromptContext(promptContext = {}, context = {}) {
  const source = isPlainObject(promptContext) ? promptContext : {};
  const hiddenKeySet = promptContextBriefingHiddenKeys(context);
  const sourceKeys = Object.keys(source)
    .filter((key) => !hiddenKeySet.has(key));
  if (sourceKeys.length === 0) {
    return stableJson({});
  }
  const sectionKeys = [
    ...PROMPT_CONTEXT_BRIEFING_SECTIONS
      .map(([key]) => key)
      .filter((key) => !hiddenKeySet.has(key))
      .filter((key) => Object.hasOwn(source, key) && isPromptContextBriefingSection(key, source[key])),
    ...sourceKeys
      .sort((left, right) => left.localeCompare(right))
      .filter((key) => !PROMPT_CONTEXT_BRIEFING_SECTIONS.some(([sectionKey]) => sectionKey === key))
      .filter((key) => isPromptContextBriefingSection(key, source[key]))
  ];
  if (sectionKeys.length === 0) {
    return stableJson(Object.fromEntries(sourceKeys.map((key) => [key, source[key]])));
  }
  const sectionKeySet = new Set(sectionKeys);
  const summaryLines = promptContextSummaryLines(source, sectionKeySet, hiddenKeySet);
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

function sessionDiagnosticsPath(root = "", relativePath = "") {
  const normalizedRoot = normalizeText(root);
  const normalizedRelativePath = normalizeText(relativePath);
  return normalizedRoot && normalizedRelativePath ? path.join(normalizedRoot, normalizedRelativePath) : "";
}

function briefingSessionDiagnostics(session = {}) {
  const sessionRoot = normalizeText(session.sessionRoot);
  if (!sessionRoot) {
    return [
      "- session diagnostics root: unavailable",
      "- Preview, command, and action logs are unavailable until Vibe64 provides a session diagnostics root."
    ].join("\n");
  }
  return [
    `- session diagnostics root: ${sessionRoot}`,
    `- command log: ${sessionDiagnosticsPath(sessionRoot, "command-log.jsonl")}`,
    `- action attempts: ${sessionDiagnosticsPath(sessionRoot, "action-attempts")}`,
    `- command lifecycles: ${sessionDiagnosticsPath(sessionRoot, "command-lifecycle")}`,
    `- conversation log: ${sessionDiagnosticsPath(sessionRoot, "conversation-log")}`,
    `- background tasks: ${sessionDiagnosticsPath(sessionRoot, "background-tasks")}`,
    `- agent runs: ${sessionDiagnosticsPath(sessionRoot, "agent-runs")}`,
    `- latest preview diagnostic: ${sessionDiagnosticsPath(sessionRoot, "preview-last.json")}`,
    `- preview diagnostic log: ${sessionDiagnosticsPath(sessionRoot, "preview-log.jsonl")}`,
    "When debugging preview, launch, terminal, or workflow behavior, read these files before guessing, rebuilding, reinstalling packages, or rerunning commands. Preview launch failures before a visible terminal exists are recorded in the latest preview diagnostic and preview diagnostic log."
  ].join("\n");
}

function promptSessionBriefing(contextInput = {}) {
  const context = normalizePromptContext(contextInput);
  const simpleCommunicationPolicy = context.session.workflowCreationAudience === NOVICE_WORKFLOW_CREATION_AUDIENCE
    ? SIMPLE_COMMUNICATION_POLICY
    : "";
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
    simpleCommunicationPolicy,
    "",
    "Fixed session paths:",
    `- session id: ${context.session.id}`,
    `- target root: ${context.session.targetRoot}`,
    `- session source path: ${context.session.sourcePath}`,
    `- session root: ${context.session.sessionRoot}`,
    `- artifacts root: ${context.session.artifactsRoot}`,
    `- metadata root: ${context.session.metadataRoot}`,
    "",
    "Session logs and diagnostics:",
    briefingSessionDiagnostics(context.session),
    "",
    "Managed preview policy:",
    managedPreviewPolicyInstruction(),
    "",
    "Adapter:",
    `- id: ${context.adapter.id}`,
    `- label: ${context.adapter.label}`,
    "",
    "Adapter prompt context:",
    briefingAdapterPromptContext(context.adapter.promptContext, context),
    "",
    "Managed services:",
    briefingManagedServices(context.adapter.managedServices),
    "",
    "Managed service policy:",
    MANAGED_SERVICE_POLICY,
    "",
    "Git command policy:",
    "Use the managed Vibe64 `git` and `gh` commands from the session environment for all project Git and GitHub work.",
    "Do not run absolute or host Git/GitHub binaries such as `/usr/bin/git`, `/bin/git`, `/usr/local/bin/git`, `/usr/bin/gh`, or `/bin/gh`.",
    "Do not bypass the managed command path with `command -p`, a stripped `PATH`, `env -i`, shell builtins that force host lookup, or direct executable paths.",
    "If managed `git` or `gh` cannot authenticate or cannot reach the remote, report that exact managed-command failure. Do not retry with host binaries, inspect credentials, or invent alternate GitHub authentication.",
    "",
    "Missing information policy:",
    missingInformationPolicyInstruction(),
    "",
    "Project config:",
    stableJson(briefingProjectConfig(context.config)),
    "",
    "Vibe64 control-file policy:",
    "Committed source contract files are `vibe64.project.json`, `vibe64.runtime-lock.json`, `vibe64.system.json`, optional `.vibe64/scripts`, `.vibe64/prompts`, and `.vibe64/project-knowledge`.",
    "Runtime-local Vibe64 state includes project `runtime-config/*`, sessions, runtime, git-cache, terminal/provider state, and other generated workspace state.",
    "Do not delete, move, or overwrite committed source contract files to clean a diff or silence Git/status/tooling. Inspect and report them when relevant. Edit them only when the user explicitly asks for that specific Vibe64 config change or the current Vibe64 workflow prompt explicitly instructs you to update that artifact.",
    "Do not commit or rewrite runtime-local Vibe64 state unless the current workflow explicitly instructs you to inspect or report that runtime state.",
    "",
    "Code index policy:",
    codeIndexPolicy,
    "",
    agentResultRoutingBriefing()
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
    "config.json": referenceStaticContext
      ? stableJson(staticJsonReference("Project config is in the Vibe64 session briefing."))
      : stableJson(context.config),
    "context.json": stableJson(jsonContext),
    "prompt.managedServicePolicy": referenceStaticContext
      ? "Use the managed service policy from the Vibe64 session briefing."
      : MANAGED_SERVICE_POLICY,
    "prompt.agentResultRoutingBriefing": agentResultRoutingBriefing(),
    "prompt.workProfile": promptWorkProfile(context),
    "prompt.workProfilePreamble": promptWorkProfilePreamble(context),
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

function promptContextInlineTokenKeys(context = {}) {
  const keys = new Set();
  if (promptWorkProfile(context) === PROMPT_WORK_PROFILE_SEED) {
    keys.add("create_app_package_spec");
  }
  if (promptWorkProfile(context) === PROMPT_WORK_PROFILE_SEED && context.action?.promptId === "run_deslop") {
    keys.add("seed_deslop_contract");
  }
  return keys;
}

function profilePromptContextDefaultTokens(context = {}) {
  if (promptWorkProfile(context) !== PROMPT_WORK_PROFILE_SEED) {
    return {};
  }
  return {
    "adapter.promptContext.seed_deslop_contract": "Apply the full Vibe64 deslop pass while keeping review anchored to the accepted seed recipe, generated runnable foundation, smallest visible workflow, and practical verification.",
    "adapter.promptContext.seed_recipe_contract": "Use the accepted seed guidance as the source of truth for scaffold, module, auth, database, and verification choices. Do not redo broad framework discovery unless a concrete local failure requires it."
  };
}

function scalarPromptContextReferenceTokens(promptContext = {}, inlineKeys = new Set()) {
  const entries = Object.keys(isPlainObject(promptContext) ? promptContext : {})
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [
      `adapter.promptContext.${key}`,
      inlineKeys.has(key)
        ? promptContextBriefingValue(promptContext[key])
        : staticScalarReference(`adapter.promptContext.${key}`)
    ]);
  return Object.fromEntries(entries);
}

function renderPromptTemplate(template, context, extraTokens = {}) {
  const normalizedContext = normalizePromptContext(context);
  const promptContextTokens = normalizedContext.prompt.staticContextMode === STATIC_CONTEXT_REFERENCE_MODE
    ? scalarPromptContextReferenceTokens(
        normalizedContext.adapter.promptContext,
        promptContextInlineTokenKeys(normalizedContext)
      )
    : scalarPromptContextTokens(normalizedContext.adapter.promptContext);
  const tokens = {
    ...profilePromptContextDefaultTokens(normalizedContext),
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
    const template = await readPromptTemplateVariant(
      this.promptPackRoot,
      adapterPromptTemplateId(context),
      {
        fallbackPromptId: context.action.promptId || DEFAULT_PROMPT_ID
      }
    );
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
  managedPreviewPolicyInstruction,
  promptContextForAction,
  promptSessionBriefing,
  renderPromptTemplate,
  renderPromptWithOverrides
};
