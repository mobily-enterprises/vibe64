import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as genesisCompiler from "genesis-compiler";

import {
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
} from "./applicationDeployment.js";
import {
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  parseVibe64OutputsLines,
  vibe64OutputsInspection
} from "./outputs.js";
import {
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  parseVibe64WorkspaceSetupLines,
  vibe64WorkspaceSetupInspection
} from "./workspaceSetup.js";
import {
  vibe64Driver
} from "./promptContext.js";

const require = createRequire(import.meta.url);

const {
  GENESIS_CONTRACTS,
  HOST_CONTEXT_RESOLVER_DATA_ENV,
  HOST_CONTEXT_RESOLVER_ENV,
  SESSION_CONTEXT_INSTALLED_ENV,
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
  inspectSkills,
  inspectStackSection,
  projectSessionContext,
  listTemplates,
  setCollaboration,
  setEngineeringProfile,
  syncSkills,
  withTrustedGitRepository
} = genesisCompiler;

const GENESIS_BLUEPRINT_PATH = "genesis/blueprint.md";
const VIBE64_POSTGRESQL_NEW_PROJECT_AVAILABLE = false;
const VIBE64_HIDDEN_ONBOARDING_STACK_PIECES = Object.freeze([
  "vue",
  ...(VIBE64_POSTGRESQL_NEW_PROJECT_AVAILABLE ? [] : ["jskit-postgresql", "postgresql"])
]);
const VIBE64_STACK_PACKAGES = Object.freeze(["genesis-stack"]);
const GENESIS_PROMPT_TASKS = new Set([
  "adopt",
  "blueprint",
  "describe",
  "deslop",
  "program",
  "review",
  "start",
  "work"
]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function assertGenesisPromptTask(value, {
  required = false
} = {}) {
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

function withVibe64StackCatalog(options = {}, {
  prompt = false
} = {}) {
  return {
    ...options,
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
  return runGenesisOperation(inspectSkills, options);
}

function syncGenesisSkills(options = {}) {
  return runGenesisOperation(syncSkills, options);
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

async function runGenesisOperation(operation, options = {}, catalogOptions = {}) {
  const projectRoot = normalizeText(options.projectRoot);
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    throw new TypeError("Genesis operations require an explicit absolute projectRoot.");
  }
  return withTrustedGitRepository(projectRoot, () => operation(withVibe64StackCatalog(options, catalogOptions)));
}

async function exactGenesisInspection(inspector, contract, options = {}) {
  const result = await runGenesisOperation(inspector, options);
  if (result?.contract !== contract) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${contract}.`);
  }
  return result;
}

function inspectGenesisStackSection(name, options = {}) {
  return exactGenesisInspection(
    (inspectionOptions) => inspectStackSection({ ...inspectionOptions, name }),
    GENESIS_CONTRACTS.stackSection,
    options
  );
}

async function inspectVibe64Deployment(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_APPLICATION_DEPLOYMENT_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64DeploymentInspection({ environment, section });
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
  return exactGenesisInspection(applyTemplate, GENESIS_CONTRACTS.templateApplication, options);
}

function inspectGenesisEngineering(options = {}) {
  return exactGenesisInspection(inspectEngineering, GENESIS_CONTRACTS.engineering, options);
}

function inspectGenesisCollaboration(options = {}) {
  return exactGenesisInspection(inspectCollaboration, GENESIS_CONTRACTS.collaboration, options);
}

async function inspectGenesisProjectFormat(options = {}) {
  const result = await runGenesisOperation(inspectProject, options);
  if (!normalizeText(result?.projectFormat?.status)) {
    throw new Error("Genesis did not return a project-format status.");
  }
  return { ...result.projectFormat };
}

function setGenesisEngineeringProfile(options = {}) {
  return exactGenesisInspection(setEngineeringProfile, GENESIS_CONTRACTS.engineering, options);
}

function setGenesisCollaboration(options = {}) {
  return exactGenesisInspection(setCollaboration, GENESIS_CONTRACTS.collaboration, options);
}

function composeVibe64SessionContext({
  conversationKind,
  projectRoot,
  session
} = {}) {
  return exactGenesisInspection(
    (options) => projectSessionContext({
      ...options,
      hostDriver: vibe64Driver,
      hostDriverInput: {
        conversationKind,
        scope: "session",
        session
      }
    }),
    GENESIS_CONTRACTS.sessionContext,
    { projectRoot }
  );
}

async function inspectVibe64Outputs(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_OUTPUTS_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64OutputsInspection({ environment, section });
}

async function inspectVibe64WorkspaceSetup(options = {}) {
  const section = await inspectGenesisStackSection(VIBE64_WORKSPACE_SETUP_SECTION, options);
  return vibe64WorkspaceSetupInspection({
    projectRoot: options.projectRoot,
    section
  });
}

async function renderGenesisPrompt({
  action = {},
  environment = process.env,
  input = {},
  projectRoot
} = {}) {
  const requestedTask = genesisPromptTask(action);
  const request = genesisPromptRequest(input, action);
  let task = requestedTask;
  let result;
  try {
    result = await runGenesisOperation(generatePrompt, {
      environment,
      projectRoot,
      request,
      sessionContextInstalled: true,
      task
    }, { prompt: true });
  } catch (error) {
    if (error?.code === "BLUEPRINT_INVALID" && requestedTask !== "blueprint") {
      task = "blueprint";
      result = await runGenesisOperation(generatePrompt, {
        environment,
        projectRoot,
        request,
        sessionContextInstalled: true,
        task
      }, { prompt: true });
    } else if (error?.code === "BLUEPRINT_REQUIRED" && requestedTask !== "start") {
      task = "start";
      result = await runGenesisOperation(generatePrompt, {
        environment,
        projectRoot,
        request,
        sessionContextInstalled: true,
        task
      }, { prompt: true });
    } else {
      throw error;
    }
  }
  const effectiveTask = assertGenesisPromptTask(result.task) || task;
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
  GENESIS_BLUEPRINT_PATH,
  GENESIS_DERIVED_ARTIFACT_PATHS,
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  HOST_CONTEXT_RESOLVER_DATA_ENV,
  HOST_CONTEXT_RESOLVER_ENV,
  SESSION_CONTEXT_INSTALLED_ENV,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  addGenesisStack,
  applyGenesisTemplate,
  assertGenesisPromptTask,
  composeVibe64SessionContext,
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
  inspectGenesisSkills,
  listGenesisTemplates,
  inspectGenesisStackSection,
  inspectVibe64Deployment,
  inspectGenesisEnvironment,
  inspectVibe64Outputs,
  inspectVibe64WorkspaceSetup,
  parseVibe64OutputsLines,
  parseVibe64DeploymentLines,
  parseVibe64WorkspaceSetupLines,
  refreshGenesisCities,
  renderGenesisPrompt,
  setGenesisCollaboration,
  setGenesisEngineeringProfile,
  syncGenesisSkills,
  vibe64Driver,
  vibe64HostContextResolverPath,
  withGenesisCommandShim
};
