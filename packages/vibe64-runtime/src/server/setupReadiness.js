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
    id: "project-setup",
    label: "Project Setup",
    serviceName: "projectSetupService"
  }
]);

const PROJECT_READINESS_STAGES = Object.freeze([
  ...CONNECTION_STAGES,
  ...SETUP_STAGES
]);

const SESSION_READINESS_STAGES = Object.freeze([
  ...CONNECTION_STAGES,
  {
    id: "studio-setup",
    label: "Studio Setup",
    serviceName: "studioSetupService"
  }
]);

function stageNotReadyMessage(stage, status = {}) {
  return status.blockedReason || nestedStageNotReadyMessage(status) || `${stage.label} is not ready.`;
}

function nestedStageNotReadyMessage(status = {}) {
  const stages = Array.isArray(status.stages) ? status.stages : [];
  const blockedStage = stages.find((item) => !stageCheckPassed(item));
  if (!blockedStage) {
    return "";
  }

  return [
    String(blockedStage.label || blockedStage.id || "Setup check"),
    String(blockedStage.observed || blockedStage.explanation || "")
  ]
    .filter(Boolean)
    .join(": ");
}

function stageCheckPassed(stage = {}) {
  const status = String(stage?.status || "").trim();
  return stage?.ready === true || stage?.ok === true || status === "pass";
}

function missingServiceMessage(stage) {
  return `${stage.label} service is not available.`;
}

async function readSetupStageStatus(stage, services = {}, {
  emit = null,
  input = {}
} = {}) {
  const service = services[stage.serviceName];
  const statusInput = plainObject(input);
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
      ...await service.getStatus(statusInput)
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

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function readVibe64SetupReadiness(services = {}, options = {}) {
  return readReadinessStages(SETUP_STAGES, services, options);
}

async function readVibe64ProjectReadiness(services = {}, options = {}) {
  return readReadinessStages(PROJECT_READINESS_STAGES, services, options);
}

async function readVibe64SessionReadiness(services = {}, options = {}) {
  return readReadinessStages(SESSION_READINESS_STAGES, services, options);
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

async function assertVibe64SetupReady(services = {}, options = {}) {
  const readiness = await readVibe64SetupReadiness(services, options);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = vibe64Error(readiness.message, "vibe64_setup_not_ready");
  error.setup = readiness;
  throw error;
}

async function assertVibe64ProjectReady(services = {}, options = {}) {
  const readiness = await readVibe64ProjectReadiness(services, options);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = vibe64Error(readiness.message, "vibe64_project_not_ready");
  error.setup = readiness;
  throw error;
}

async function assertVibe64SessionReady(services = {}, options = {}) {
  const readiness = await readVibe64SessionReadiness(services, options);
  if (readiness.ready === true) {
    return readiness;
  }

  const error = vibe64Error(readiness.message, "vibe64_session_not_ready");
  error.setup = readiness;
  throw error;
}

export {
  CONNECTION_STAGES,
  SETUP_STAGES,
  PROJECT_READINESS_STAGES,
  SESSION_READINESS_STAGES,
  assertVibe64SetupReady,
  assertVibe64ProjectReady,
  assertVibe64SessionReady,
  readVibe64ProjectReadiness,
  readVibe64SessionReadiness,
  readVibe64SetupReadiness
};
