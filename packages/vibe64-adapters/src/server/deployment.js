import {
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  installCommand
} from "./nodePackage.js";

const PUBLISH_RELEASE_PORT_ENV = "${PORT:-4100}";

function deploymentCommand(input = null) {
  if (!input || typeof input !== "object" || !normalizeText(input.command)) {
    return null;
  }
  return {
    command: normalizeText(input.command),
    label: normalizeText(input.label),
    networkEnv: input.networkEnv === true,
    required: input.required !== false
  };
}

function deploymentHealth(input = {}) {
  return {
    path: normalizeText(input.path || "/") || "/",
    timeoutMs: Number.isInteger(input.timeoutMs) && input.timeoutMs > 0 ? input.timeoutMs : 30000,
    type: normalizeText(input.type || "http")
  };
}

function deploymentArtifacts(input = {}) {
  const artifacts = isPlainObject(input) ? input : {};
  return {
    kind: normalizeText(artifacts.kind || "runtime"),
    path: normalizeText(artifacts.path)
  };
}

function deploymentPublishPlan(input = {}) {
  return {
    adapterId: normalizeText(input.adapterId),
    artifacts: deploymentArtifacts(input.artifacts),
    build: deploymentCommand(input.build),
    health: deploymentHealth(input.health),
    message: normalizeText(input.message),
    migrate: deploymentCommand(input.migrate),
    ok: input.ok !== false,
    prepare: deploymentCommand(input.prepare),
    runtimeServices: Array.isArray(input.runtimeServices) ? input.runtimeServices.filter(Boolean) : [],
    serve: deploymentCommand(input.serve),
    unsupportedReason: normalizeText(input.unsupportedReason)
  };
}

function unsupportedDeploymentPublishPlan({
  adapterId = "",
  label = ""
} = {}) {
  const adapterLabel = normalizeText(label || adapterId || "Selected adapter");
  return deploymentPublishPlan({
    adapterId,
    message: `${adapterLabel} does not provide a publish plan.`,
    ok: false,
    unsupportedReason: "adapter_publish_not_supported"
  });
}

function publishRootMissingPlan({
  adapterId = "",
  label = ""
} = {}) {
  const adapterLabel = normalizeText(label || adapterId || "project");
  return deploymentPublishPlan({
    adapterId,
    message: `Choose a ${adapterLabel} project before publishing.`,
    ok: false,
    unsupportedReason: "target_root_missing"
  });
}

function deploymentPublishPlanFromCommands({
  adapterId = "",
  artifacts = {},
  buildCommand = "",
  buildLabel = "",
  health = {},
  messageReady = "",
  messageServeMissing = "",
  migrateCommand = "",
  migrateLabel = "",
  prepareCommand = "",
  prepareLabel = "",
  runtimeServices = [],
  serveCommand = "",
  serveLabel = ""
} = {}) {
  const normalizedServeCommand = normalizeText(serveCommand);
  return deploymentPublishPlan({
    adapterId,
    artifacts,
    build: normalizeText(buildCommand)
      ? {
          command: buildCommand,
          label: buildLabel,
          networkEnv: false
        }
      : null,
    health,
    message: normalizedServeCommand ? messageReady : messageServeMissing,
    migrate: normalizeText(migrateCommand)
      ? {
          command: migrateCommand,
          label: migrateLabel,
          networkEnv: true
        }
      : null,
    ok: Boolean(normalizedServeCommand),
    prepare: normalizeText(prepareCommand)
      ? {
          command: prepareCommand,
          label: prepareLabel,
          networkEnv: true
        }
      : null,
    runtimeServices,
    serve: normalizedServeCommand
      ? {
          command: normalizedServeCommand,
          label: serveLabel,
          networkEnv: true
        }
      : null,
    unsupportedReason: normalizedServeCommand ? "" : "serve_command_missing"
  });
}

function launchDescriptorMetadata(descriptor = {}) {
  return isPlainObject(descriptor?.metadata) ? descriptor.metadata : {};
}

function deploymentPublishPlanFromLaunchDescriptor({
  adapterId = "",
  artifacts = {},
  buildLabel = "",
  descriptor = {},
  messageReady = "",
  messageServeMissing = "",
  migrateCommand = "",
  migrateLabel = "",
  prepareLabel = "Install project dependencies.",
  runtimeServices = [],
  serveLabel = ""
} = {}) {
  const metadata = launchDescriptorMetadata(descriptor);
  const packageManager = normalizeText(metadata.packageManager);
  return deploymentPublishPlanFromCommands({
    adapterId,
    artifacts,
    buildCommand: metadata.buildCommand,
    buildLabel,
    messageReady,
    messageServeMissing,
    migrateCommand,
    migrateLabel,
    prepareCommand: packageManager ? installCommand(packageManager) : "",
    prepareLabel,
    runtimeServices,
    serveCommand: metadata.serverCommand || metadata.testrunCommand,
    serveLabel
  });
}

function deploymentEnvironmentEntry(input = {}) {
  return {
    group: normalizeText(input.group || "custom"),
    groupLabel: normalizeText(input.groupLabel),
    name: normalizeText(input.name),
    sensitive: input.sensitive === true,
    source: normalizeText(input.source || "adapter"),
    sourceLabel: normalizeText(input.sourceLabel || "Adapter"),
    value: String(input.value ?? "")
  };
}

function deploymentAppEnvironmentEntry(input = {}) {
  const entry = deploymentEnvironmentEntry(input);
  if (entry.name && runtimeConfigKeyIsVibe64Reserved(entry.name)) {
    throw new Error(`${entry.name} is reserved for Vibe64 control or tooling state and cannot be emitted as app Env.`);
  }
  return entry;
}

function managedDatabaseEnvironmentEntry({
  name = "",
  value = ""
} = {}) {
  return deploymentAppEnvironmentEntry({
    group: "database",
    name,
    sensitive: runtimeConfigKeyLooksSecret(name),
    source: "managed_database",
    sourceLabel: "Production database",
    value
  });
}

function deploymentService(input = {}) {
  return {
    detail: normalizeText(input.detail),
    id: normalizeText(input.id),
    label: normalizeText(input.label),
    status: normalizeText(input.status)
  };
}

function deploymentEnvironmentResult(input = {}) {
  return {
    appEntries: (Array.isArray(input.appEntries) ? input.appEntries : [])
      .map(deploymentAppEnvironmentEntry)
      .filter((entry) => entry.name),
    blockers: Array.isArray(input.blockers) ? input.blockers : [],
    controlEnv: normalizeDeploymentEnvObject(input.controlEnv),
    services: (Array.isArray(input.services) ? input.services : [])
      .map(deploymentService)
      .filter((service) => service.id && service.label),
    toolingEnv: normalizeDeploymentEnvObject(input.toolingEnv)
  };
}

function normalizeDeploymentEnvObject(env = {}) {
  return Object.fromEntries(Object.entries(env && typeof env === "object" && !Array.isArray(env) ? env : {})
    .map(([key, value]) => [normalizeText(key), String(value ?? "")])
    .filter(([key]) => key));
}

function deploymentDatabaseNotRequiredService() {
  return deploymentService({
    detail: "This project does not request a managed production database.",
    id: "database",
    label: "Production database",
    status: "not_required"
  });
}

function deploymentManagedDatabaseService({
  runtimeLabel = "managed"
} = {}) {
  return deploymentService({
    detail: `Publish uses a production ${runtimeLabel} database separate from local development.`,
    id: "database",
    label: "Production database",
    status: "ready"
  });
}

export {
  PUBLISH_RELEASE_PORT_ENV,
  deploymentDatabaseNotRequiredService,
  deploymentAppEnvironmentEntry,
  deploymentEnvironmentEntry,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlan,
  deploymentPublishPlanFromCommands,
  deploymentPublishPlanFromLaunchDescriptor,
  deploymentService,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan,
  unsupportedDeploymentPublishPlan
};
