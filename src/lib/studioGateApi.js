import {
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const AI_STUDIO_PROJECT_CONFIG_API_SUFFIX = "/ai-studio/project-config";
const AI_STUDIO_PROJECT_TYPE_API_SUFFIX = "/ai-studio/project-type";

const BOOTSTRAP_ENDPOINT = studioApiPath("studio/bootstrap");
const TARGET_BOOTUP_ENDPOINT = studioApiPath("studio/target-app");
const TARGET_SETUP_ENDPOINT = studioApiPath("studio/app-setup");
const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const AI_STUDIO_ENDPOINT = studioApiPath("ai-studio");
const PROJECT_CONFIG_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-config`;
const PROJECT_TYPE_ENDPOINT = `${AI_STUDIO_ENDPOINT}/project-type`;

const BOOTSTRAP_TERMINAL_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/terminal`;
const TARGET_BOOTUP_TERMINAL_ENDPOINT = `${TARGET_BOOTUP_ENDPOINT}/terminal`;
const TARGET_SETUP_TERMINAL_ENDPOINT = `${TARGET_SETUP_ENDPOINT}/terminal`;
const BOOTSTRAP_STREAM_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/stream`;
const TARGET_BOOTUP_STREAM_ENDPOINT = `${TARGET_BOOTUP_ENDPOINT}/stream`;
const TARGET_SETUP_STREAM_ENDPOINT = `${TARGET_SETUP_ENDPOINT}/stream`;

let lastResolvedStudioGate = null;

function projectTypeQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-type"];
}

function projectConfigQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "project-config"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter) {
  return ["ai-studio", surfaceId, ownershipFilter, "target-project"];
}

function rememberStudioGate(gate) {
  lastResolvedStudioGate = gate || null;
  return gate;
}

function consumeStudioGate(route) {
  if (!lastResolvedStudioGate || lastResolvedStudioGate.route !== route) {
    return null;
  }

  const gate = lastResolvedStudioGate;
  lastResolvedStudioGate = null;
  return gate;
}

async function readBootstrapStatus() {
  return studioHttpClient.get(BOOTSTRAP_ENDPOINT);
}

async function readTargetBootupStatus() {
  return studioHttpClient.get(TARGET_BOOTUP_ENDPOINT);
}

async function readTargetSetupStatus() {
  return studioHttpClient.get(TARGET_SETUP_ENDPOINT);
}

async function readTargetProject() {
  return studioHttpClient.get(TARGET_PROJECT_ENDPOINT);
}

async function readAiStudioProjectType() {
  return studioHttpClient.get(PROJECT_TYPE_ENDPOINT);
}

async function readAiStudioProjectConfig() {
  return studioHttpClient.get(PROJECT_CONFIG_ENDPOINT);
}

async function resolveStudioGate() {
  const bootstrap = await readBootstrapStatus();
  if (bootstrap?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/bootup-setup",
      tab: "bootup"
    });
  }

  const targetBootup = await readTargetBootupStatus();
  if (targetBootup?.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      route: "/bootup-setup",
      tab: "target-bootup",
      targetBootup
    });
  }

  const [targetProject, projectResponse] = await Promise.all([
    readTargetProject(),
    readAiStudioProjectType()
  ]);
  const projectType = projectResponse?.projectType || {};
  if (projectType.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      targetProject: {
        ...targetProject,
        projectType
      },
      route: "/home",
      targetBootup
    });
  }

  const projectConfigResponse = await readAiStudioProjectConfig();
  const projectConfig = projectConfigResponse?.config || {};
  if (projectConfig.ready !== true) {
    return rememberStudioGate({
      bootstrap,
      projectConfig,
      targetProject: {
        ...targetProject,
        projectType,
        projectConfig
      },
      route: "/home",
      targetBootup
    });
  }

  const targetSetup = await readTargetSetupStatus();
  if (targetSetup?.ready !== true) {
    return rememberStudioGate({
      targetSetup,
      bootstrap,
      route: "/bootup-setup",
      tab: "target-setup",
      targetBootup
    });
  }

  return rememberStudioGate({
    targetSetup,
    bootstrap,
    route: "/home",
    targetBootup
  });
}

export {
  AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  TARGET_SETUP_STREAM_ENDPOINT,
  TARGET_SETUP_TERMINAL_ENDPOINT,
  BOOTSTRAP_STREAM_ENDPOINT,
  BOOTSTRAP_TERMINAL_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_BOOTUP_STREAM_ENDPOINT,
  TARGET_BOOTUP_TERMINAL_ENDPOINT,
  consumeStudioGate,
  projectConfigQueryKey,
  projectTypeQueryKey,
  readAiStudioProjectConfig,
  readTargetSetupStatus,
  readAiStudioProjectType,
  readBootstrapStatus,
  readTargetProject,
  readTargetBootupStatus,
  resolveStudioGate,
  targetProjectQueryKey
};
