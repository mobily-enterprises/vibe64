import {
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  runDoctorStep
} from "@local/setup-doctor-core/server/doctorStream";

const CONNECTION_STAGES = Object.freeze([
  {
    id: "accounts",
    label: "Accounts",
    serviceName: "accountSetupService"
  }
]);

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

const WORKSPACE_READINESS_STAGES = Object.freeze([
  ...CONNECTION_STAGES,
  ...SETUP_STAGES
]);

function stageNotReadyMessage(stage, status = {}) {
  return status.blockedReason || `${stage.label} is not ready.`;
}

function missingServiceMessage(stage) {
  return `${stage.label} service is not available.`;
}

async function readSetupStageStatus(stage, services = {}, {
  emit = null
} = {}) {
  const service = services[stage.serviceName];
  const readStatus = async () => {
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
  };

  return emit
    ? runDoctorStep({
      emit,
      id: stage.id,
      label: stage.label,
      run: readStatus
    })
    : readStatus();
}

async function readVibe64SetupReadiness(services = {}, options = {}) {
  return readReadinessStages(SETUP_STAGES, services, options);
}

async function readVibe64WorkspaceReadiness(services = {}, options = {}) {
  return readReadinessStages(WORKSPACE_READINESS_STAGES, services, options);
}

async function readReadinessStages(stagesToRead, services = {}, options = {}) {
  const stages = [];

  for (const stage of stagesToRead) {
    const status = await readSetupStageStatus(stage, services, options);
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

async function assertVibe64SetupReady(services = {}) {
  const readiness = await readVibe64SetupReadiness(services);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = vibe64Error(readiness.message, "vibe64_setup_not_ready");
  error.setup = readiness;
  throw error;
}

async function assertVibe64WorkspaceReady(services = {}) {
  const readiness = await readVibe64WorkspaceReadiness(services);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = vibe64Error(readiness.message, "vibe64_workspace_not_ready");
  error.setup = readiness;
  throw error;
}

export {
  CONNECTION_STAGES,
  SETUP_STAGES,
  WORKSPACE_READINESS_STAGES,
  assertVibe64SetupReady,
  assertVibe64WorkspaceReady,
  readVibe64WorkspaceReadiness,
  readVibe64SetupReadiness
};
