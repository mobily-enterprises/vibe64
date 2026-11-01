import path from "node:path";

import { normalizeText } from "@local/vibe64-core/server/core";
import {
  ENV_USER_VALUE_SOURCE
} from "@local/vibe64-core/server/envUserValues";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import {
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { offersSavedValues } from "@local/vibe64-project/server/savedEnvValues";
import {
  normalizeRuntimeConfigKey,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  agentEnvWrapperSource
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import { offersProductionEnvironment } from "./productionEnvironment.js";
import {
  createSessionCommandServers,
  unixCommandSocketPath
} from "./unixJsonCommand.js";
import {
  assertOperationResult,
  assertRecordEditable,
  ENV_SCOPE_ALL,
  ENV_SCOPE_DEVELOPMENT,
  ENV_SCOPE_PRODUCTION,
  humanStatus,
  mutationPayload,
  parseCommandArgs,
  recordForKey,
  responseError,
  scopeStatus,
  unavailableProductionStatus,
  validateParsedCommand
} from "./agentEnvCommandText.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("@local/vibe64-project/server/types").SavedEnvValueProvider} SavedEnvValueProvider */

const AGENT_ENV_COMMAND_NAME = "vibe64-env";
const AGENT_ENV_COMMAND_SOCKET_NAME = "env-command.sock";
const AGENT_ENV_COMMAND_CONTRACT_VERSION = "1";
const AGENT_ENV_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_ENV_COMMAND_GENERATION_ENV = "VIBE64_AGENT_ENV_COMMAND_GENERATION";
const VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_ENV_COMMAND_SESSION_ID";
const VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV = "VIBE64_AGENT_ENV_COMMAND_SOCKET";
const VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV = "VIBE64_AGENT_ENV_COMMAND_TOKEN";
function commandWrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_ENV_COMMAND_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_ENV_COMMAND_SOCKET_NAME));
}

const commandServers = createSessionCommandServers({
  routePrefix: "/agent-env-command",
  routes: {
    "/agent-env-command/run": { handle: ({ commandService, input }) => commandService.run(input) }
  },
  label: "Env",
  maxBytes: AGENT_ENV_COMMAND_REQUEST_MAX_BYTES,
  invalidJsonError: { code: "vibe64_agent_env_command_invalid_json", message: "Vibe64 Env command input must be valid JSON." },
  tooLargeError: { code: "vibe64_agent_env_command_input_too_large", message: "Vibe64 Env command input is too large." },
  notFound: responseError("Unknown Vibe64 Env command route.", "vibe64_agent_env_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: responseError("Managed Env control generation is no longer current. Reconnect the assistant.", "vibe64_agent_control_unavailable")
  },
  requestFailure: {
    fallbackCode: "vibe64_agent_env_command_request_failed",
    fallbackMessage: "Vibe64 Env command request failed."
  },
  errorBody: (payload) => ({ ...payload, exitCode: 1, stderr: `${payload.error}\n` })
});

/**
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {ProductionEnvironmentProvider} dependencies.productionEnvironmentProvider a host's production Env values
 * @param {SavedEnvValueProvider} dependencies.savedEnvValueProvider a host's saved values
 */
function createAgentEnvCommandService({
  logger,
  projectService,
  productionEnvironmentProvider,
  savedEnvValueProvider
}) {
  // The person whose request prepared this agent; a host's saved values
  // apply that person's permissions.
  const projectBinding = createAgentCommandProjectBinding(projectService, {
    sessionRequired: ["Vibe64 Env command session id is required.", "vibe64_agent_env_command_session_required"],
    projectRequired: ["Vibe64 Env command could not bind this session to a project.", "vibe64_agent_env_command_project_required"],
    unbound: ["Vibe64 Env command is not bound to this session project.", "vibe64_agent_env_command_project_binding_missing"],
    changed: ["Vibe64 Env command session project no longer matches its bound project.", "vibe64_agent_env_command_project_binding_changed"]
  }, { capture: () => ({ actor: currentProjectRequestContext()?.vibe64User || null }) });
  async function bindSession(sessionId = "") {
    const binding = await projectBinding.bind(sessionId);
    return {
      ok: true,
      projectContextRoot: binding.projectContextRoot,
      projectSlug: binding.projectSlug,
      sessionId: normalizeText(sessionId)
    };
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
    // readable-check: allow setter-seam - not a slot: setVariable saves one Development Env variable
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
      return productionEnvironmentProvider.isUserValueRecord(record);
    },
    async readRecords({ projectSlug = "" } = {}) {
      const result = assertOperationResult(
        await productionEnvironmentProvider.readRecords({ projectSlug }),
        "Production Env could not be read."
      );
      return Array.isArray(result?.records) ? result.records : [];
    },
    async removeVariable({
      key = "",
      projectSlug = ""
    } = {}) {
      assertOperationResult(
        await productionEnvironmentProvider.removeVariable({ key, projectSlug }),
        `Production Env ${key} could not be removed.`
      );
    },
    // readable-check: allow setter-seam - not a slot: setVariable saves one production Env variable
    async setVariable({
      key = "",
      projectSlug = "",
      secret = false,
      value = ""
    } = {}) {
      assertOperationResult(
        await productionEnvironmentProvider.setVariable({ key, projectSlug, secret, value }),
        `Production Env ${key} could not be saved.`
      );
    }
  });

  function environmentForScope(scope = "") {
    if (scope === ENV_SCOPE_DEVELOPMENT) {
      return developmentEnvironment;
    }
    return offersProductionEnvironment(productionEnvironmentProvider) ? productionEnvironment : null;
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
    const offered = offersSavedValues(savedEnvValueProvider);
    const result = offered ? assertOperationResult(
      await savedEnvValueProvider.list(savedValueRequest(binding, sessionId)),
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
    const payload = { entries, ok: true, ...(offered ? { provider: savedEnvValueProvider.label } : {}) };
    const lines = !offered
      ? ["This workspace offers no saved values."]
      : entries.length === 0
        ? [`${savedEnvValueProvider.label} has nothing you can use here yet.`]
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
    if (!offersSavedValues(savedEnvValueProvider)) {
      return responseError("This workspace offers no saved values.", "vibe64_saved_env_values_unavailable");
    }
    const request = { ...savedValueRequest(binding, sessionId), environment: parsed.scope, key };
    const linking = parsed.command === "link";
    assertOperationResult(
      linking
        ? await savedEnvValueProvider.link({ ...request, entryId: parsed.entryId, fieldId: parsed.fieldId })
        : await savedEnvValueProvider.unlink(request),
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
      result = validation || await projectBinding.run(
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
    const bound = Boolean(projectBinding.forget(normalizedSessionId));
    const closed = await commandServers.closeForSession(normalizedSessionId);
    return {
      closed: closed + (bound && closed === 0 ? 1 : 0),
      ok: true
    };
  }

  return Object.freeze({
    logger,
    bindSession,
    closeAllForSession,
    run
  });
}

/**
 * @param {object} options
 * @param {ReturnType<typeof createAgentEnvCommandService>} options.commandService
 * @param {string} [options.sessionId]
 * @param {string} [options.wrapperHostDir]
 */
async function prepareAgentEnvCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedSessionId || !normalizedWrapperHostDir) {
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
  const server = await commandServers.ensure({
    commandService,
    sessionId: normalizedSessionId,
    socketPath: commandSocketHostPath(normalizedWrapperHostDir)
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
