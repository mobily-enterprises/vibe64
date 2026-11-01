import path from "node:path";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  Vibe64AgentExecutionProfileError,
  defineVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { normalizeText } from "@local/vibe64-core/server/core";
import { currentProjectVibe64User } from "@local/vibe64-core/server/projectRequestContext";
import { hasOwn } from "../hasOwn.js";

const SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE = "vibe64_agent_provider_binding_conflict";

const EPHEMERAL_ASSISTANT_SCOPE_FIELDS = new Set([
  "environment",
  "id",
  "runtimeRoot",
  "stableContext",
  "workdir"
]);
const EPHEMERAL_ASSISTANT_SCOPE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS = 64 * 1024;

function sessionAgentProviderId(options = {}, fallbackProviderId = "") {
  const durableSelection = vibe64AssistantSelectionFromMetadata(
    options.session?.metadata,
    { required: false }
  );
  return normalizeText(
    durableSelection?.engineId ||
    options.assistantSelection?.engineId ||
    options.engineId ||
    options.providerId ||
    options.agentSettings?.providerId ||
    options.session?.agentSession?.providerId ||
    options.session?.metadata?.agent_identity_provider ||
    fallbackProviderId
  );
}

function sessionAssistantSelection(options = {}) {
  if (options.assistantSelection) {
    return defineVibe64AssistantSelection(options.assistantSelection);
  }
  return vibe64AssistantSelectionFromMetadata(options.session?.metadata, {
    required: false
  });
}

function providerBindingConflictError(sessionId = "", currentProviderId = "", requestedProviderId = "") {
  const error = new Error(
    `Assistant session ${normalizeText(sessionId)} is bound to ${normalizeText(currentProviderId)}, not ${normalizeText(requestedProviderId)}.`
  );
  error.code = SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE;
  error.currentProviderId = normalizeText(currentProviderId);
  error.requestedProviderId = normalizeText(requestedProviderId);
  error.sessionId = normalizeText(sessionId);
  return error;
}

function defineEphemeralAssistantScope(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Ephemeral assistant scope must be an object.");
  }
  const unsupported = Object.keys(value)
    .filter((field) => !EPHEMERAL_ASSISTANT_SCOPE_FIELDS.has(field));
  if (unsupported.length > 0) {
    throw new TypeError(`Ephemeral assistant scope contains unsupported fields: ${unsupported.join(", ")}.`);
  }
  const missing = [...EPHEMERAL_ASSISTANT_SCOPE_FIELDS]
    .filter((field) => !hasOwn(value, field));
  if (missing.length > 0) {
    throw new TypeError(`Ephemeral assistant scope is missing required fields: ${missing.join(", ")}.`);
  }
  const id = normalizeText(value.id);
  const workdir = normalizeText(value.workdir);
  const runtimeRoot = normalizeText(value.runtimeRoot);
  if (typeof value.stableContext !== "string") {
    throw new TypeError("Ephemeral assistant scope stable context must be a string.");
  }
  const stableContext = value.stableContext.trim();
  if (!EPHEMERAL_ASSISTANT_SCOPE_ID_PATTERN.test(id)) {
    throw new TypeError("Ephemeral assistant scope requires a stable lowercase scope id.");
  }
  if (!path.isAbsolute(workdir) || !path.isAbsolute(runtimeRoot)) {
    throw new TypeError("Ephemeral assistant scope roots must be absolute paths.");
  }
  if (!stableContext || stableContext.length > EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS) {
    throw new TypeError("Ephemeral assistant scope requires bounded stable context.");
  }
  const sourceEnvironment = value.environment;
  if (!sourceEnvironment || typeof sourceEnvironment !== "object" || Array.isArray(sourceEnvironment)) {
    throw new TypeError("Ephemeral assistant scope environment must be an object.");
  }
  const environment = Object.fromEntries(Object.entries(sourceEnvironment).map(([name, entry]) => {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name) || typeof entry !== "string") {
      throw new TypeError("Ephemeral assistant scope environment must contain string environment values.");
    }
    return [name, entry];
  }));
  return Object.freeze({
    environment: Object.freeze(environment),
    id,
    runtimeRoot: path.resolve(runtimeRoot),
    stableContext,
    workdir: path.resolve(workdir)
  });
}

function agentOperationResult(provider = {}, sessionId = "", result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : { value: result };
  return {
    ...source,
    engineId: provider.id,
    providerId: provider.id,
    sessionId: normalizeText(sessionId),
    transportId: provider.transportId
  };
}

function verifiedExecutionProfileResolution(provider = {}, request = {}, value = null) {
  const resolution = vibe64AgentExecutionProfileAuditSnapshot(value);
  const expectedIdentity = {
    profileId: request.profileId,
    providerId: provider.id,
    workloadId: request.workloadId
  };
  for (const [field, expected] of Object.entries(expectedIdentity)) {
    if (resolution[field] !== expected) {
      throw new Vibe64AgentExecutionProfileError(
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
        `Assistant provider ${provider.id} returned an execution profile with the wrong ${field}.`,
        {
          actual: resolution[field],
          expected,
          field: `resolution.${field}`
        }
      );
    }
  }
  return resolution;
}

function untrustedExecutionProfileResolutionError(provider = {}, sessionId = "", details = {}) {
  return new Vibe64AgentExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID,
    "The pre-resolved assistant execution profile was not issued for this provider session.",
    {
      field: "executionProfile",
      providerId: normalizeText(provider.id),
      sessionId: normalizeText(sessionId),
      ...details
    }
  );
}

function connectionChangeBusy(engineId = "opencode", sessionIds = []) {
  const label = engineId === "claude" ? "Claude Code" : "OpenCode";
  const where = sessionIds.length ? ` open in ${sessionIds.length === 1 ? "session" : "sessions"} ${sessionIds.join(", ")}` : "";
  return Object.assign(new Error(
    `Close ${label} native terminals${where}, then retry this connection change. The saved connection has not changed.`
  ),
    {
    code: `vibe64_${engineId}_connection_in_use`,
    statusCode: 409,
    ...(sessionIds.length ? { details: { sessionIds } } : {})
  });
}

function bindingKey(sessionId, options = {}) {
  const id = normalizeText(sessionId);
  return options.routingConversationId ? `${id}\0conversation\0${options.routingConversationId}` : id;
}

function assistantUser(options = {}) {
  return Object.hasOwn(options, "vibe64User") ? options.vibe64User : currentProjectVibe64User() || null;
}

export {
  EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS,
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  agentOperationResult,
  assistantUser,
  bindingKey,
  connectionChangeBusy,
  defineEphemeralAssistantScope,
  providerBindingConflictError,
  sessionAgentProviderId,
  sessionAssistantSelection,
  untrustedExecutionProfileResolutionError,
  verifiedExecutionProfileResolution
};
