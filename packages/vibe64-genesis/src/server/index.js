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
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT, VIBE64_APPLICATION_DEPLOYMENT_SECTION, VIBE64_APPLICATION_DEPLOYMENT_V1_CONTRACT,
  parseVibe64DeploymentLines, vibe64DeploymentInspection
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
import { VIBE64_PROJECT_SERVICES_SECTION, parseVibe64ProjectServicesLines, vibe64ProjectServicesInspection } from "./projectServices.js";
import { VIBE64_STAGING_DATA_SECTION, vibe64StagingDataInspection } from "./stagingData.js";
import { VIBE64_WORKSPACE_SETUP_SECTION, parseVibe64WorkspaceSetupLines, vibe64WorkspaceSetupInspection } from "./workspaceSetup.js";
import { vibe64Driver } from "./promptContext.js";
import {
  VIBE64_RESOURCE_ESTIMATES_SECTION,
  parseVibe64ResourceEstimatesLines,
  vibe64ResourceEstimatesInspection
} from "./resourceEstimates.js";
import { VIBE64_INTEGRATION_SETUP_SECTION, parseVibe64IntegrationSetupLines, vibe64IntegrationSetupInspection } from "./integrationSetup.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").GenesisPass} GenesisPass */
/** @typedef {import("./types.js").GenesisMasterPass} GenesisMasterPass */

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
  PROMPT_TASKS,
  addStack,
  applyTemplate,
  generatePrompt,
  indexCodebase,
  initialize,
  inspectCollaboration,
  inspectDerivedArtifacts,
  inspectEngineering,
  inspectEnvironment,
  inspectPasses,
  inspectProject,
  inspectProjectFormat,
  inspectAgentIntegrations,
  inspectSkills,
  inspectStackSection,
  inspectStackSections,
  inspectSubsystems,
  inspectVerification,
  listStackPieces,
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
// Every prompt task Genesis renders, its passes' tasks among them, as Genesis lists them.
if (!Array.isArray(PROMPT_TASKS)) throw new Error("This genesis-compiler lists no prompt tasks. Update it to the release Vibe64 declares.");
const GENESIS_PROMPT_TASKS = new Set(PROMPT_TASKS);
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

/** The Stack catalogue (Vibe64's and the project's), each piece with its Requires, Conflicts and resourceDeclarations. */
async function listGenesisStackPieces(options = {}) {
  const pieces = await inspectGenesis(listStackPieces, options);
  if (pieces.every((piece) => Array.isArray(piece?.resourceDeclarations))) return pieces;
  throw new Error("This genesis-compiler lists no Stack resource declarations. Update it to the release Vibe64 declares.");
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
 * Genesis's warning that it cut Vibe64's part to its bound goes to `onHostGuidanceCut`.
 * @param {object} request
 * @param {object} request.promptContext
 * @param {string} request.workdir
 * @param {object} [options]
 * @param {(error: Error) => void} [options.onGenesisUnavailable] reports why Genesis's guidance is missing
 * @param {(warning: { code: string, message: string }) => void} [options.onHostGuidanceCut] reports Genesis's cut
 * @param {number} [options.timeoutMs]
 */
async function vibe64ConversationInstructions({ workdir, promptContext }, {
  onGenesisUnavailable = ignoreGenesisUnavailable,
  onHostGuidanceCut = () => undefined,
  timeoutMs = GENESIS_USER_PATH_TIMEOUT_MS
} = {}) {
  const contribution = vibe64Driver(promptContext);
  if (promptContext.scope === "ephemeral") return contribution;
  let failure;
  try {
    const options = { projectRoot: workdir, hostDriver: vibe64Driver, hostDriverInput: promptContext };
    const result = await withinGenesisDeadline(() => runGenesisOperation(genesisCompiler.projectSessionContext, options), timeoutMs);
    if (typeof result?.output === "string" && result.output.trim()) {
      const cuts = Array.isArray(result.warnings) ? result.warnings.filter((warning) => warning?.code === "HOST_CONTEXT_TRUNCATED") : [];
      cuts.forEach((warning) => onHostGuidanceCut(warning));
      return result.output;
    }
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

// The inspection of a section read with the Stack's environment (its resources, Environment defaults), from one Stack.
function withGenesisEnvironment(sectionName, interpret) {
  return async (options = {}) => {
    const [section, environment] = await Promise.all([
      inspectGenesisStackSection(sectionName, options),
      exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
    ]);
    return interpret({ environment, section });
  };
}

const inspectVibe64Deployment = withGenesisEnvironment(VIBE64_APPLICATION_DEPLOYMENT_SECTION, vibe64DeploymentInspection);
const inspectVibe64Packaging = withGenesisEnvironment(VIBE64_PACKAGING_SECTION, vibe64PackagingInspection);
const inspectVibe64StagingData = withGenesisEnvironment(VIBE64_STAGING_DATA_SECTION, vibe64StagingDataInspection);

/**
 * Runs the project's own `## Verification` commands in projectRoot (a Git checkout).
 */
function verifyGenesisProject(options = {}) {
  return runGenesisOperation(genesisCompiler.verify, options);
}

/**
 * The Stack's declared `## Verification` commands, each { label, argv } in order, and the Stack identity verify
 * records with them, from one Genesis Stack read that runs nothing: how a host recognises a declared check.
 * @param {{ projectRoot: string }} options
 * @returns {Promise<{ stackHash: string, commands: { label: string, argv: string[] }[] }>}
 */
async function inspectGenesisVerification(options = {}) {
  if (!inspectVerification) {
    throw new Error("This genesis-compiler cannot list the Stack's Verification commands. Update it to the release Vibe64 declares.");
  }
  const { stackHash, commands } = await exactGenesisInspection(inspectVerification, GENESIS_CONTRACTS.verificationInspection, options);
  return { stackHash, commands };
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

/**
 * The passes Genesis offers for a project, in its order, each with its last completed run there and its runs, the
 * Master pass that runs them deeply in turn, and why the Genesis serving the project runs no pass (null when it runs them).
 * This is Vibe64's one reader of Genesis's pass list and its record of runs; a malformed record
 * fails it with Genesis's PASS_RECORD_INVALID, whose message names the file and the fix.
 * @param {{ projectRoot: string, connectedRoots?: string[] }} options connectedRoots: the session's connected copies
 * @returns {Promise<{ unavailable: string | null, passes: GenesisPass[], master: GenesisMasterPass }>}
 */
async function listGenesisPasses(options) {
  const { unavailable, passes, master } = await exactGenesisInspection(inspectPasses, GENESIS_CONTRACTS.passes, options);
  return { unavailable, passes, master };
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
 * @param {string[]} [request.connectedRoots] the session's connected copies, which a pass over the whole app covers too
 * @param {RuntimeEnv} [request.environment] the Env the session's commands receive (resource inputs are checked against it)
 * @param {{ component: string, id: string }[]} [request.pendingResources] managed resources its first command creates
 * @param {object} [request.input] the request text and its options; automaticGenesisTask
 *   marks a task Vibe64 chose itself, which never falls back to the Blueprint's task
 * @param {(error: Error) => void} [request.onGenesisUnavailable] reports why the request goes as written
 * @param {string} request.projectRoot
 * @param {number} [request.timeoutMs]
 */
async function renderGenesisPrompt({
  action = {},
  connectedRoots = [],
  environment,
  input = {},
  onGenesisUnavailable = ignoreGenesisUnavailable,
  pendingResources = [],
  projectRoot,
  timeoutMs = GENESIS_USER_PATH_TIMEOUT_MS
}) {
  const requestedTask = genesisPromptTask(action);
  const request = genesisPromptRequest(input, action);
  const generate = (promptTask) => runGenesisOperation(generatePrompt, {
    connectedRoots, environment, pendingResources, projectRoot, request, sessionContextInstalled: true, task: promptTask
  }, { prompt: true });
  const compose = async () => {
    try {
      return { result: await generate(requestedTask), task: requestedTask };
    } catch (error) {
      // A missing or invalid Blueprint is answered by the task that writes one.
      const fallbackTask = Object.hasOwn(GENESIS_PROMPT_FALLBACK_TASKS, String(error?.code))
        ? GENESIS_PROMPT_FALLBACK_TASKS[error.code]
        : "";
      // A task Vibe64 chose itself, such as a plan's pass,
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
  VIBE64_APPLICATION_DEPLOYMENT_V1_CONTRACT,
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
  listGenesisStackPieces,
  listGenesisTemplates,
  inspectGenesisStackComponents,
  inspectVibe64Deployment,
  inspectVibe64Packaging,
  inspectVibe64StagingData,
  verifyGenesisProject,
  inspectGenesisEnvironment,
  inspectGenesisVerification,
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
export { STAGING_DATA_ENTRY_FORMS, STAGING_DATA_MODES, VIBE64_STAGING_DATA_CONTRACT, VIBE64_STAGING_DATA_SECTION } from "./stagingData.js";
export { parseVibe64StagingDataLines, vibe64StagingDataInspection } from "./stagingData.js";
