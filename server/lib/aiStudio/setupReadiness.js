import {
  aiStudioError
} from "./core.js";

const SETUP_STAGES = Object.freeze([
  {
    id: "studio-setup",
    label: "Studio Setup",
    serviceName: "studioSetupService"
  },
  {
    id: "adapter-setup",
    label: "Adapter Setup",
    serviceName: "adapterSetupService"
  },
  {
    id: "project-setup",
    label: "Project Setup",
    serviceName: "projectSetupService"
  }
]);

function stageNotReadyMessage(stage, status = {}) {
  return status.blockedReason || `${stage.label} is not ready.`;
}

function missingServiceMessage(stage) {
  return `${stage.label} service is not available.`;
}

async function readSetupStageStatus(stage, services = {}) {
  const service = services[stage.serviceName];
  if (!service || typeof service.getStatus !== "function") {
    return {
      id: stage.id,
      label: stage.label,
      ready: false,
      blockedReason: missingServiceMessage(stage)
    };
  }

  return {
    id: stage.id,
    label: stage.label,
    ...await service.getStatus()
  };
}

async function readAiStudioSetupReadiness(services = {}) {
  const stages = [];

  for (const stage of SETUP_STAGES) {
    const status = await readSetupStageStatus(stage, services);
    stages.push(status);
    if (status.ready !== true) {
      return {
        currentStage: {
          id: stage.id,
          label: stage.label
        },
        message: stageNotReadyMessage(stage, status),
        ready: false,
        stages
      };
    }
  }

  return {
    currentStage: null,
    message: "",
    ready: true,
    stages
  };
}

async function assertAiStudioSetupReady(services = {}) {
  const readiness = await readAiStudioSetupReadiness(services);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = aiStudioError(readiness.message, "ai_studio_setup_not_ready");
  error.setup = readiness;
  throw error;
}

export {
  SETUP_STAGES,
  assertAiStudioSetupReady,
  readAiStudioSetupReadiness
};
