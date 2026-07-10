import {
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  RUNTIME_CONFIG_OWNERS,
  normalizeRuntimeConfigOwner,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  installCommand
} from "./nodePackage.js";
import {
  normalizeDisposablePaths
} from "./disposablePaths.js";

const PUBLISH_RELEASE_PORT_ENV = "${PORT:-4100}";
const RELATIONAL_DATABASE_REQUIREMENT_KIND = "relational-database";

function deploymentCommand(input = null) {
  if (!input || typeof input !== "object" || !normalizeText(input.command)) {
    return null;
  }
  return {
    command: normalizeText(input.command),
    label: normalizeText(input.label),
    networkEnv: input.networkEnv === true,
    required: input.required !== false,
    runtimes: normalizeDeploymentRuntimes(input.runtimes)
  };
}

function normalizeDeploymentRuntimes(runtimes = []) {
  const seen = new Set();
  const result = [];
  for (const runtime of Array.isArray(runtimes) ? runtimes : []) {
    const normalized = normalizeText(runtime);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
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
    disposablePaths: normalizeDisposablePaths(artifacts.disposablePaths),
    kind: normalizeText(artifacts.kind || "runtime"),
    path: normalizeText(artifacts.path)
  };
}

function deploymentRequirements(input = undefined) {
  if (input === undefined || input === null) {
    return [];
  }
  if (!Array.isArray(input)) {
    throw vibe64Error(
      "Deployment plan requirements must be an array.",
      "vibe64_deployment_requirements_invalid"
    );
  }
  const requirements = input.map(deploymentRequirement);
  const ids = new Set();
  for (const requirement of requirements) {
    if (ids.has(requirement.id)) {
      throw vibe64Error(
        `Deployment requirement id is duplicated: ${requirement.id}.`,
        "vibe64_deployment_requirement_duplicate"
      );
    }
    ids.add(requirement.id);
  }
  return requirements;
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
    requirements: deploymentRequirements(input.requirements),
    serve: deploymentCommand(input.serve),
    unsupportedReason: normalizeText(input.unsupportedReason)
  };
}

function deploymentRequirement(input = null) {
  if (!isPlainObject(input)) {
    throw vibe64Error(
      "Deployment requirements must be objects.",
      "vibe64_deployment_requirement_invalid"
    );
  }
  const id = normalizeText(input.id);
  const kind = normalizeText(input.kind);
  const provider = normalizeText(input.provider);
  if (!id || !kind || !provider) {
    throw vibe64Error(
      "Deployment requirements require id, kind, and provider.",
      "vibe64_deployment_requirement_identity_required"
    );
  }
  if (input.config !== undefined && !isPlainObject(input.config)) {
    throw vibe64Error(
      `Deployment requirement ${id} config must be an object.`,
      "vibe64_deployment_requirement_config_invalid"
    );
  }
  return {
    config: isPlainObject(input.config) ? structuredClone(input.config) : {},
    id,
    kind,
    provider
  };
}

function relationalDatabaseDeploymentRequirement({
  databaseName = "",
  id = "database",
  provider = ""
} = {}) {
  return deploymentRequirement({
    config: {
      databaseName: normalizeText(databaseName)
    },
    id,
    kind: RELATIONAL_DATABASE_REQUIREMENT_KIND,
    provider
  });
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
  buildRuntimes = [],
  health = {},
  messageReady = "",
  messageServeMissing = "",
  migrateCommand = "",
  migrateLabel = "",
  migrateRuntimes = [],
  prepareCommand = "",
  prepareLabel = "",
  prepareRuntimes = [],
  requirements = [],
  serveCommand = "",
  serveLabel = "",
  serveRuntimes = []
} = {}) {
  const normalizedServeCommand = normalizeText(serveCommand);
  return deploymentPublishPlan({
    adapterId,
    artifacts,
    build: normalizeText(buildCommand)
      ? {
          command: buildCommand,
          label: buildLabel,
          networkEnv: false,
          runtimes: buildRuntimes
        }
      : null,
    health,
    message: normalizedServeCommand ? messageReady : messageServeMissing,
    migrate: normalizeText(migrateCommand)
      ? {
          command: migrateCommand,
          label: migrateLabel,
          networkEnv: true,
          runtimes: migrateRuntimes
        }
      : null,
    ok: Boolean(normalizedServeCommand),
    prepare: normalizeText(prepareCommand)
      ? {
          command: prepareCommand,
          label: prepareLabel,
          networkEnv: true,
          runtimes: prepareRuntimes
        }
      : null,
    requirements,
    serve: normalizedServeCommand
      ? {
          command: normalizedServeCommand,
          label: serveLabel,
          networkEnv: true,
          runtimes: serveRuntimes
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
  requirements = [],
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
    requirements,
    serveCommand: metadata.serverCommand || metadata.testrunCommand,
    serveLabel
  });
}

function deploymentEnvironmentEntry(input = {}) {
  return {
    group: normalizeText(input.group || "custom"),
    groupLabel: normalizeText(input.groupLabel),
    name: normalizeText(input.name),
    owner: normalizeRuntimeConfigOwner(input.owner || RUNTIME_CONFIG_OWNERS.ADAPTER),
    requiredFor: Array.isArray(input.requiredFor) ? input.requiredFor : [],
    sensitive: input.sensitive === true,
    source: normalizeText(input.source || "adapter"),
    sourceLabel: normalizeText(input.sourceLabel || "Adapter"),
    value: String(input.value ?? ""),
    ...(input.valuePresent === undefined ? {} : {
      valuePresent: input.valuePresent === true
    })
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
    owner: RUNTIME_CONFIG_OWNERS.VIBE64,
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
      .filter((service) => service.id && service.label)
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
  RELATIONAL_DATABASE_REQUIREMENT_KIND,
  deploymentDatabaseNotRequiredService,
  deploymentAppEnvironmentEntry,
  deploymentEnvironmentEntry,
  deploymentEnvironmentResult,
  deploymentManagedDatabaseService,
  deploymentPublishPlan,
  deploymentPublishPlanFromCommands,
  deploymentPublishPlanFromLaunchDescriptor,
  deploymentService,
  relationalDatabaseDeploymentRequirement,
  managedDatabaseEnvironmentEntry,
  publishRootMissingPlan,
  unsupportedDeploymentPublishPlan
};
