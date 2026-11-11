import path from "node:path";

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
  normalizeRuntimeConfigKey,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  vibe64ErrorResponse
} from "@local/vibe64-core/server/serverResponses";
import {
  agentEnvWrapperSource,
  shellQuote
} from "@local/vibe64-execution/server";
import { envValueWithoutFinalLineEnding } from "@local/vibe64-project/shared/contracts";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import { createAgentCommandProjectBinding } from "./agentCommandProjectBinding.js";
import { offersProductionEnvironment } from "./productionEnvironment.js";
import { deploymentStatusPayload, humanDeploymentStatus } from "./agentDeploymentStatus.js";
import { offersSavedValueLinks } from "./savedEnvValueLinks.js";
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
  scopeStatus,
  unavailableProductionStatus,
  validateParsedCommand
} from "./agentEnvCommandText.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { commandLineFailure } from "./commandFailure.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */

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

/** The command's socket, under this server process's temporary directory. */
function commandSocketHostPath(wrapperHostDir = "") {
  return unixCommandSocketPath(path.join(wrapperHostDir, AGENT_ENV_COMMAND_SOCKET_NAME), { env: process.env });
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
  notFound: commandLineFailure("Unknown Vibe64 Env command route.", "vibe64_agent_env_command_route_not_found"),
  rejection: {
    statusCode: 409,
    payload: commandLineFailure(
      "Managed Env control generation is no longer current. Reconnect the assistant.",
      "vibe64_agent_control_unavailable",
      { messageCode: "vibe64_agent_env_control_stale" }
    )
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
 * @param {ProjectService} dependencies.project
 * @param {ProductionEnvironmentProvider} dependencies.productionEnvironmentProvider a host's production Env values
 * @param {SavedEnvValueLinks} dependencies.savedEnvValueLinks a host's saved values to link
 */
function createAgentEnvCommandService({
  logger,
  project,
  productionEnvironmentProvider,
  savedEnvValueLinks
}) {
  // The person whose request prepared this agent; a host's saved values
  // apply that person's permissions.
  const projectBinding = createAgentCommandProjectBinding(project, {
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
      sessionId: toText(sessionId)
    };
  }

  // This command owns agent policy and transport, not persistence. These two
  // delegates are the complete boundary to the services that own each scope.
  const developmentEnvironment = Object.freeze({
    isUserValueRecord(record = null) {
      return toText(record?.source) === ENV_USER_VALUE_SOURCE;
    },
    async readRecords({ sessionId = "" } = {}) {
      const result = assertOperationResult(await project.readEnv({
        environment: "dev",
        sessionId
      }), "Development Env could not be read.");
      return Array.isArray(result?.env?.records) ? result.env.records : [];
    },
    async removeVariable({
      key = "",
      sessionId = ""
    } = {}) {
      assertOperationResult(await project.saveEnvUserValues({
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
      assertOperationResult(await project.saveEnvUserValues({
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
  // Changes also carry the person whose request prepared the agent, so the
  // host applies that person's permission to change production values.
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
      actor = null,
      key = "",
      projectSlug = ""
    } = {}) {
      assertOperationResult(
        await productionEnvironmentProvider.removeVariable({ actor, key, projectSlug }),
        `Production Env ${key} could not be removed.`
      );
    },
    // readable-check: allow setter-seam - not a slot: setVariable saves one production Env variable
    async setVariable({
      actor = null,
      key = "",
      projectSlug = "",
      secret = false,
      value = ""
    } = {}) {
      assertOperationResult(
        await productionEnvironmentProvider.setVariable({ actor, key, projectSlug, secret, value }),
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
      return commandLineFailure(
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

  // Read-only and names-only: the host answers for the bound project, and
  // only the fields deploymentStatusPayload copies reach the agent.
  async function deploymentResult(parsed = {}, binding = {}, sessionId = "") {
    if (toText(parsed.positionals[1]) === "ssh-config") {
      return sshConfigResult(parsed, binding, sessionId);
    }
    const result = await productionEnvironmentProvider.readDeployment({
      actor: binding.actor || null,
      projectSlug: toText(binding.projectSlug)
    });
    if (result?.ok === false) {
      return commandLineFailure(
        toText(result.error) || "The deployment could not be read.",
        toText(result.code) || "vibe64_agent_deployment_read_failed"
      );
    }
    const payload = deploymentStatusPayload(result?.deployment);
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.json ? `${JSON.stringify(payload, null, 2)}\n` : humanDeploymentStatus(payload)
    };
  }

  function hostRefusal(result, fallback, fallbackCode) {
    return commandLineFailure(toText(result?.error) || fallback, toText(result?.code) || fallbackCode);
  }

  // The session's ssh wrapper asks for the configuration of `Host production` before each production login;
  // the host decides whether this session may log in and records the command line it is about to run.
  async function sshConfigResult(parsed = {}, binding = {}, sessionId = "") {
    const result = await productionEnvironmentProvider.openProductionSsh({
      actor: binding.actor || null,
      command: (parsed.passthrough || []).join(" ").slice(0, 2000),
      projectSlug: toText(binding.projectSlug),
      sessionId
    });
    const configPath = toText(result?.configPath);
    if (result?.ok === false || !path.isAbsolute(configPath)) {
      return hostRefusal(result, "Production could not be reached from this session.", "vibe64_agent_production_ssh_unavailable");
    }
    return { exitCode: 0, ok: true, stdout: `${configPath}\n` };
  }

  // Production's values, secrets included, only where the host allows this session; the host records the read.
  async function productionValuesResult(parsed = {}, binding = {}, sessionId = "") {
    const key = parsed.command === "get" ? normalizeRuntimeConfigKey(parsed.key) : "";
    const result = await productionEnvironmentProvider.readProductionValues({
      actor: binding.actor || null,
      keys: key ? [key] : [],
      projectSlug: toText(binding.projectSlug),
      sessionId
    });
    if (result?.ok === false) {
      return hostRefusal(result, "Production values could not be read.", "vibe64_agent_production_values_unavailable");
    }
    const releaseId = toText(result?.releaseId);
    const variables = (Array.isArray(result?.variables) ? result.variables : [])
      .map((variable) => ({ key: toText(variable?.key), value: String(variable?.value ?? "") }))
      .filter((variable) => variable.key && (!key || variable.key === key))
      .sort((left, right) => left.key.localeCompare(right.key));
    if (key) {
      const variable = variables[0];
      if (!variable) {
        const release = releaseId ? `The live release ${releaseId}` : "The live release";
        return commandLineFailure(`${release} runs without ${key}.`, "vibe64_agent_production_value_missing");
      }
      return {
        exitCode: 0,
        ok: true,
        stdout: parsed.json ? `${JSON.stringify({ key, ok: true, releaseId, value: variable.value }, null, 2)}\n` : `${variable.value}\n`
      };
    }
    return {
      exitCode: 0,
      ok: true,
      stdout: parsed.json
        ? `${JSON.stringify({ ok: true, releaseId, variables }, null, 2)}\n`
        : [
            `# The Env release ${releaseId || "(unknown)"} runs with: production's secrets. Use them in commands; keep them out of source, messages and summaries.`,
            ...variables.map((variable) => `export ${variable.key}='${variable.value.replaceAll("'", "'\\''")}'`)
          ].join("\n") + "\n"
    };
  }

  async function setResult(parsed = {}, sessionId = "", stdin = "", projectSlug = "", actor = null) {
    const key = normalizeRuntimeConfigKey(parsed.key);
    const environment = environmentForScope(parsed.scope);
    if (!environment) {
      return commandLineFailure(
        unavailableProductionStatus().reason,
        "vibe64_agent_env_command_production_unavailable"
      );
    }
    const previousRecords = await environment.readRecords({ projectSlug, sessionId });
    const previous = recordForKey(previousRecords, key);
    assertRecordEditable(previous, parsed.scope, key);
    const secret = parsed.secret || previous?.secret === true || runtimeConfigKeyLooksSecret(key);
    const value = envValueWithoutFinalLineEnding(stdin);
    await environment.setVariable({
      actor,
      key,
      projectSlug,
      secret,
      sessionId,
      value
    });
    return mutationPayload({
      action: "set",
      changed: true,
      created: !environment.isUserValueRecord(previous),
      empty: value.length === 0,
      key,
      scope: parsed.scope,
      secret
    }, parsed);
  }

  async function removeResult(parsed = {}, sessionId = "", projectSlug = "", actor = null) {
    const key = normalizeRuntimeConfigKey(parsed.key);
    const environment = environmentForScope(parsed.scope);
    if (!environment) {
      return commandLineFailure(
        unavailableProductionStatus().reason,
        "vibe64_agent_env_command_production_unavailable"
      );
    }
    const previousRecords = await environment.readRecords({ projectSlug, sessionId });
    const previous = recordForKey(previousRecords, key);
    assertRecordEditable(previous, parsed.scope, key);
    const stored = environment.isUserValueRecord(previous);
    if (stored) {
      await environment.removeVariable({ actor, key, projectSlug, sessionId });
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
      projectSlug: toText(binding.projectSlug),
      sessionId
    };
  }

  async function savedResult(parsed = {}, sessionId = "", binding = {}) {
    const offered = offersSavedValueLinks(savedEnvValueLinks);
    const result = offered ? assertOperationResult(
      await savedEnvValueLinks.list(savedValueRequest(binding, sessionId)),
      "Saved values could not be read."
    ) : null;
    const entries = (Array.isArray(result?.entries) ? result.entries : []).map((entry) => ({
      description: toText(entry?.description),
      environments: Array.isArray(entry?.environments) ? entry.environments.map(toText).filter(Boolean) : [],
      fields: (Array.isArray(entry?.fields) ? entry.fields : []).map((field) => ({
        id: toText(field?.id),
        label: toText(field?.label),
        secret: field?.secret === true
      })).filter((field) => field.id),
      id: toText(entry?.id),
      label: toText(entry?.label)
    })).filter((entry) => entry.id);
    const payload = { entries, ok: true, ...(offered ? { provider: savedEnvValueLinks.label } : {}) };
    const lines = !offered
      ? ["This workspace offers no saved values."]
      : entries.length === 0
        ? [`${savedEnvValueLinks.label} has nothing you can use here yet.`]
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
    if (!offersSavedValueLinks(savedEnvValueLinks)) {
      return commandLineFailure("This workspace offers no saved values.", "vibe64_saved_env_values_unavailable");
    }
    const request = { ...savedValueRequest(binding, sessionId), environment: parsed.scope, key };
    const linking = parsed.command === "link";
    assertOperationResult(
      linking
        ? await savedEnvValueLinks.link({ ...request, entryId: parsed.entryId, fieldId: parsed.fieldId })
        : await savedEnvValueLinks.unlink(request),
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
    const projectSlug = toText(binding.projectSlug);
    if (parsed.command === "status") {
      return statusResult(parsed, toText(input.sessionId), projectSlug);
    }
    if (parsed.command === "deployment") {
      return deploymentResult(parsed, binding, toText(input.sessionId));
    }
    if (parsed.command === "get" || parsed.command === "export") {
      return productionValuesResult(parsed, binding, toText(input.sessionId));
    }
    if (parsed.command === "saved") {
      return savedResult(parsed, toText(input.sessionId), binding);
    }
    if (parsed.command === "link" || parsed.command === "unlink") {
      return linkResult(parsed, toText(input.sessionId), binding);
    }
    if (parsed.command === "set") {
      return setResult(parsed, toText(input.sessionId), String(input.stdin ?? ""), projectSlug, binding.actor || null);
    }
    return removeResult(parsed, toText(input.sessionId), projectSlug, binding.actor || null);
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parseCommandArgs(input.args);
    const sessionId = toText(input.sessionId);
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
      code: toText(result?.code),
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
    const normalizedSessionId = toText(sessionId);
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
    // Whether the session's ssh, scp and sftp reach production through the host (prepareAgentEnvCommand).
    offersProduction: offersProductionEnvironment(productionEnvironmentProvider),
    closeAllForSession,
    run
  });
}

// The session's ssh, scp and sftp, beside its other managed commands and before the system's on its PATH: a
// command line naming the host `production` (ssh production, scp file production:dir, rsync over ssh, git)
// asks the Env command for the host's `Host production` configuration first, and runs with it, or stops with
// the host's reason; any other command line runs the system's own command unchanged.
const PRODUCTION_SSH_COMMANDS = Object.freeze({ scp: "/usr/bin/scp", sftp: "/usr/bin/sftp", ssh: "/usr/bin/ssh" });

function productionSshWrapperSource(name = "", envCommandPath = "") {
  const system = PRODUCTION_SSH_COMMANDS[name];
  return [
    "#!/bin/sh",
    `# Vibe64: ${name} reaches this project's production as \`production\` where the host allows this session.`,
    "for argument in \"$@\"; do",
    "  case \"$argument\" in",
    "    production|*@production|production:*|*@production:*)",
    `      config="$(${shellQuote(envCommandPath)} deployment ssh-config -- ${name} "$@")" || exit 255`,
    `      exec ${system} -F "$config" "$@" ;;`,
    "  esac",
    "done",
    `exec ${system} "$@"`,
    ""
  ].join("\n");
}

/**
 * @param {object} options
 * @param {AgentEnvCommandService} options.commandService
 * @param {string} [options.sessionId]
 * @param {string} [options.wrapperHostDir]
 */
async function prepareAgentEnvCommand({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
}) {
  const normalizedSessionId = toText(sessionId);
  const normalizedWrapperHostDir = toText(wrapperHostDir);
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
  if (commandService.offersProduction) {
    for (const name of Object.keys(PRODUCTION_SSH_COMMANDS)) {
      await writeExecutableFileIfChanged(
        path.join(normalizedWrapperHostDir, name),
        productionSshWrapperSource(name, commandWrapperHostPath(normalizedWrapperHostDir))
      );
    }
  }
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

const __testables = Object.freeze({
  AGENT_ENV_COMMAND_NAME,
  productionSshWrapperSource,
  VIBE64_AGENT_ENV_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_ENV_COMMAND_SESSION_ID_ENV
});

export {
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  createAgentEnvCommandService,
  prepareAgentEnvCommand,
  __testables
};
