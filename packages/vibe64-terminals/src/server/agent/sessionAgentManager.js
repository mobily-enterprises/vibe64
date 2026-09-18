import path from "node:path";

import {
  assertCanUseVibe64Assistant,
  canUseVibe64Assistant,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE,
  Vibe64AgentExecutionProfileError,
  defineVibe64AssistantAccess,
  defineVibe64AssistantCapabilities,
  defineVibe64AssistantSelection,
  defineVibe64AgentExecutionProfileRequest,
  resolveVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  currentProjectVibe64User
} from "@local/vibe64-core/server/projectRequestContext";

const SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE = "vibe64_agent_provider_binding_conflict";
const EXECUTION_PROFILE_RESOLUTION_METHODS = new Set([
  "runDetachedChatTurn",
  "streamDetachedChatTurn"
]);
const EXECUTION_PROFILE_RESOLUTION_FIELDS = new Set([
  "limits",
  "policy",
  "providerId",
  "request",
  "revision",
  "thinking"
]);
const AI_METHODS = new Set([
  "inspectMessageAdmission",
  "createConversation",
  "ensureSession",
  "generateSessionRenewalHandover",
  "resolveExecutionProfile",
  "runDetachedChatTurn",
  "seedSessionRenewalHandover",
  "sendMessage",
  "startConversationTurn",
  "startTerminal",
  "streamDetachedChatTurn"
]);
const EPHEMERAL_ASSISTANT_SCOPE_FIELDS = new Set([
  "environment",
  "id",
  "runtimeRoot",
  "stableContext",
  "workdir"
]);
const EPHEMERAL_ASSISTANT_SCOPE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,127}$/u;
const EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS = 64 * 1024;

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function looksLikeExecutionProfileResolution(value = null) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).some((field) => EXECUTION_PROFILE_RESOLUTION_FIELDS.has(field))
  );
}

function sessionAgentProviderId(options = {}, fallbackProviderId = "") {
  const durableSelection = vibe64AssistantSelectionFromMetadata(
    options?.session?.metadata,
    { required: false }
  );
  return normalizeText(
    durableSelection?.engineId ||
    options?.assistantSelection?.engineId ||
    options?.engineId ||
    options?.providerId ||
    options?.agentSettings?.providerId ||
    options?.session?.agentSession?.providerId ||
    options?.session?.metadata?.agent_identity_provider ||
    fallbackProviderId
  );
}

function sessionAssistantSelection(options = {}) {
  if (options?.assistantSelection) {
    return defineVibe64AssistantSelection(options.assistantSelection);
  }
  return vibe64AssistantSelectionFromMetadata(options?.session?.metadata, {
    required: false
  });
}

function providerNotImplementedError(providerId = "") {
  const id = normalizeText(providerId);
  const error = new Error(`Assistant provider is not implemented: ${id || "(missing)"}.`);
  error.code = VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE;
  error.providerId = id;
  return error;
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

function normalizeProvider(provider = {}) {
  const id = normalizeText(provider?.id);
  const transportId = normalizeText(provider?.transportId);
  if (!id || !transportId) {
    throw new TypeError("Session agent providers require product provider and transport ids.");
  }
  return Object.freeze({
    ...provider,
    id,
    transportId
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

function createSessionAgentManager({
  attachments = null,
  defaultProviderId = "codex",
  readAssistantAccess = async () => ({ ownerOnly: false }),
  providers = []
} = {}) {
  const providerById = new Map();
  const bindings = new Map();
  const bindingTokens = new Map();
  const operations = new Map();
  // A full profile selects provider-owned execution details. Only the exact
  // in-process object issued by this manager may carry those details into a
  // turn; clones and durable snapshots are audit records, not capabilities.
  const verifiedExecutionProfiles = new WeakMap();

  if (typeof readAssistantAccess !== "function") {
    throw new TypeError("Session agent manager requires an assistant-access reader.");
  }

  for (const candidate of providers) {
    const provider = normalizeProvider(candidate);
    if (providerById.has(provider.id)) {
      throw new TypeError(`Duplicate session agent provider: ${provider.id}.`);
    }
    providerById.set(provider.id, provider);
  }

  function providerFor(options = {}) {
    const providerId = sessionAgentProviderId(options, defaultProviderId);
    const provider = providerById.get(providerId);
    if (!provider) {
      throw providerNotImplementedError(providerId);
    }
    return provider;
  }

  function bindSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    if (!id) {
      throw new TypeError("Session agent operations require a session id.");
    }
    const currentProviderId = bindings.get(id);
    const selection = sessionAssistantSelection(options);
    const durableProviderId = normalizeText(selection?.engineId);
    const explicitEngineId = normalizeText(options?.engineId);
    if (selection && explicitEngineId && selection.engineId !== explicitEngineId) {
      throw providerBindingConflictError(id, selection.engineId, explicitEngineId);
    }
    const requestedProviderId = sessionAgentProviderId(options);
    if (
      !durableProviderId &&
      currentProviderId &&
      requestedProviderId &&
      currentProviderId !== requestedProviderId
    ) {
      throw providerBindingConflictError(id, currentProviderId, requestedProviderId);
    }
    const provider = providerFor({
      ...options,
      providerId: durableProviderId || requestedProviderId || currentProviderId || defaultProviderId
    });
    bindings.set(id, provider.id);
    if (!bindingTokens.has(id) || (currentProviderId && currentProviderId !== provider.id)) {
      bindingTokens.set(id, Object.freeze({}));
    }
    return provider;
  }

  function operationKey(sessionId = "", providerId = "", operation = "", identity = "") {
    return [sessionId, providerId, operation, identity].map(normalizeText).join(":");
  }

  async function coalescedOperation(key = "", operation) {
    const existing = operations.get(key);
    if (existing) {
      return existing;
    }
    const pending = Promise.resolve().then(operation);
    operations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (operations.get(key) === pending) {
        operations.delete(key);
      }
    }
  }

  function rememberVerifiedExecutionProfile(provider = {}, sessionId = "", resolution = null) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(resolution);
    const attributed = Object.freeze(agentOperationResult(provider, sessionId, snapshot));
    verifiedExecutionProfiles.set(attributed, Object.freeze({
      providerId: provider.id,
      sessionBinding: bindingTokens.get(normalizeText(sessionId)),
      sessionId: normalizeText(sessionId),
      snapshot,
      transportId: provider.transportId
    }));
    return attributed;
  }

  function trustedExecutionProfile(provider = {}, sessionId = "", value = null) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(value);
    const provenance = verifiedExecutionProfiles.get(value);
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !provenance ||
      provenance.providerId !== provider.id ||
      provenance.sessionBinding !== bindingTokens.get(normalizedSessionId) ||
      provenance.sessionId !== normalizedSessionId ||
      provenance.transportId !== provider.transportId
    ) {
      throw untrustedExecutionProfileResolutionError(provider, normalizedSessionId);
    }
    const expected = provenance.snapshot;
    if (JSON.stringify(snapshot) !== JSON.stringify(expected)) {
      throw untrustedExecutionProfileResolutionError(provider, normalizedSessionId, {
        reason: "changed"
      });
    }
    return verifiedExecutionProfileResolution(provider, {
      profileId: expected.profileId,
      workloadId: expected.workloadId
    }, expected);
  }

  function assistantUser(options = {}) {
    return currentProjectVibe64User() || options?.vibe64User || null;
  }

  async function accessFor(provider = {}, sessionId = "", options = {}) {
    const vibe64User = assistantUser(options);
    const assistantSelection = sessionAssistantSelection(options);
    const access = defineVibe64AssistantAccess(await readAssistantAccess({
      assistantSelection,
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      session: options.session || null,
      sessionId: normalizeText(sessionId),
      vibe64User
    }));
    return Object.freeze({
      ...access,
      canRequestMessage: Boolean(
        access.available &&
        access.ownerOnly &&
        vibe64User &&
        vibe64User.role !== "owner"
      ),
      canUse: canUseVibe64Assistant(access, vibe64User),
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      transportId: provider.transportId
    });
  }

  async function requireAccessFor(provider = {}, sessionId = "", options = {}) {
    const access = await accessFor(provider, sessionId, options);
    assertCanUseVibe64Assistant(access, assistantUser(options));
    return access;
  }

  async function callSessionProvider(method = "", sessionId = "", input = {}, options = {}, {
    coalesceIdentity = ""
  } = {}) {
    const operationOptions = {
      ...options,
      agentSettings: options?.agentSettings || input?.agentSettings || null
    };
    const provider = bindSession(sessionId, operationOptions);
    const operation = attachments?.[method] || provider[method];
    if (typeof operation !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    const assistantAccess = AI_METHODS.has(method)
      ? await requireAccessFor(provider, sessionId, operationOptions)
      : null;
    const context = {
      agentSettings: operationOptions.agentSettings,
      assistantAccess,
      assistantSelection: sessionAssistantSelection(operationOptions),
      assistantScope: operationOptions.assistantScope || null,
      onEvent: typeof operationOptions.onEvent === "function" ? operationOptions.onEvent : null,
      providerId: provider.id,
      runtime: operationOptions.runtime || null,
      session: operationOptions.session || null,
      sessionId: normalizeText(sessionId),
      signal: operationOptions.signal || null,
      transportId: provider.transportId,
      turnOwnership: operationOptions.turnOwnership || null,
      vibe64User: assistantUser(operationOptions)
    };
    const run = async () => {
      const executionProfileRequest = method === "resolveExecutionProfile"
        ? defineVibe64AgentExecutionProfileRequest(input)
        : null;
      let providerInput = executionProfileRequest || input;
      if (method !== "resolveExecutionProfile" && hasOwn(input, "executionProfile")) {
        if (EXECUTION_PROFILE_RESOLUTION_METHODS.has(method)) {
          if (looksLikeExecutionProfileResolution(input.executionProfile)) {
            providerInput = {
              ...input,
              executionProfile: trustedExecutionProfile(
                provider,
                sessionId,
                input.executionProfile
              )
            };
          } else {
            if (typeof provider.resolveExecutionProfile !== "function") {
              throw new TypeError(
                `Assistant provider ${provider.id} does not implement resolveExecutionProfile().`
              );
            }
            const requestedExecutionProfile = defineVibe64AgentExecutionProfileRequest(
              input.executionProfile
            );
            providerInput = {
              ...input,
              executionProfile: verifiedExecutionProfileResolution(
                provider,
                requestedExecutionProfile,
                await provider.resolveExecutionProfile(
                  context,
                  requestedExecutionProfile
                )
              )
            };
          }
        } else {
          if (
            !input.executionProfile ||
            typeof input.executionProfile !== "object" ||
            Array.isArray(input.executionProfile)
          ) {
            defineVibe64AgentExecutionProfileRequest(input.executionProfile);
          }
          providerInput = {
            ...input,
            executionProfile: Object.keys(input.executionProfile).length === 2
              ? defineVibe64AgentExecutionProfileRequest(input.executionProfile)
              : vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile)
          };
        }
      }
      if (attachments && !options.attachmentsPrepared && ["sendMessage", "startConversationTurn"].includes(method)) {
        providerInput = await attachments.prepareMessage(context, providerInput, { durable: method === "sendMessage" });
      }
      const result = await operation(context, providerInput);
      return executionProfileRequest
        ? rememberVerifiedExecutionProfile(
            provider,
            sessionId,
            verifiedExecutionProfileResolution(provider, executionProfileRequest, result)
          )
        : agentOperationResult(provider, sessionId, result);
    };
    const identity = normalizeText(coalesceIdentity);
    return identity
      ? coalescedOperation(operationKey(sessionId, provider.id, method, identity), run)
      : run();
  }

  async function callProvider(method = "", input = {}, options = {}) {
    const provider = providerFor(options);
    if (typeof provider[method] !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    return agentOperationResult(provider, "", await provider[method]({
      providerId: provider.id,
      transportId: provider.transportId
    }, input, options));
  }

  async function callAllProviders(method = "", input = {}, options = {}) {
    const requestedProviderId = sessionAgentProviderId(options);
    const targets = requestedProviderId
      ? [providerFor(options)]
      : [...providerById.values()];
    const results = await Promise.all(targets.map(async (provider) => {
      if (typeof provider[method] !== "function") {
        throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
      }
      return agentOperationResult(provider, "", await provider[method]({
        providerId: provider.id,
        transportId: provider.transportId
      }, input, options));
    }));
    if (results.length === 1) {
      return results[0];
    }
    const failed = results.filter((result) => result.ok === false);
    return Object.freeze({
      closed: results.reduce((total, result) => total + Number(result.closed || 0), 0),
      failed,
      ok: failed.length === 0,
      results: Object.freeze(results),
      stopped: results.reduce((total, result) => total + Number(result.stopped || 0), 0)
    });
  }

  async function providerCapabilities(provider = {}, input = {}, options = {}) {
    if (typeof provider.capabilities !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement capabilities().`);
    }
    return defineVibe64AssistantCapabilities(await provider.capabilities({
      engineId: provider.id,
      transportId: provider.transportId,
      vibe64User: options.vibe64User || null
    }, input, options));
  }

  function sessionMethod(method) {
    return (sessionId = "", input = {}, options = {}) => (
      callSessionProvider(method, sessionId, input, options)
    );
  }

  function ephemeralScopeMethod(method) {
    return (scope = {}, input = {}, options = {}) => {
      const assistantScope = defineEphemeralAssistantScope(scope);
      return callSessionProvider(method, assistantScope.id, input, {
        ...options,
        assistantScope
      });
    };
  }

  async function deleteEphemeralConversation(scope = {}, input = {}, options = {}) {
    const assistantScope = defineEphemeralAssistantScope(scope);
    const result = await callSessionProvider(
      "deleteConversation",
      assistantScope.id,
      input,
      { ...options, assistantScope }
    );
    if (result?.ok !== false) {
      bindings.delete(assistantScope.id);
      bindingTokens.delete(assistantScope.id);
    }
    return result;
  }

  async function closeSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    const provider = bindSession(id, options);
    const context = {
      changeover: options.changeover === true,
      preserveProcessExitProof: options.preserveProcessExitProof === true,
      providerId: provider.id,
      renewalCleanup: options.renewalCleanup || null,
      runtime: options.runtime || null,
      session: options.session || null,
      sessionId: id,
      transportId: provider.transportId
    };
    const result = typeof provider.closeSession !== "function"
      ? agentOperationResult(provider, id, { closed: false, ok: true })
      : agentOperationResult(provider, id, await provider.closeSession(context));
    if (result.ok !== false) {
      bindings.delete(id);
      bindingTokens.delete(id);
    }
    return result;
  }

  async function releaseRenewalPredecessorProcessExitProof(
    sessionId = "",
    input = {},
    options = {}
  ) {
    const id = normalizeText(sessionId);
    const result = await callSessionProvider(
      "releaseRenewalPredecessorProcessExitProof",
      id,
      input,
      options
    );
    if (result.ok !== false) {
      bindings.delete(id);
      bindingTokens.delete(id);
    }
    return result;
  }

  async function releaseRenewalPredecessorAttachments(
    sessionId = "",
    input = {},
    options = {}
  ) {
    const id = normalizeText(sessionId);
    const result = await callSessionProvider(
      "releaseRenewalPredecessorAttachments",
      id,
      input,
      options
    );
    if (result.ok !== false) {
      bindings.delete(id);
      bindingTokens.delete(id);
    }
    return result;
  }

  async function releaseRenewalSuccessorProcessExitProof(
    sessionId = "",
    input = {},
    options = {}
  ) {
    const id = normalizeText(sessionId);
    const result = await callSessionProvider(
      "releaseRenewalSuccessorProcessExitProof",
      id,
      input,
      options
    );
    if (result.ok !== false) {
      bindings.delete(id);
      bindingTokens.delete(id);
    }
    return result;
  }

  return Object.freeze({
    async readPlanUsage(sessionId, options = {}) {
      const provider = bindSession(sessionId, options);
      const access = await accessFor(provider, sessionId, options);
      if (provider.id !== "codex" || !access.canUse || !access.ownerOnly) {
        return { status: "unsupported", windows: [] };
      }
      return provider.readPlanUsage({ sessionId, runtime: options.runtime, session: options.session });
    },
    async readGoal(sessionId, options = {}) {
      const provider = bindSession(sessionId, options);
      const access = await accessFor(provider, sessionId, options);
      if (provider.id !== "codex" || !access.canUse) {
        return { status: "unsupported", goal: null };
      }
      return provider.readGoal({ sessionId, runtime: options.runtime, session: options.session });
    },
    async updateGoal(sessionId, input = {}, options = {}) {
      const provider = bindSession(sessionId, options);
      await requireAccessFor(provider, sessionId, options);
      if (provider.id !== "codex") {
        throw new TypeError("Goal controls require Codex.");
      }
      return provider.updateGoal({ sessionId, runtime: options.runtime, session: options.session }, input);
    },
    async assistantAccess(sessionId = "", options = {}) {
      const provider = bindSession(sessionId, options);
      return accessFor(provider, sessionId, options);
    },
    async requireAssistantAccess(sessionId = "", options = {}) {
      const provider = bindSession(sessionId, options);
      return requireAccessFor(provider, sessionId, options);
    },
    requireAssistantAccessForEngine(engineId = "", options = {}) {
      const engineOptions = { ...options, engineId };
      return requireAccessFor(providerFor(engineOptions), "", engineOptions);
    },
    requireAssistantAccessForSelection(assistantSelection = {}, options = {}) {
      const selection = defineVibe64AssistantSelection(assistantSelection);
      const selectionOptions = { ...options, assistantSelection: selection };
      return requireAccessFor(providerFor(selectionOptions), "", selectionOptions);
    },
    binding(sessionId = "") {
      return bindings.get(normalizeText(sessionId)) || "";
    },
    closeProject(input = {}, options = {}) {
      return callAllProviders("closeProject", input, options);
    },
    closeSession,
    closeTerminal: sessionMethod("closeTerminal"),
    createConversation: sessionMethod("createConversation"),
    createEphemeralConversation: ephemeralScopeMethod("createConversation"),
    deleteConversation: sessionMethod("deleteConversation"),
    deleteEphemeralConversation,
    deleteAttachment: sessionMethod("deleteAttachment"),
    deleteDetachedChatThread: sessionMethod("deleteDetachedChatThread"),
    async describeProvider(options = {}) {
      const sessionId = normalizeText(options?.session?.sessionId || options?.session?.id);
      const provider = sessionId
        ? bindSession(sessionId, options)
        : providerFor(options);
      const fallback = {
        providerId: provider.id,
        transportId: provider.transportId
      };
      if (typeof provider.describeProvider !== "function") {
        return Object.freeze(fallback);
      }
      await requireAccessFor(provider, sessionId, options);
      const described = await provider.describeProvider({
        providerId: provider.id,
        runtime: options.runtime || null,
        session: options.session || null,
        sessionId,
        transportId: provider.transportId,
        vibe64User: options.vibe64User || null
      });
      const providerId = normalizeText(described?.providerId);
      const transportId = normalizeText(described?.transportId);
      if (providerId !== provider.id || transportId !== provider.transportId) {
        throw providerBindingConflictError(
          sessionId,
          provider.id,
          providerId || "unknown"
        );
      }
      const accountIdentitySignature = normalizeText(described?.accountIdentitySignature);
      if (!/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)) {
        throw new TypeError(
          `Assistant provider ${provider.id} did not return a stable account identity.`
        );
      }
      return Object.freeze({
        ...fallback,
        accountIdentitySignature
      });
    },
    ensureSession(sessionId = "", options = {}) {
      return callSessionProvider("ensureSession", sessionId, {}, options, {
        coalesceIdentity: "session"
      });
    },
    generateSessionRenewalHandover: sessionMethod("generateSessionRenewalHandover"),
    hasActiveTemporaryConversation: sessionMethod("hasActiveTemporaryConversation"),
    interruptDetachedChatTurn: sessionMethod("interruptDetachedChatTurn"),
    interruptTurn: sessionMethod("interruptTurn"),
    invalidateRuntimes(input = {}, options = {}) {
      return callAllProviders("invalidateRuntimes", input, options);
    },
    async listCapabilities(input = {}, options = {}) {
      const requestedEngineId = normalizeText(input?.engineId);
      const providersToInspect = requestedEngineId
        ? [providerFor({ engineId: requestedEngineId })]
        : [...providerById.values()];
      return Object.freeze({
        engines: Object.freeze(await Promise.all(providersToInspect.map((provider) => (
          providerCapabilities(provider, input, options)
        )))),
        ok: true
      });
    },
    async reconcileSessions(sessions = [], options = {}) {
      const grouped = new Map();
      for (const session of sessions) {
        const provider = providerFor({ ...options, session });
        const values = grouped.get(provider.id) || [];
        values.push(session);
        grouped.set(provider.id, values);
      }
      const results = [];
      for (const [providerId, providerSessions] of grouped) {
        const provider = providerById.get(providerId);
        if (typeof provider.reconcileSessions !== "function") {
          throw new TypeError(
            `Assistant provider ${provider.id} does not implement reconcileSessions().`
          );
        }
        if (assistantUser(options)) {
          for (const session of providerSessions) {
            await requireAccessFor(provider, session?.sessionId || session?.id, {
              ...options,
              session
            });
          }
        }
        results.push(agentOperationResult(provider, "", await provider.reconcileSessions({
          providerId: provider.id,
          transportId: provider.transportId
        }, providerSessions, options)));
      }
      return Object.freeze({ ok: true, results: Object.freeze(results) });
    },
    async resolveSelection(input = {}, options = {}) {
      const provider = providerFor({ engineId: input?.engineId });
      return resolveVibe64AssistantSelection(
        await providerCapabilities(provider, input, options),
        input
      );
    },
    readConversation: sessionMethod("readConversation"),
    readEphemeralConversation: ephemeralScopeMethod("readConversation"),
    resolveExecutionProfile: sessionMethod("resolveExecutionProfile"),
    readTerminal(sessionId = "", terminalSessionId = "", options = {}) {
      return callSessionProvider("readTerminal", sessionId, { terminalSessionId }, options);
    },
    pinAttachments: sessionMethod("pinAttachments"),
    resizeTerminal(sessionId = "", terminalSessionId = "", size = {}, options = {}) {
      return callSessionProvider("resizeTerminal", sessionId, { size, terminalSessionId }, options);
    },
    runDetachedChatTurn: sessionMethod("runDetachedChatTurn"),
    releaseRenewalPredecessorAttachments,
    releaseRenewalPredecessorProcessExitProof,
    releaseRenewalSuccessorProcessExitProof,
    seedSessionRenewalHandover: sessionMethod("seedSessionRenewalHandover"),
    sendMessage: sessionMethod("sendMessage"),
    inspectMessageAdmission: sessionMethod("inspectMessageAdmission"),
    sessionState(sessionId = "", options = {}) {
      return callSessionProvider("sessionState", sessionId, {}, options);
    },
    startConversationTurn: sessionMethod("startConversationTurn"),
    startEphemeralConversationTurn: ephemeralScopeMethod("startConversationTurn"),
    startTerminal: sessionMethod("startTerminal"),
    stopConversation: sessionMethod("stopConversation"),
    stopEphemeralConversation: ephemeralScopeMethod("stopConversation"),
    streamDetachedChatTurn: sessionMethod("streamDetachedChatTurn"),
    subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null, options = {}) {
      return callSessionProvider("subscribeTerminal", sessionId, { subscriber, terminalSessionId }, options);
    },
    unsubscribeSessions(sessions = [], options = {}) {
      return callProvider("unsubscribeSessions", sessions, options);
    },
    unpinAttachments: sessionMethod("unpinAttachments"),
    uploadAttachment: sessionMethod("uploadAttachment"),
    waitForConversationTurn: sessionMethod("waitForConversationTurn"),
    waitForEphemeralConversationTurn: ephemeralScopeMethod("waitForConversationTurn"),
    writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
      return callSessionProvider("writeTerminal", sessionId, { data, input, terminalSessionId }, options);
    }
  });
}

export {
  EPHEMERAL_ASSISTANT_CONTEXT_MAX_CHARACTERS,
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager,
  defineEphemeralAssistantScope,
  sessionAgentProviderId
};
