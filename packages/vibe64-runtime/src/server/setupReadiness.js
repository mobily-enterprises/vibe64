import {
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  runDoctorStep
} from "@local/setup-doctor-core/server/doctorStream";

const SETUP_STAGES = Object.freeze([
  {
    id: "studio-setup",
    label: "Studio Setup",
    serviceName: "studioSetupService"
  },
  {
    id: "accounts",
    label: "Accounts",
    serviceName: "accountSetupService"
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
  const stages = [];

  for (const stage of SETUP_STAGES) {
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

export {
  SETUP_STAGES,
  assertVibe64SetupReady,
  readVibe64SetupReadiness
};
