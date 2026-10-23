import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  ENV_USER_VALUE_SOURCE
} from "@local/vibe64-core/server/envUserValues";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  SAVED_ENV_VALUE_SOURCE,
  assertSavedEnvValueProvider
} from "@local/vibe64-project/server/savedEnvValues";
import {
  normalizeRuntimeConfigKey,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  agentEnvWrapperSource
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  closeUnixJsonCommandServer,
  closeUnixJsonCommandServersForSession,
  listenUnixJsonCommandServer,
  readJsonCommandRequest,
  reportUnixCommandControlChange,
  removeDeadUnixJsonCommandSocket,
  sendJsonCommandResponse,
  shortCommandHash,
  unixCommandSocketPath,
  unixJsonCommandServerIsHealthy
} from "./unixJsonCommand.js";

const AGENT_ENV_COMMAND_NAME = "vibe64-env";
const AGENT_ENV_COMMAND_SOCKET_NAME = "env-command.sock";
const AGENT_ENV_COMMAND_CONTRACT_VERSION = "1";
const AGENT_ENV_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_ENV_COMMAND_GENERATION_ENV = "VIBE64_AGENT_ENV_COMMAND_GENERATION";
const VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_ENV_COMMAND_SESSION_ID";
const VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV = "VIBE64_AGENT_ENV_COMMAND_SOCKET";
const VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV = "VIBE64_AGENT_ENV_COMMAND_TOKEN";
const ENV_SCOPE_DEVELOPMENT = "development";
const ENV_SCOPE_PRODUCTION = "production";
const ENV_SCOPE_ALL = "all";

const commandServers = new Map();
const commandServerPrepares = new Map();

function normalizedProjectContextRoot(project = {}) {
  const root = normalizeText(project?.projectRoot || project?.path);
  return root ? path.resolve(root) : "";
}

function commandWrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_ENV_COMMAND_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_ENV_COMMAND_SOCKET_NAME));
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-helper env status [development|production|all] [--json]",
    "  <value on stdin> | vibe64-helper env set <development|production> <KEY> [--secret] [--json]",
    "  vibe64-helper env remove <development|production> <KEY> [--json]",
    "  vibe64-helper env saved [--json]",
    "  vibe64-helper env link <development|production> <KEY> <saved-id> <field-id> [--json]",
    "  vibe64-helper env unlink <development|production> <KEY> [--json]",
    "",
    "Values are accepted only on stdin and are never printed by this command.",
    "Zero-length stdin stores an empty value; whitespace is preserved as an exact value.",
    "Development and production are separate scopes; this command never copies values between them.",
    "--secret marks the value as a secret, which Env keeps hidden. A key that is already secret stays secret, and keys",
    "whose names look secret (KEY, SECRET, TOKEN, PASSWORD, ...) become secrets automatically.",
    "Generated secrets (for example an application key): produce the value with the framework's own generator and pipe",
    "it to env set <scope> <KEY> --secret. Never write it into the generated .env; Vibe64 regenerates that file from Env.",
    "When the host offers saved values, env saved lists their names, descriptions and fields (* marks a secret), never",
    "their values. env link fills the variable the application already reads from one field of a saved value; a linked",
    "row is not editable, and env unlink returns it to an ordinary empty row."
  ].join("\n") + "\n";
}

function responseError(message = "", code = "vibe64_agent_env_command_failed", {
  exitCode = 1,
  usage = false
} = {}) {
  return {
    code,
    error: message,
    exitCode,
    ok: false,
    stderr: `${message}\n${usage ? `\n${usageText()}` : ""}`
  };
}

function assertOperationResult(result = {}, fallback = "Vibe64 Env operation failed.") {
  if (result?.ok === false) {
    throw vibe64Error(
      normalizeText(result.error || result.errors?.[0]?.message) || fallback,
      normalizeText(result.code || result.errors?.[0]?.code) || "vibe64_agent_env_command_failed"
    );
  }
  return result;
}

function normalizeScope(value = "", {
  allowAll = false
} = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (["dev", ENV_SCOPE_DEVELOPMENT].includes(normalized)) {
    return ENV_SCOPE_DEVELOPMENT;
  }
  if (["prod", ENV_SCOPE_PRODUCTION].includes(normalized)) {
    return ENV_SCOPE_PRODUCTION;
  }
  if (allowAll && (!normalized || normalized === ENV_SCOPE_ALL)) {
    return ENV_SCOPE_ALL;
  }
  return "";
}

function parseCommandArgs(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg || "")) : [];
  const flags = values.filter((arg) => arg.startsWith("-"));
  const unsupportedFlags = flags.filter((flag) => !["--help", "-h", "--json", "--secret"].includes(flag));
  const positionals = values.filter((arg) => !arg.startsWith("-"));
  const command = normalizeText(positionals[0]).toLowerCase();
  const help = flags.includes("--help") || flags.includes("-h") || command === "help";
  const scope = normalizeScope(positionals[1], {
    allowAll: command === "status"
  });
  return {
    command,
    entryId: normalizeText(positionals[3]),
    fieldId: normalizeText(positionals[4]),
    help,
    json: flags.includes("--json"),
    key: normalizeText(positionals[2]),
    positionals,
    scope,
    secret: flags.includes("--secret"),
    unsupportedFlags
  };
}

function syntaxFailure(message = "Invalid Vibe64 Env command.") {
  return responseError(message, "vibe64_agent_env_command_usage", {
    exitCode: 2,
    usage: true
  });
}

function validateParsedCommand(parsed = {}) {
  if (parsed.unsupportedFlags.length > 0) {
    return syntaxFailure(`Unsupported option: ${parsed.unsupportedFlags[0]}`);
  }
  if (!parsed.command || parsed.help) {
    return {
      exitCode: 0,
      ok: true,
      stdout: usageText()
    };
  }
  if (parsed.command === "status") {
    if (!parsed.scope || parsed.positionals.length > 2 || parsed.secret) {
      return syntaxFailure("Status accepts only an optional development, production, or all scope.");
    }
    return null;
  }
  if (parsed.command === "saved") {
    if (parsed.positionals.length !== 1 || parsed.secret) {
      return syntaxFailure("saved accepts no arguments.");
    }
    return null;
  }
  if (!["set", "remove", "link", "unlink"].includes(parsed.command)) {
    return syntaxFailure(`Unknown Vibe64 Env command: ${parsed.command}`);
  }
  if (![ENV_SCOPE_DEVELOPMENT, ENV_SCOPE_PRODUCTION].includes(parsed.scope)) {
    return syntaxFailure(`${parsed.command} requires an explicit development or production scope.`);
  }
  if (parsed.command === "link") {
    if (!parsed.key || !parsed.entryId || !parsed.fieldId || parsed.positionals.length !== 5) {
      return syntaxFailure("link requires a variable name, a saved value id and a field id.");
    }
  } else if (!parsed.key || parsed.positionals.length !== 3) {
    return syntaxFailure(`${parsed.command} requires exactly one environment variable name.`);
  }
  if (parsed.command !== "set" && parsed.secret) {
    return syntaxFailure("--secret is valid only when setting a value.");
  }
  return null;
}

function recordIsLinked(record = null) {
  return normalizeText(record?.source) === SAVED_ENV_VALUE_SOURCE;
}

function statusRecord(record = {}, scope = "", isUserValueRecord = () => false) {
  const configured = record?.valuePresent === true;
  const stored = isUserValueRecord(record) === true;
  const linked = recordIsLinked(record);
  return {
    configured,
    editable: record?.editable === true,
    key: normalizeText(record?.key),
    ...(linked ? { label: normalizeText(record?.label), linked: true } : {}),
    missing: record?.missing === true || record?.valuePresent !== true,
    owner: normalizeText(record?.owner),
    requiredFor: Array.isArray(record?.requiredFor) ? record.requiredFor.map(normalizeText).filter(Boolean) : [],
    scope,
    secret: record?.secret === true,
    source: normalizeText(record?.source),
    state: linked ? "linked" : configured ? "configured" : stored ? "empty" : "missing",
    stored
  };
}

function sortedStatusRecords(records = [], scope = "", isUserValueRecord = () => false) {
  return (Array.isArray(records) ? records : [])
    .map((record) => statusRecord(record, scope, isUserValueRecord))
    .filter((record) => record.key)
    .sort((left, right) => left.key.localeCompare(right.key));
}

function scopeStatus(scope = "", records = [], isUserValueRecord = () => false) {
  return {
    available: true,
    records: sortedStatusRecords(records, scope, isUserValueRecord),
    scope
  };
}

function unavailableProductionStatus() {
  return {
    available: false,
    reason: "Production Env is not available in this Vibe64 installation.",
    records: [],
    scope: ENV_SCOPE_PRODUCTION
  };
}

function humanStatus(statuses = []) {
  const lines = [];
  for (const status of statuses) {
    const label = status.scope === ENV_SCOPE_PRODUCTION ? "Production Env" : "Development Env";
    lines.push(`${label}:`);
    if (status.available !== true) {
      lines.push(`  unavailable — ${status.reason}`);
      continue;
    }
    if (status.records.length === 0) {
      lines.push("  no declared or stored values");
      continue;
    }
    for (const record of status.records) {
      if (record.linked) {
        lines.push(`  ${record.key} — linked${record.label ? ` — ${record.label}` : ""}`);
        continue;
      }
      const details = [
        record.state,
        record.secret ? "secret" : "plain",
        record.editable ? "editable" : "managed",
        record.requiredFor.length > 0 ? `required for ${record.requiredFor.join(", ")}` : ""
      ].filter(Boolean);
      lines.push(`  ${record.key} — ${details.join(", ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function mutationStdout({
  action = "set",
  changed = false,
  created = false,
  empty = false,
  key = "",
  scope = ""
} = {}) {
  const label = scope === ENV_SCOPE_PRODUCTION ? "production" : "development";
  if (action === "remove") {
    return changed
      ? `Removed ${label} Env ${key}.\nStored Env state remains outside Git.\n`
      : `${label[0].toUpperCase()}${label.slice(1)} Env ${key} was not stored; no change.\n`;
  }
  const emptyLabel = empty ? " with an empty value" : "";
  return `${created ? "Created" : "Updated"} ${label} Env ${key}${emptyLabel}.\nStored by Vibe64 outside Git; the value was not printed.\n`;
}

function mutationPayload(input = {}, {
  json = false
} = {}) {
  const payload = {
    action: input.action,
    changed: input.changed === true,
    key: input.key,
    ok: true,
    scope: input.scope,
    storedOutsideGit: true,
    ...(input.action === "set" ? {
      created: input.created === true,
      empty: input.empty === true,
      secret: input.secret === true
    } : {})
  };
  return {
    ...payload,
    exitCode: 0,
    stdout: json
      ? `${JSON.stringify(payload, null, 2)}\n`
      : mutationStdout(payload)
  };
}

function recordForKey(records = [], key = "") {
  return (Array.isArray(records) ? records : []).find((record) => normalizeText(record?.key) === key) || null;
}

function assertRecordEditable(record = null, scope = "", key = "") {
  if (!record || record.editable === true && normalizeText(record.owner) !== "system") {
    return;
  }
  if (recordIsLinked(record)) {
    throw vibe64Error(
      `${key} is linked to a saved value. Unlink it before entering a value here.`,
      "vibe64_env_value_linked"
    );
  }
  const label = scope === ENV_SCOPE_PRODUCTION ? "Production" : "Development";
  throw vibe64Error(
    `${label} Env ${key} is managed by ${normalizeText(record.source) || "Vibe64"} and cannot be changed as a user value.`,
    "vibe64_agent_env_command_managed_value"
  );
}

function commandServerToken({
  sessionId = "",
  socketPath = "",
  wrapperHostDir = ""
} = {}) {
  return shortCommandHash([
    "agent-env-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(wrapperHostDir)
  ].join("\n"));
}

function verifyRequestToken(input = {}, expectedToken = "") {
  return normalizeText(input.token) && normalizeText(input.token) === normalizeText(expectedToken);
}

async function readRequestJson(request) {
  return readJsonCommandRequest(request, {
    invalidJsonError: {
      code: "vibe64_agent_env_command_invalid_json",
      message: "Vibe64 Env command input must be valid JSON."
    },
    maxBytes: AGENT_ENV_COMMAND_REQUEST_MAX_BYTES,
    tooLargeError: {
      code: "vibe64_agent_env_command_input_too_large",
      message: "Vibe64 Env command input is too large."
    }
  });
}

async function closeAgentEnvCommandServersForSession(sessionId = "") {
  await Promise.all([...commandServerPrepares.values()].map((preparation) => (
    preparation.catch(() => null)
  )));
  return closeUnixJsonCommandServersForSession(commandServers, sessionId);
}

async function ensureAgentEnvCommandServer({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  const pending = commandServerPrepares.get(socketPath);
  if (pending) {
    await pending.catch(() => null);
    return ensureAgentEnvCommandServer({
      commandService,
      sessionId,
      wrapperHostDir
    });
  }
  const preparation = ensureAgentEnvCommandServerUnlocked({
    commandService,
    sessionId,
    wrapperHostDir
  });
  commandServerPrepares.set(socketPath, preparation);
  try {
    return await preparation;
  } finally {
    if (commandServerPrepares.get(socketPath) === preparation) {
      commandServerPrepares.delete(socketPath);
    }
  }
}

async function ensureAgentEnvCommandServerUnlocked({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  let existing = commandServers.get(socketPath);
  if (existing?.promise) {
    await existing.promise.catch(() => null);
    existing = commandServers.get(socketPath);
  }
  if (
    existing?.commandService === commandService &&
    await unixJsonCommandServerIsHealthy(existing, {
      healthPath: "/agent-env-command/health",
      sessionId,
      socketPath
    })
  ) {
    return existing;
  }
  await closeUnixJsonCommandServer(commandServers, socketPath, existing);
  const promise = (async () => {
    await mkdir(path.dirname(socketPath), {
      recursive: true
    });
    await removeDeadUnixJsonCommandSocket(socketPath, {
      healthPath: "/agent-env-command/health",
      ownerErrorMessage: "The managed Env socket is owned by an unverified listener."
    });
    const token = commandServerToken({
      sessionId,
      socketPath,
      wrapperHostDir
    });
    const generationId = randomUUID();
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method !== "POST" || ![
          "/agent-env-command/health",
          "/agent-env-command/run"
        ].includes(request.url)) {
          sendJsonCommandResponse(response, 404, responseError(
            "Unknown Vibe64 Env command route.",
            "vibe64_agent_env_command_route_not_found"
          ));
          return;
        }
        const input = await readRequestJson(request);
        if (
          !verifyRequestToken(input, token) ||
          normalizeText(input.sessionId) !== normalizeText(sessionId) ||
          normalizeText(input.generationId) !== generationId
        ) {
          if (verifyRequestToken(input, token) && normalizeText(input.sessionId) === normalizeText(sessionId)) {
            reportUnixCommandControlChange({ commandService, sessionId, socketPath, generationId }, "rejected", normalizeText(input.generationId));
          }
          sendJsonCommandResponse(response, 409, responseError(
            "Managed Env control generation is no longer current. Reconnect the assistant.",
            "vibe64_agent_control_unavailable"
          ));
          return;
        }
        if (request.url === "/agent-env-command/health") {
          sendJsonCommandResponse(response, 200, {
            generationId,
            ok: true,
            sessionId: normalizeText(sessionId)
          });
          return;
        }
        sendJsonCommandResponse(response, 200, await commandService.run(input));
      } catch (error) {
        const payload = vibe64ErrorResponse(error, {
          fallbackCode: "vibe64_agent_env_command_request_failed",
          fallbackMessage: "Vibe64 Env command request failed."
        });
        sendJsonCommandResponse(response, vibe64StatusCode(payload), {
          ...payload,
          exitCode: 1,
          stderr: `${payload.error}\n`
        });
      }
    });
    await listenUnixJsonCommandServer(server, socketPath);
    const stored = {
      commandService,
      generationId,
      server,
      sessionId: normalizeText(sessionId),
      socketPath,
      token
    };
    commandServers.set(socketPath, stored);
    if (!await unixJsonCommandServerIsHealthy(stored, {
      healthPath: "/agent-env-command/health",
      sessionId,
      socketPath
    })) {
      await closeUnixJsonCommandServer(commandServers, socketPath, stored);
      await rm(socketPath, {
        force: true
      }).catch(() => null);
      const error = new Error("Managed Env control did not pass its ownership health check.");
      error.code = "vibe64_agent_control_unavailable";
      throw error;
    }
    return stored;
  })();
  commandServers.set(socketPath, {
    commandService,
    promise
  });
  try {
    return await promise;
  } catch (error) {
    if (commandServers.get(socketPath)?.promise === promise) {
      commandServers.delete(socketPath);
    }
    throw error;
  }
}

function createAgentEnvCommandService({
  logger = null,
  projectService,
  productionEnvironmentProvider = null
} = {}) {
  if (
    !projectService ||
    typeof projectService.readCurrentProject !== "function" ||
    typeof projectService.readEnv !== "function" ||
    typeof projectService.runInProjectContext !== "function" ||
    typeof projectService.saveEnvUserValues !== "function"
  ) {
    throw new TypeError("createAgentEnvCommandService requires the Vibe64 Project Env API.");
  }

  const sessionProjects = new Map();
  let productionProvider = null;
  let savedValueProvider = null;

  function setSavedEnvValueProvider(provider = null) {
    savedValueProvider = assertSavedEnvValueProvider(provider);
  }

  function setProductionEnvironmentProvider(provider = null) {
    if (
      provider !== null &&
      (!provider ||
        typeof provider.readRecords !== "function" ||
        typeof provider.isUserValueRecord !== "function" ||
        typeof provider.setVariable !== "function" ||
        typeof provider.removeVariable !== "function")
    ) {
      throw new TypeError("Vibe64 production Env provider must expose readRecords(), isUserValueRecord(), setVariable(), and removeVariable(), or be null.");
    }
    productionProvider = provider;
  }

  setProductionEnvironmentProvider(productionEnvironmentProvider);

  async function bindSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw vibe64Error(
        "Vibe64 Env command session id is required.",
        "vibe64_agent_env_command_session_required"
      );
    }
    const project = await projectService.readCurrentProject();
    const projectSlug = normalizeText(project?.slug || project?.name);
    if (!projectSlug) {
      throw vibe64Error(
        "Vibe64 Env command could not bind this session to a project.",
        "vibe64_agent_env_command_project_required"
      );
    }
    // The person whose request prepared this agent; a host's saved values
    // apply that person's permissions.
    const binding = {
      actor: currentProjectRequestContext()?.vibe64User || null,
      projectContextRoot: normalizedProjectContextRoot(project),
      projectSlug
    };
    sessionProjects.set(normalizedSessionId, binding);
    return {
      ok: true,
      projectContextRoot: binding.projectContextRoot,
      projectSlug,
      sessionId: normalizedSessionId
    };
  }

  async function runInSessionProject(sessionId = "", operation) {
    const binding = sessionProjects.get(normalizeText(sessionId));
    if (!binding?.projectSlug) {
      throw vibe64Error(
        "Vibe64 Env command is not bound to this session project.",
        "vibe64_agent_env_command_project_binding_missing"
      );
    }
    return projectService.runInProjectContext(binding.projectSlug, async () => {
      const currentProject = await projectService.readCurrentProject();
      const currentSlug = normalizeText(currentProject?.slug || currentProject?.name);
      const currentProjectContextRoot = normalizedProjectContextRoot(currentProject);
      if (
        currentSlug !== binding.projectSlug ||
        binding.projectContextRoot && currentProjectContextRoot !== binding.projectContextRoot
      ) {
        throw vibe64Error(
          "Vibe64 Env command session project no longer matches its bound project.",
          "vibe64_agent_env_command_project_binding_changed"
        );
      }
      return operation(binding);
    });
  }

  // This command owns agent policy and transport, not persistence. These two
  // delegates are the complete boundary to the services that own each scope.
  const developmentEnvironment = Object.freeze({
    isUserValueRecord(record = null) {
      return normalizeText(record?.source) === ENV_USER_VALUE_SOURCE;
    },
    async readRecords({ sessionId = "" } = {}) {
      const result = assertOperationResult(await projectService.readEnv({
        environment: "dev",
        sessionId
      }), "Development Env could not be read.");
      return Array.isArray(result?.env?.records) ? result.env.records : [];
    },
    async removeVariable({
      key = "",
      sessionId = ""
    } = {}) {
      assertOperationResult(await projectService.saveEnvUserValues({
        environment: "dev",
        sessionId,
        values: {
          [key]: {
            remove: true
          }
        }
      }), `Development Env ${key} could not be removed.`);
    },
    async setVariable({
      key = "",
      secret = false,
      sessionId = "",
      value = ""
    } = {}) {
      assertOperationResult(await projectService.saveEnvUserValues({
        environment: "dev",
        sessionId,
        values: {
          [key]: {
            ...(secret ? { secret: true } : {}),
            value
          }
        }
      }), `Development Env ${key} could not be saved.`);
    }
  });
  // The session binding is the authority for which project an agent may
  // manage. Carry only that validated identity across the host's persistence
  // boundary instead of relying on ambient request context surviving it.
  const productionEnvironment = Object.freeze({
    isUserValueRecord(record = null) {
      return productionProvider.isUserValueRecord(record);
    },
    async readRecords({ projectSlug = "" } = {}) {
      const result = assertOperationResult(
        await productionProvider.readRecords({ projectSlug }),
        "Production Env could not be read."
      );
      return Array.isArray(result?.records) ? result.records : [];
    },
    async removeVariable({
      key = "",
      projectSlug = ""
    } = {}) {
      assertOperationResult(
        await productionProvider.removeVariable({ key, projectSlug }),
        `Production Env ${key} could not be removed.`
      );
    },
    async setVariable({
      key = "",
      projectSlug = "",
      secret = false,
      value = ""
    } = {}) {
      assertOperationResult(
        await productionProvider.setVariable({ key, projectSlug, secret, value }),
        `Production Env ${key} could not be saved.`
      );
    }
  });

  function environmentForScope(scope = "") {
    if (scope === ENV_SCOPE_DEVELOPMENT) {
      return developmentEnvironment;
    }
    return productionProvider ? productionEnvironment : null;
  }

  async function statusResult(parsed = {}, sessionId = "", projectSlug = "") {
    const scopes = parsed.scope === ENV_SCOPE_ALL
      ? [ENV_SCOPE_DEVELOPMENT, ENV_SCOPE_PRODUCTION]
      : [parsed.scope];
    const statuses = [];
    for (const scope of scopes) {
      const environment = environmentForScope(scope);
      if (!environment) {
        statuses.push(unavailableProductionStatus());
        continue;
      }
      statuses.push(scopeStatus(
        scope,
        await environment.readRecords({ projectSlug, sessionId }),
        environment.isUserValueRecord
      ));
    }
    if (parsed.scope === ENV_SCOPE_PRODUCTION && statuses[0]?.available === false) {
      return responseError(
        statuses[0].reason,
        "vibe64_agent_env_command_production_unavailable"
      );
    }
    const payload = {
      ok: true,
      scopes: Object.fromEntries(statuses.map((status) => [status.scope, status]))
    };
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.json
        ? `${JSON.stringify(payload, null, 2)}\n`
        : humanStatus(statuses)
    };
  }

  async function setResult(parsed = {}, sessionId = "", stdin = "", projectSlug = "") {
    const key = normalizeRuntimeConfigKey(parsed.key);
    const environment = environmentForScope(parsed.scope);
    if (!environment) {
      return responseError(
        unavailableProductionStatus().reason,
        "vibe64_agent_env_command_production_unavailable"
      );
    }
    const previousRecords = await environment.readRecords({ projectSlug, sessionId });
    const previous = recordForKey(previousRecords, key);
    assertRecordEditable(previous, parsed.scope, key);
    const secret = parsed.secret || previous?.secret === true || runtimeConfigKeyLooksSecret(key);
    await environment.setVariable({
      key,
      projectSlug,
      secret,
      sessionId,
      value: stdin
    });
    return mutationPayload({
      action: "set",
      changed: true,
      created: !environment.isUserValueRecord(previous),
      empty: stdin.length === 0,
      key,
      scope: parsed.scope,
      secret
    }, parsed);
  }

  async function removeResult(parsed = {}, sessionId = "", projectSlug = "") {
    const key = normalizeRuntimeConfigKey(parsed.key);
    const environment = environmentForScope(parsed.scope);
    if (!environment) {
      return responseError(
        unavailableProductionStatus().reason,
        "vibe64_agent_env_command_production_unavailable"
      );
    }
    const previousRecords = await environment.readRecords({ projectSlug, sessionId });
    const previous = recordForKey(previousRecords, key);
    assertRecordEditable(previous, parsed.scope, key);
    const stored = environment.isUserValueRecord(previous);
    if (stored) {
      await environment.removeVariable({ key, projectSlug, sessionId });
    }
    return mutationPayload({
      action: "remove",
      changed: stored,
      created: false,
      key,
      scope: parsed.scope
    }, parsed);
  }

  function savedValueRequest(binding = {}, sessionId = "") {
    return {
      actor: binding.actor || null,
      projectSlug: normalizeText(binding.projectSlug),
      sessionId
    };
  }

  async function savedResult(parsed = {}, sessionId = "", binding = {}) {
    const result = savedValueProvider ? assertOperationResult(
      await savedValueProvider.list(savedValueRequest(binding, sessionId)),
      "Saved values could not be read."
    ) : null;
    const entries = (Array.isArray(result?.entries) ? result.entries : []).map((entry) => ({
      description: normalizeText(entry?.description),
      environments: Array.isArray(entry?.environments) ? entry.environments.map(normalizeText).filter(Boolean) : [],
      fields: (Array.isArray(entry?.fields) ? entry.fields : []).map((field) => ({
        id: normalizeText(field?.id),
        label: normalizeText(field?.label),
        secret: field?.secret === true
      })).filter((field) => field.id),
      id: normalizeText(entry?.id),
      label: normalizeText(entry?.label)
    })).filter((entry) => entry.id);
    const payload = { entries, ok: true, ...(savedValueProvider ? { provider: savedValueProvider.label } : {}) };
    const lines = !savedValueProvider
      ? ["This workspace offers no saved values."]
      : entries.length === 0
        ? [`${savedValueProvider.label} has nothing you can use here yet.`]
        : entries.map((entry) => `${entry.id} ${entry.label}${entry.description ? ` — ${entry.description}` : ""}` +
            ` (fields: ${entry.fields.map((field) => `${field.id}${field.secret ? "*" : ""}`).join(", ")})`);
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.json ? `${JSON.stringify(payload, null, 2)}\n` : `${lines.join("\n")}\n`
    };
  }

  async function linkResult(parsed = {}, sessionId = "", binding = {}) {
    const key = normalizeRuntimeConfigKey(parsed.key);
    if (!savedValueProvider) {
      return responseError("This workspace offers no saved values.", "vibe64_saved_env_values_unavailable");
    }
    const request = { ...savedValueRequest(binding, sessionId), environment: parsed.scope, key };
    const linking = parsed.command === "link";
    assertOperationResult(
      linking
        ? await savedValueProvider.link({ ...request, entryId: parsed.entryId, fieldId: parsed.fieldId })
        : await savedValueProvider.unlink(request),
      `${key} could not be ${linking ? "linked" : "unlinked"}.`
    );
    const label = parsed.scope === ENV_SCOPE_PRODUCTION ? "production" : "development";
    const payload = { action: parsed.command, key, ok: true, scope: parsed.scope };
    return {
      ...payload,
      exitCode: 0,
      stdout: parsed.json
        ? `${JSON.stringify(payload, null, 2)}\n`
        : linking
          ? `Linked ${label} Env ${key} to ${parsed.entryId} (${parsed.fieldId}).\nThe value was not printed.\n`
          : `Unlinked ${label} Env ${key}; it is now an ordinary empty row.\n`
    };
  }

  async function execute(parsed = {}, input = {}, binding = {}) {
    const projectSlug = normalizeText(binding.projectSlug);
    if (parsed.command === "status") {
      return statusResult(parsed, normalizeText(input.sessionId), projectSlug);
    }
    if (parsed.command === "saved") {
      return savedResult(parsed, normalizeText(input.sessionId), binding);
    }
    if (parsed.command === "link" || parsed.command === "unlink") {
      return linkResult(parsed, normalizeText(input.sessionId), binding);
    }
    if (parsed.command === "set") {
      return setResult(parsed, normalizeText(input.sessionId), String(input.stdin ?? ""), projectSlug);
    }
    return removeResult(parsed, normalizeText(input.sessionId), projectSlug);
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parseCommandArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    let result;
    try {
      const validation = validateParsedCommand(parsed);
      result = validation || await runInSessionProject(
        sessionId,
        (binding) => execute(parsed, input, binding)
      );
    } catch (error) {
      const payload = vibe64ErrorResponse(error, {
        fallbackCode: "vibe64_agent_env_command_failed",
        fallbackMessage: "Vibe64 Env command failed."
      });
      result = {
        ...payload,
        exitCode: 1,
        stderr: `${payload.error}\n`
      };
    }
    logOperationalEvent(logger, result?.ok === false ? "warn" : "info", {
      code: normalizeText(result?.code),
      command: parsed.command,
      component: "vibe64.agent_env_command",
      durationMs: Date.now() - startedAtMs,
      event: "vibe64.agent_env_command.finished",
      exitCode: Number(result?.exitCode ?? (result?.ok === false ? 1 : 0)),
      key: parsed.key,
      ok: result?.ok !== false,
      scope: parsed.scope,
      sessionId
    }, "Vibe64 agent Env command finished.");
    return result;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const bound = sessionProjects.delete(normalizedSessionId);
    const closed = await closeAgentEnvCommandServersForSession(normalizedSessionId);
    return {
      closed: closed + (bound && closed === 0 ? 1 : 0),
      ok: true
    };
  }

  return Object.freeze({
    logger,
    bindSession,
    closeAllForSession,
    run,
    setProductionEnvironmentProvider,
    setSavedEnvValueProvider
  });
}

async function prepareAgentEnvCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  await commandService.bindSession(normalizedSessionId);
  await writeExecutableFileIfChanged(
    commandWrapperHostPath(normalizedWrapperHostDir),
    agentEnvWrapperSource({
      contractVersion: AGENT_ENV_COMMAND_CONTRACT_VERSION
    })
  );
  const server = await ensureAgentEnvCommandServer({
    commandService,
    sessionId: normalizedSessionId,
    wrapperHostDir: normalizedWrapperHostDir
  });
  return {
    controlGenerationId: server.generationId,
    env: {
      [VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV]: AGENT_ENV_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_ENV_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV]: server.token
    },
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: commandWrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_ENV_COMMAND_NAME,
  VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_ENV_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  createAgentEnvCommandService,
  prepareAgentEnvCommand
};
