import { VIBE64_CONNECTED_DEVELOPMENT_SECTION, vibe64ConnectedDevelopmentInspection } from "./connectedDevelopment.js";
import {
  readArchitecturePreviewLocator,
  vibe64ArchitectureInspection,
  VIBE64_ARCHITECTURE_INSPECTION_SECTION
} from "./architectureInspection.js";
import { vibe64ArchitectureLayout, VIBE64_ARCHITECTURE_LAYOUT_SECTION } from "./architectureLayout.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  GENESIS_STACK_PATH,
  GENESIS_STACK_SECTION_AMBIGUOUS,
  genesisProjectContractNeedsAttention,
  genesisProjectFileDiagnostic,
  genesisProjectFileUnreadable
} from "./projectContractAttention.js";
import * as genesisCompiler from "genesis-compiler";
import { createVibe64HostContextRegistry } from "./hostContextRegistry.js";
import { normalizeText } from "./text.js";

import {
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
} from "./applicationDeployment.js";
import {
  VIBE64_PACKAGING_CONTRACT,
  VIBE64_PACKAGING_SECTION,
  parseVibe64PackagingLines,
  resolveVibe64PackagingEnvironment,
  vibe64PackagingInspection
} from "./packaging.js";
import {
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  parseVibe64OutputsLines,
  resolveVibe64OutputParameters,
  vibe64OutputsInspection
} from "./outputs.js";
import {
  VIBE64_PROJECT_SERVICES_SECTION,
  parseVibe64ProjectServicesLines,
  vibe64ProjectServicesInspection
} from "./projectServices.js";
import {
  VIBE64_WORKSPACE_SETUP_SECTION,
  parseVibe64WorkspaceSetupLines,
  vibe64WorkspaceSetupInspection
} from "./workspaceSetup.js";
import {
  vibe64Driver
} from "./promptContext.js";
import {
  VIBE64_RESOURCE_ESTIMATES_SECTION,
  parseVibe64ResourceEstimatesLines,
  vibe64ResourceEstimatesInspection
} from "./resourceEstimates.js";

import { GENESIS_PASSES_ADAPTER, listGenesisPasses } from "./passes.js";
import {
  VIBE64_INTEGRATION_SETUP_SECTION,
  parseVibe64IntegrationSetupLines,
  vibe64IntegrationSetupInspection
} from "./integrationSetup.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const require = createRequire(import.meta.url);
const hostContextRegistries = new Map();

async function vibe64HostContextRegistry(runtimeRoot) {
  if (!path.isAbsolute(runtimeRoot || "")) throw new TypeError("Genesis host context requires an absolute runtime root.");
  const directory = path.join(runtimeRoot, "genesis-context");
  if (!hostContextRegistries.has(directory)) {
    const pending = createVibe64HostContextRegistry(directory).catch((error) => {
      hostContextRegistries.delete(directory);
      throw error;
    });
    hostContextRegistries.set(directory, pending);
  }
  return hostContextRegistries.get(directory);
}

const {
  GENESIS_CONTRACTS,
  HOST_CONTEXT_RESOLVER_DATA_ENV,
  HOST_CONTEXT_RESOLVER_ENV,
  addStack,
  applyTemplate,
  generatePrompt,
  indexCodebase,
  initialize,
  inspectCollaboration,
  inspectDerivedArtifacts,
  inspectEngineering,
  inspectEnvironment,
  inspectProject,
  inspectProjectFormat,
  inspectAgentIntegrations,
  inspectSkills,
  inspectStackSection,
  inspectStackSections,
  inspectSubsystems,
  listTemplates,
  parserEnvironment: genesisParserEnvironment,
  setCollaboration,
  setEngineeringProfile,
  syncAgentIntegrations,
  syncSkills,
  withTrustedGitRepository,
  SOURCE_EXPLANATION_PROMPT_VERSION,
  sourceExplanationGuidance,
  validateArchitectureFacts,
  mergeArchitectureObservations,
  validateCityDocument,
  validateCallWeb,
  CALL_WEB_SCHEMA,
  MACHINE_CITY_SCHEMA,
  PROGRAM_CITY_SCHEMA,
  CITY_SCHEMA_VERSION
} = genesisCompiler;

async function vibe64HostContextEnvironment(runtimeRoot) {
  const registry = await vibe64HostContextRegistry(runtimeRoot);
  return {
    [HOST_CONTEXT_RESOLVER_ENV]: vibe64HostContextResolverPath(),
    [HOST_CONTEXT_RESOLVER_DATA_ENV]: JSON.stringify({ registryPath: registry.registryPath }),
    GENESIS_TURN_CONTEXT_ENABLED: "0"
  };
}

const GENESIS_BLUEPRINT_PATH = "genesis/blueprint.md";
const GENESIS_SUBSYSTEMS_PATH = "genesis/subsystems.md";
// Stack pieces new-project onboarding does not offer: Vue and every PostgreSQL piece.
const VIBE64_HIDDEN_ONBOARDING_STACK_PIECES = Object.freeze([
  "vue",
  "django-postgresql",
  "jskit-postgresql",
  "postgresql",
  "rails-postgresql",
  "spring-boot-postgresql"
]);
const VIBE64_STACK_PACKAGES = Object.freeze(["genesis-stack"]);
const GENESIS_PROMPT_FALLBACK_TASKS = Object.freeze({ BLUEPRINT_INVALID: "blueprint", BLUEPRINT_REQUIRED: "start" });
// Genesis's own tasks, and the passes it offers (Deslop and the UI pass among them).
const GENESIS_PROMPT_TASKS = new Set([
  "adopt",
  "blueprint",
  "describe",
  "program",
  "review",
  "start",
  "work",
  ...GENESIS_PASSES_ADAPTER.map(({ id }) => id)
]);
// Genesis on a person's path, such as an AI message, answers within this
// deadline or the path goes on without it.
const GENESIS_USER_PATH_TIMEOUT_MS = 15_000;

/**
 * Runs a Genesis operation on a person's path within a deadline; past it the
 * returned promise rejects with code vibe64_genesis_timeout. Genesis offers no
 * way to cancel the operation, so it runs on and its late result is dropped.
 * @template T
 * @param {() => Promise<T>} operation
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
function withinGenesisDeadline(operation, timeoutMs = GENESIS_USER_PATH_TIMEOUT_MS) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(
      new Error(`Genesis did not answer within ${timeoutMs} ms.`),
      { code: "vibe64_genesis_timeout" }
    )), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), deadline]).finally(() => clearTimeout(timer));
}

function assertGenesisPromptTask(value, options = {}) {
  const {
    required = false
  } = options;
  const task = normalizeText(value);
  if (!task && !required) {
    return "";
  }
  if (!GENESIS_PROMPT_TASKS.has(task)) {
    throw new TypeError(task
      ? `Unknown Genesis prompt task: ${task}.`
      : "Genesis prompt actions require an explicit task.");
  }
  return task;
}

function genesisPromptTask(action = {}) {
  return assertGenesisPromptTask(action.genesisTask) || "work";
}

function genesisPromptRequest(input = {}, action = {}) {
  const candidates = [
    input.conversationRequest,
    input.feedback,
    input.request,
    input.plan,
    input.description,
    action.label
  ];
  return candidates.map(normalizeText).find(Boolean) || "Continue the requested project work.";
}

function genesisPackageBinDirectory() {
  const nodeModulesRoot = (require.resolve.paths("genesis-compiler") || [])
    .find((candidate) => (
      existsSync(path.join(candidate, "genesis-compiler")) &&
      existsSync(path.join(candidate, ".bin", "genesis"))
    ));
  if (!nodeModulesRoot) {
    throw new Error("The installed Genesis compiler executable could not be located.");
  }
  return path.join(nodeModulesRoot, ".bin");
}

function genesisCommandShimDirectory() {
  const serverEntrypoint = require.resolve("@local/vibe64-genesis/server");
  return path.resolve(path.dirname(serverEntrypoint), "../../bin");
}

function vibe64HostContextResolverPath() {
  return path.resolve(genesisCommandShimDirectory(), "vibe64-genesis-host-context");
}

function withGenesisCommandShim(shimDirectories = []) {
  const bin = genesisCommandShimDirectory();
  const compilerBin = genesisPackageBinDirectory();
  const directories = Array.isArray(shimDirectories) ? shimDirectories : [];
  return [
    ...directories.filter((directory) => ![bin, compilerBin].includes(normalizeText(directory))),
    bin
  ];
}

function withVibe64StackCatalog(stackOptions = {}, options = {}) {
  const {
    prompt = false
  } = options;
  return {
    ...stackOptions,
    ...(prompt ? { hiddenStackPieces: VIBE64_HIDDEN_ONBOARDING_STACK_PIECES } : {}),
    stackPackages: VIBE64_STACK_PACKAGES
  };
}

function addGenesisStack(options = {}) {
  return runGenesisOperation(addStack, options);
}

function initializeGenesisProject(options = {}) {
  return runGenesisOperation(initialize, options);
}

function inspectGenesisSkills(options = {}) {
  return inspectGenesis(inspectSkills, options);
}

function syncGenesisSkills(options = {}) {
  return runGenesisOperation(syncSkills, options);
}

function syncGenesisAgentIntegrations(options = {}) {
  return runGenesisOperation(syncAgentIntegrations, options);
}

function inspectGenesisAgentIntegrations(options = {}) {
  return inspectGenesis(inspectAgentIntegrations, options);
}

function inspectGenesisSubsystems(options = {}) {
  return inspectGenesis(inspectSubsystems, options);
}

async function inspectVibe64ArchitectureInspection(options = {}) {
  return vibe64ArchitectureInspection(await inspectGenesisStackSection(VIBE64_ARCHITECTURE_INSPECTION_SECTION, options));
}

async function inspectVibe64ArchitectureLayout(options = {}) {
  return vibe64ArchitectureLayout(await inspectGenesisStackSection(VIBE64_ARCHITECTURE_LAYOUT_SECTION, options));
}

function refreshGenesisCities(options = {}) {
  return runGenesisOperation(indexCodebase, options);
}

function inspectGenesisDerivedArtifacts() {
  const result = inspectDerivedArtifacts();
  if (result?.contract !== GENESIS_CONTRACTS.derivedArtifacts) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${GENESIS_CONTRACTS.derivedArtifacts}.`);
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  if (!artifacts.length || artifacts.some((artifact) => !normalizeText(artifact?.path))) {
    throw new Error("Genesis returned an invalid derived-artifact contract.");
  }
  return {
    ...result,
    artifacts: artifacts.map((artifact) => ({ ...artifact }))
  };
}

const GENESIS_DERIVED_ARTIFACT_CONTRACT = inspectGenesisDerivedArtifacts();
const GENESIS_DERIVED_ARTIFACT_PATHS = Object.freeze(
  GENESIS_DERIVED_ARTIFACT_CONTRACT.artifacts.map((artifact) => artifact.path)
);
const GENESIS_DERIVED_ARTIFACTS_BY_ID = new Map(
  GENESIS_DERIVED_ARTIFACT_CONTRACT.artifacts.map((artifact) => [artifact.id, artifact])
);
const GENESIS_MACHINE_CITY_PATH = GENESIS_DERIVED_ARTIFACTS_BY_ID.get("machine-city")?.path;
const GENESIS_PROGRAM_CITY_PATH = GENESIS_DERIVED_ARTIFACTS_BY_ID.get("program-city")?.path;
if (!GENESIS_MACHINE_CITY_PATH || !GENESIS_PROGRAM_CITY_PATH) {
  throw new Error("Genesis did not declare both City projection artifacts.");
}
const GENESIS_CALL_WEB_PATH = GENESIS_DERIVED_ARTIFACTS_BY_ID.get("call-web")?.path;
if (!GENESIS_CALL_WEB_PATH) {
  throw new Error("Genesis did not declare its call-web artifact.");
}

async function runGenesisOperation(operation, options = {}, catalogOptions = {}) {
  const projectRoot = normalizeText(options.projectRoot);
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    throw new TypeError("Genesis operations require an explicit absolute projectRoot.");
  }
  return withTrustedGitRepository(projectRoot, () => operation(withVibe64StackCatalog(options, catalogOptions)));
}

// A caller that does not log why Genesis is unavailable.
function ignoreGenesisUnavailable() {
  return undefined;
}

function genesisGuidanceUnavailableNote(error) {
  const reason = normalizeText(error?.message || error).replace(/\s+/gu, " ").slice(0, 300);
  return `Genesis project guidance is unavailable for this conversation (${reason || "no reason given"}). ` +
    "Work from the repository itself, where the genesis/ files still describe the project when present, " +
    "and tell the user that Genesis guidance did not load if it matters to the request.";
}

/**
 * Applications own the prompt; the conversation runtime owns its native delivery.
 * Nothing Genesis does stops the conversation: when Genesis fails, does not
 * answer within the deadline or answers without guidance, the conversation gets
 * Vibe64's own contribution and a note that Genesis's guidance is missing.
 * @param {object} request
 * @param {object} request.promptContext
 * @param {string} request.workdir
 * @param {object} [options]
 * @param {(error: Error) => void} [options.onGenesisUnavailable] reports why Genesis's guidance is missing
 * @param {number} [options.timeoutMs]
 */
async function vibe64ConversationInstructions({ workdir, promptContext }, {
  onGenesisUnavailable = ignoreGenesisUnavailable,
  timeoutMs = GENESIS_USER_PATH_TIMEOUT_MS
} = {}) {
  const contribution = vibe64Driver(promptContext);
  if (promptContext.scope === "ephemeral") return contribution;
  let failure;
  try {
    const result = await withinGenesisDeadline(() => runGenesisOperation(genesisCompiler.projectSessionContext, {
      projectRoot: workdir,
      hostDriver: vibe64Driver,
      hostDriverInput: promptContext
    }), timeoutMs);
    if (typeof result?.output === "string" && result.output.trim()) return result.output;
    failure = new Error("Genesis returned no session guidance.");
  } catch (error) {
    failure = error;
  }
  onGenesisUnavailable(failure);
  return `${genesisGuidanceUnavailableNote(failure)}\n\n${contribution}`;
}

/**
 * A read-only Genesis inspection answers within the deadline, so a page, Preview, workspace setup or
 * message never waits on a Genesis that hangs: past it the inspection fails with vibe64_genesis_timeout,
 * as any other Genesis failure. Changes Genesis makes are not bounded; abandoning one part way would
 * release the locks it runs under while it still writes.
 */
function inspectGenesis(inspector, options = {}) {
  return withinGenesisDeadline(() => runGenesisOperation(inspector, options));
}

function exactGenesisContract(result, contract) {
  if (result?.contract !== contract) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${contract}.`);
  }
  return result;
}

async function exactGenesisInspection(inspector, contract, options = {}) {
  return exactGenesisContract(await inspectGenesis(inspector, options), contract);
}

async function exactGenesisChange(operation, contract, options = {}) {
  return exactGenesisContract(await runGenesisOperation(operation, options), contract);
}

function inspectGenesisStackSection(name, options = {}) {
  return exactGenesisInspection(
    (inspectionOptions) => inspectStackSection({ ...inspectionOptions, name }),
    GENESIS_CONTRACTS.stackSection,
    options
  );
}

async function inspectGenesisStackSections(names, options = {}) {
  const sections = await inspectGenesis(
    (inspectionOptions) => inspectStackSections({ ...inspectionOptions, names }),
    options
  );
  if (!Array.isArray(sections) || sections.length !== names.length ||
      sections.some((section, index) => section?.contract !== GENESIS_CONTRACTS.stackSection || section.name !== names[index])) {
    throw new Error("Genesis returned an invalid Stack section inspection batch.");
  }
  return sections;
}

async function inspectGenesisStackComponents(options = {}) {
  const format = await inspectGenesisProjectFormat(options);
  if (format.status !== "current") {
    throw Object.assign(new Error("The project needs a current Genesis format before its Stack can be inspected."), {
      code: "vibe64_stack_format_required"
    });
  }
  // The compiler treats an absent Stack as empty during bootstrap. An explicit
  // inspection must distinguish that from a saved, valid empty selection.
  await readFile(path.join(options.projectRoot, GENESIS_STACK_PATH), "utf8");
  const stack = await inspectGenesisStackSection(VIBE64_WORKSPACE_SETUP_SECTION, options);
  return { components: stack.components, stackHash: stack.stackHash };
}

async function inspectVibe64Deployment(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_APPLICATION_DEPLOYMENT_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64DeploymentInspection({ environment, section });
}

async function inspectVibe64Packaging(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_PACKAGING_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64PackagingInspection({ environment, section });
}

/**
 * Runs the project's own `## Verification` commands in projectRoot (a Git checkout).
 */
function verifyGenesisProject(options = {}) {
  return runGenesisOperation(genesisCompiler.verify, options);
}

function inspectGenesisEnvironment(options = {}) {
  return exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options);
}

function inspectGenesisProject(options = {}) {
  return exactGenesisInspection(inspectProject, GENESIS_CONTRACTS.projectInspection, options);
}

function listGenesisTemplates(options = {}) {
  return exactGenesisInspection(listTemplates, GENESIS_CONTRACTS.templates, options);
}

function applyGenesisTemplate(options = {}) {
  return exactGenesisChange(applyTemplate, GENESIS_CONTRACTS.templateApplication, options);
}

function inspectGenesisEngineering(options = {}) {
  return exactGenesisInspection(inspectEngineering, GENESIS_CONTRACTS.engineering, options);
}

function inspectGenesisCollaboration(options = {}) {
  return exactGenesisInspection(inspectCollaboration, GENESIS_CONTRACTS.collaboration, options);
}

async function inspectGenesisProjectFormat(options = {}) {
  const result = await inspectGenesis(inspectProjectFormat, options);
  if (!normalizeText(result?.status)) {
    throw new Error("Genesis did not return a project-format status.");
  }
  return { ...result };
}

function setGenesisEngineeringProfile(options = {}) {
  return exactGenesisChange(setEngineeringProfile, GENESIS_CONTRACTS.engineering, options);
}

function setGenesisCollaboration(options = {}) {
  return exactGenesisChange(setCollaboration, GENESIS_CONTRACTS.collaboration, options);
}

/**
 * resourcesPreparing (the host is still preparing resources it supplies) only
 * words the reason Preview cannot start; Genesis never sees it.
 */
async function inspectVibe64Outputs({ resourcesPreparing = false, ...options } = {}) {
  const [[section, resourceSection, workspaceSetupSection], environment] = await Promise.all([
    inspectGenesisStackSections([
      VIBE64_OUTPUTS_SECTION, VIBE64_RESOURCE_ESTIMATES_SECTION, VIBE64_WORKSPACE_SETUP_SECTION
    ], options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  const outputs = vibe64OutputsInspection({ environment, section, resourcesPreparing: resourcesPreparing === true });
  return {
    ...outputs,
    resourceEstimates: vibe64ResourceEstimatesInspection({
      section: resourceSection,
      outputsSection: section,
      workspaceSetupSection
    })
  };
}

async function inspectVibe64IntegrationSetup(options = {}) {
  const section = await inspectGenesisStackSection(VIBE64_INTEGRATION_SETUP_SECTION, options);
  return vibe64IntegrationSetupInspection({ section });
}

async function inspectVibe64ConnectedDevelopment(options = {}) {
  return vibe64ConnectedDevelopmentInspection(await inspectGenesisStackSection(VIBE64_CONNECTED_DEVELOPMENT_SECTION, options));
}

async function inspectVibe64ProjectServices(options = {}) {
  return vibe64ProjectServicesInspection(await inspectGenesisStackSection(VIBE64_PROJECT_SERVICES_SECTION, options));
}

async function inspectVibe64WorkspaceSetup(options = {}) {
  const [section, resourceSection, outputsSection] = await inspectGenesisStackSections([
    VIBE64_WORKSPACE_SETUP_SECTION, VIBE64_RESOURCE_ESTIMATES_SECTION, VIBE64_OUTPUTS_SECTION
  ], options);
  const setup = await vibe64WorkspaceSetupInspection({
    projectRoot: options.projectRoot,
    section
  });
  return {
    ...setup,
    resourceEstimates: vibe64ResourceEstimatesInspection({
      section: resourceSection,
      outputsSection,
      workspaceSetupSection: section
    })
  };
}

async function inspectVibe64ResourceEstimates(options = {}) {
  const [section, outputsSection, workspaceSetupSection] = await inspectGenesisStackSections([
    VIBE64_RESOURCE_ESTIMATES_SECTION, VIBE64_OUTPUTS_SECTION, VIBE64_WORKSPACE_SETUP_SECTION
  ], options);
  return vibe64ResourceEstimatesInspection({ section, outputsSection, workspaceSetupSection });
}

/**
 * @param {object} request
 * @param {object} [request.action] the prompt task: its genesisTask, id and label
 * @param {RuntimeEnv} request.environment the environment Genesis runs in
 * @param {object} [request.input] the request text and its options; automaticGenesisTask
 *   marks a task Vibe64 chose itself, which never falls back to the Blueprint's task
 * @param {(error: Error) => void} [request.onGenesisUnavailable] reports why the request goes as written
 * @param {string} request.projectRoot
 * @param {number} [request.timeoutMs]
 */
async function renderGenesisPrompt({
  action = {},
  environment,
  input = {},
  onGenesisUnavailable = ignoreGenesisUnavailable,
  projectRoot,
  timeoutMs = GENESIS_USER_PATH_TIMEOUT_MS
}) {
  const requestedTask = genesisPromptTask(action);
  const request = genesisPromptRequest(input, action);
  const generate = (promptTask) => runGenesisOperation(generatePrompt, {
    environment,
    projectRoot,
    request,
    sessionContextInstalled: true,
    task: promptTask
  }, { prompt: true });
  const compose = async () => {
    try {
      return { result: await generate(requestedTask), task: requestedTask };
    } catch (error) {
      // A missing or invalid Blueprint is answered by the task that writes one.
      const fallbackTask = Object.hasOwn(GENESIS_PROMPT_FALLBACK_TASKS, String(error?.code))
        ? GENESIS_PROMPT_FALLBACK_TASKS[error.code]
        : "";
      // A task Vibe64 chose itself, such as an automatic finishing turn's review,
      // never becomes the Blueprint's: its request goes as written.
      if (!fallbackTask || fallbackTask === requestedTask || input.automaticGenesisTask === true) throw error;
      return { result: await generate(fallbackTask), task: fallbackTask };
    }
  };
  // Nothing Genesis does while composing the prompt stops the message: when it
  // fails, does not answer within the deadline or answers without a prompt, the
  // request goes as written. For a project file Genesis cannot read, the AI
  // reads Genesis's diagnostic in its session context.
  let composed;
  try {
    composed = await withinGenesisDeadline(compose, timeoutMs);
    if (typeof composed.result?.prompt !== "string" || !composed.result.prompt.trim()) {
      throw new Error("Genesis returned no prompt.");
    }
  } catch (error) {
    onGenesisUnavailable(error);
    return { prompt: request };
  }
  const { result, task } = composed;
  const effectiveTask = GENESIS_PROMPT_TASKS.has(normalizeText(result.task)) ? normalizeText(result.task) : task;
  return {
    context: {
      genesis: true,
      requestedTask,
      task: effectiveTask,
      verificationCommands: result.verificationCommands,
      warnings: result.warnings
    },
    originalPrompt: request,
    prompt: result.prompt,
    promptId: normalizeText(action.promptId || action.id) || effectiveTask
  };
}

export {
  GENESIS_STACK_PATH,
  GENESIS_STACK_SECTION_AMBIGUOUS,
  genesisProjectContractNeedsAttention,
  genesisProjectFileDiagnostic,
  genesisProjectFileUnreadable,
  inspectVibe64ConnectedDevelopment,
  inspectVibe64ProjectServices,
  parseVibe64ProjectServicesLines,
  inspectVibe64IntegrationSetup,
  parseVibe64IntegrationSetupLines,
  genesisParserEnvironment,
  GENESIS_BLUEPRINT_PATH,
  GENESIS_SUBSYSTEMS_PATH,
  GENESIS_CALL_WEB_PATH,
  GENESIS_DERIVED_ARTIFACT_PATHS,
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  GENESIS_USER_PATH_TIMEOUT_MS,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_PACKAGING_CONTRACT,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  addGenesisStack,
  applyGenesisTemplate,
  assertGenesisPromptTask,
  genesisPackageBinDirectory,
  genesisCommandShimDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisCollaboration,
  inspectGenesisDerivedArtifacts,
  inspectGenesisEngineering,
  inspectGenesisProjectFormat,
  inspectGenesisProject,
  inspectGenesisAgentIntegrations,
  inspectGenesisSkills,
  listGenesisPasses,
  listGenesisTemplates,
  inspectGenesisStackComponents,
  inspectVibe64Deployment,
  inspectVibe64Packaging,
  verifyGenesisProject,
  inspectGenesisEnvironment,
  inspectVibe64Outputs,
  inspectVibe64ResourceEstimates,
  inspectVibe64WorkspaceSetup,
  parseVibe64OutputsLines,
  resolveVibe64OutputParameters,
  parseVibe64ResourceEstimatesLines,
  parseVibe64DeploymentLines,
  parseVibe64PackagingLines,
  resolveVibe64PackagingEnvironment,
  parseVibe64WorkspaceSetupLines,
  refreshGenesisCities,
  inspectVibe64ArchitectureInspection,
  readArchitecturePreviewLocator,
  inspectVibe64ArchitectureLayout,
  validateArchitectureFacts,
  validateCityDocument,
  validateCallWeb,
  CALL_WEB_SCHEMA,
  MACHINE_CITY_SCHEMA,
  PROGRAM_CITY_SCHEMA,
  CITY_SCHEMA_VERSION,
  SOURCE_EXPLANATION_PROMPT_VERSION,
  sourceExplanationGuidance,
  mergeArchitectureObservations,
  inspectGenesisSubsystems,
  renderGenesisPrompt,
  setGenesisCollaboration,
  setGenesisEngineeringProfile,
  syncGenesisAgentIntegrations,
  syncGenesisSkills,
  vibe64ConversationInstructions,
  vibe64Driver,
  vibe64HostContextResolverPath,
  vibe64HostContextEnvironment,
  vibe64HostContextRegistry,
  withGenesisCommandShim,
  withinGenesisDeadline
};
