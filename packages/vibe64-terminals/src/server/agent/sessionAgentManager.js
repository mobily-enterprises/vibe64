import path from "node:path";
import { requireCompletedConversationRewind, requireCompletedNativeConversationReplacement } from "../assistantChangeover.js";
import { ASSISTANT_PURPOSE_ROLES, ASSISTANT_ROUTING_ASSIGNMENTS, recommendedRoutingAssignments,
  routingAssignmentSelection, routingModelChoices, resolveAssistantPurpose } from "@local/vibe64-runtime/shared/assistantRouting";

import {
  assertCanUseVibe64Assistant,
  canUseVibe64Assistant,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE,
  VIBE64_AGENT_PROVIDERS,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  Vibe64AgentExecutionProfileError,
  defineVibe64AssistantAccess,
  defineVibe64AssistantCapabilities,
  defineVibe64AssistantSelection,
  defineVibe64AgentExecutionProfileRequest,
  resolveVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
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
  "rewindConversation",
  "createConversation",
  "ensureSession",
  "generateSessionRenewalHandover",
  "resolveExecutionProfile",
  "runDetachedChatTurn",
  "seedSessionRenewalHandover",
  "sendMessage",
  "startConversationTurn",
  "startTerminal",
  "streamDetachedChatTurn",
  "writeTerminal"
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
  resolveAssistantUser = async (user) => user || currentProjectVibe64User() || null,
  readRoutingConfiguration = null,
  providers = []
} = {}) {
  const providerById = new Map();
  const bindings = new Map();
  const bindingTokens = new Map();
  const terminalBindings = new Map();
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

  function bindingKey(sessionId, options = {}) {
    const id = normalizeText(sessionId);
    return options.routingConversationId ? `${id}\0conversation\0${options.routingConversationId}` : id;
  }

  function bindSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    if (!id) {
      throw new TypeError("Session agent operations require a session id.");
    }
    const key = bindingKey(id, options);
    const currentProviderId = bindings.get(key);
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
    if (selection && !options.routingConversationId) {
      for (const terminal of terminalBindings.values()) {
        if (terminal.sessionId === id && (terminal.providerId !== provider.id ||
            terminal.selection?.modelProviderId !== selection.modelProviderId)) {
          terminal.invalidated = true;
        }
      }
    }
    bindings.set(key, provider.id);
    if (!bindingTokens.has(key) || (currentProviderId && currentProviderId !== provider.id)) {
      bindingTokens.set(key, Object.freeze({}));
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

  function rememberVerifiedExecutionProfile(provider = {}, sessionId = "", resolution = null, context = {}) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(resolution);
    if (context.assistantScope && snapshot.model !== context.assistantSelection?.modelId) {
      throw untrustedExecutionProfileResolutionError(provider, sessionId, { reason: "selection_changed" });
    }
    const attributed = Object.freeze(agentOperationResult(provider, sessionId, snapshot));
    verifiedExecutionProfiles.set(attributed, Object.freeze({
      providerId: provider.id,
      sessionBinding: bindingTokens.get(bindingKey(sessionId, context)),
      sessionId: normalizeText(sessionId),
      snapshot,
      scope: context.assistantScope ? JSON.stringify(context.assistantScope) : "",
      selection: context.assistantScope ? JSON.stringify(context.assistantSelection) : "",
      actor: context.assistantScope ? JSON.stringify(context.vibe64User) : "",
      connectionIdentity: context.assistantScope ? context.assistantAccess?.connectionIdentity : "",
      transportId: provider.transportId
    }));
    return attributed;
  }

  function trustedExecutionProfile(provider = {}, sessionId = "", value = null, context = {}) {
    const snapshot = vibe64AgentExecutionProfileAuditSnapshot(value);
    const provenance = verifiedExecutionProfiles.get(value);
    const normalizedSessionId = normalizeText(sessionId);
    if (
      !provenance ||
      provenance.providerId !== provider.id ||
      provenance.sessionBinding !== bindingTokens.get(bindingKey(normalizedSessionId, context)) ||
      provenance.sessionId !== normalizedSessionId ||
      provenance.transportId !== provider.transportId ||
      provenance.scope !== (context.assistantScope ? JSON.stringify(context.assistantScope) : "") ||
      context.assistantScope && (
        provenance.selection !== JSON.stringify(context.assistantSelection) ||
        provenance.actor !== JSON.stringify(context.vibe64User) ||
        provenance.connectionIdentity !== context.assistantAccess?.connectionIdentity
      )
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
    return Object.hasOwn(options, "vibe64User") ? options.vibe64User : currentProjectVibe64User() || null;
  }

  async function accessContext(provider = {}, sessionId = "", options = {}) {
    const vibe64User = await resolveAssistantUser(assistantUser(options));
    const assistantSelection = sessionAssistantSelection(options);
    const access = defineVibe64AssistantAccess(await readAssistantAccess({
      assistantSelection,
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      session: options.session || null,
      sessionId: normalizeText(sessionId),
      vibe64User
    }));
    return { vibe64User, access: Object.freeze({
      ...access,
      canUse: canUseVibe64Assistant(access, vibe64User),
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      transportId: provider.transportId
    }) };
  }

  async function accessFor(provider, sessionId, options) {
    return (await accessContext(provider, sessionId, options)).access;
  }

  async function requireAccessContext(provider = {}, sessionId = "", options = {}) {
    const context = await accessContext(provider, sessionId, options);
    const { access, vibe64User } = context;
    assertCanUseVibe64Assistant(access, vibe64User);
    if (options.expectedConnectionIdentity && access.connectionIdentity !== options.expectedConnectionIdentity) {
      throw Object.assign(new Error("The selected AI connection changed. Start a new request."), {
        code: "vibe64_assistant_connection_changed", statusCode: 409
      });
    }
    return context;
  }

  async function requireAccessFor(provider, sessionId, options) {
    return (await requireAccessContext(provider, sessionId, options)).access;
  }

  function goalOptions(options) {
    const pinned = JSON.parse(options.session?.metadata?.assistant_routing_goal || "null");
    if (!pinned?.selection || ["complete", "completed"].includes(pinned.status)) return options;
    const selection = defineVibe64AssistantSelection(pinned.selection);
    return { ...options, assistantSelection: selection, session: { ...options.session,
      metadata: { ...options.session.metadata, [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(selection) } } };
  }

  async function callSessionProvider(method = "", sessionId = "", input = {}, options = {}, {
    coalesceIdentity = ""
  } = {}) {
    let operationOptions = {
      ...options,
      agentSettings: options?.agentSettings || input?.agentSettings || null
    };
    if (AI_METHODS.has(method)) {
      requireCompletedNativeConversationReplacement(options.session, { requireBriefing: method === "startTerminal" });
    }
    if (["sendMessage", "startTerminal", "generateSessionRenewalHandover"].includes(method)) {
      requireCompletedConversationRewind(options.session);
    }
    const terminalId = normalizeText(input.terminalSessionId);
    const terminalBinding = terminalId ? terminalBindings.get(terminalId) : null;
    if (method === "writeTerminal" && (!terminalBinding || terminalBinding.invalidated ||
        terminalBinding.sessionId !== normalizeText(sessionId))) {
      throw Object.assign(new Error("Reopen the AI terminal before sending input. Its connection is no longer bound to this session."), {
        code: "vibe64_assistant_terminal_reopen_required", statusCode: 409
      });
    }
    const boundTerminal = terminalBinding?.sessionId === normalizeText(sessionId) && method.endsWith("Terminal");
    if (boundTerminal) {
      operationOptions = { ...operationOptions, session: null, assistantSelection: terminalBinding.selection,
        expectedConnectionIdentity: terminalBinding.connectionIdentity };
    }
    const provider = boundTerminal ? providerById.get(terminalBinding.providerId) : bindSession(sessionId, operationOptions);
    const operation = attachments?.[method] || provider[method];
    if (typeof operation !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    const authorization = AI_METHODS.has(method)
      ? await requireAccessContext(provider, sessionId, operationOptions)
      : null;
    const context = {
      agentSettings: operationOptions.agentSettings,
      assistantAccess: authorization?.access || null,
      assistantSelection: sessionAssistantSelection(operationOptions),
      assistantScope: operationOptions.assistantScope || null,
      onEvent: typeof operationOptions.onEvent === "function" ? operationOptions.onEvent : null,
      providerId: provider.id,
      runtime: operationOptions.runtime || null,
      routingConversationId: operationOptions.routingConversationId || "",
      session: operationOptions.session || null,
      sessionId: normalizeText(sessionId),
      signal: operationOptions.signal || null,
      transportId: provider.transportId,
      turnOwnership: operationOptions.turnOwnership || null,
      vibe64User: authorization ? authorization.vibe64User : assistantUser(operationOptions)
    };
    const run = async () => {
      const executionProfileRequest = method === "resolveExecutionProfile"
        ? defineVibe64AgentExecutionProfileRequest(input)
        : null;
      let providerInput = executionProfileRequest || input;
      if (method !== "resolveExecutionProfile" && hasOwn(input, "executionProfile")) {
        if (EXECUTION_PROFILE_RESOLUTION_METHODS.has(method) || context.assistantScope &&
            ["createConversation", "startConversationTurn"].includes(method)) {
          if (looksLikeExecutionProfileResolution(input.executionProfile)) {
            providerInput = {
              ...input,
              executionProfile: trustedExecutionProfile(
                provider,
                sessionId,
                input.executionProfile,
                context
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
      if (context.assistantScope && providerInput.executionProfile?.model &&
          providerInput.executionProfile.model !== context.assistantSelection?.modelId) {
        throw untrustedExecutionProfileResolutionError(provider, sessionId, { reason: "selection_changed" });
      }
      if (context.assistantScope && providerInput.executionProfile &&
          (providerInput.attachments?.length || providerInput.steer)) {
        throw new TypeError("Bounded helpers accept supplied text only; start a new request to change their input.");
      }
      if (attachments && !options.attachmentsPrepared && ["sendMessage", "startConversationTurn"].includes(method)) {
        providerInput = await attachments.prepareMessage(context, providerInput, { durable: method === "sendMessage" });
      }
      const result = await operation(context, providerInput);
      if (method === "startTerminal" && result?.ok !== false && normalizeText(result?.id)) {
        // A reused PTY keeps its original connection until explicitly closed.
        if (!terminalBindings.has(result.id)) {
          terminalBindings.set(result.id, { sessionId: context.sessionId, providerId: provider.id,
            selection: context.assistantSelection, connectionIdentity: context.assistantAccess.connectionIdentity });
        }
      }
      if (method === "closeTerminal" && result?.ok !== false) terminalBindings.delete(terminalId);
      return executionProfileRequest
        ? rememberVerifiedExecutionProfile(
            provider,
            sessionId,
            verifiedExecutionProfileResolution(provider, executionProfileRequest, result),
            context
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
      vibe64User: assistantUser(options)
    }, input, options));
  }

  async function routingSelectionAccess(assistantSelection, options = {}) {
    const provider = providerFor({ engineId: assistantSelection.engineId });
    const access = defineVibe64AssistantAccess(await Promise.resolve().then(() => readAssistantAccess({
      assistantSelection, engineId: provider.id, modelProviderId: assistantSelection.modelProviderId,
      session: options.session || null, sessionId: normalizeText(options.session?.sessionId || options.session?.id),
      vibe64User: assistantUser(options)
    })).catch(() => ({ available: false, ownerOnly: true, connectionIdentity: "" })));
    return { ...access, available: access.available && Boolean(access.connectionIdentity), engineId: provider.id, modelProviderId: assistantSelection.modelProviderId,
      modelId: assistantSelection.modelId };
  }

  function mergeRoutingCatalogPage(catalog, page, revisionError) {
    catalog ||= { ...page, modelProviders: [] };
    if (catalog.revision !== page.revision) throw new Error(revisionError);
    for (const row of page.modelProviders) {
      const existing = catalog.modelProviders.find(({ id }) => id === row.id);
      if (!existing) catalog.modelProviders.push({ ...row, models: [...row.models] });
      else for (const model of row.models) if (!existing.models.some(({ id }) => id === model.id)) existing.models.push(model);
    }
    return catalog;
  }

  async function resolvePurpose(input = {}, options = {}, facts = new Map()) {
    // One availability response shares connection/catalogue reads across its
    // purposes. The cache ends with that response; dispatch resolves afresh.
    const readFact = (key, operation) => {
      if (!facts.has(key)) facts.set(key, Promise.resolve().then(operation));
      return facts.get(key);
    };
    // Options are supplied by the server, never spread from a request body.
    // Preview and resumed work must retain their explicit actor even inside an
    // owner's request context. Provider execution still checks access itself.
    const actor = await resolveAssistantUser(assistantUser(options));
    options = { ...options, vibe64User: actor };
    const configuration = structuredClone(options.configuration || await readRoutingConfiguration?.());
    const { purpose, workflowEngineId, override, requirements, reviewEnabled } = input;
    const assignments = configuration?.orchestrators?.[workflowEngineId] || {};
    const role = ASSISTANT_PURPOSE_ROLES[purpose];
    const roles = purpose === "auto" ? ["senior", "junior", "router"]
      : ["senior", "junior"].includes(role) ? ["senior", "junior"] : role ? [role] : [];
    const selections = roles.map((key) => override?.role === key && purpose !== "auto"
      ? override.selection : assignments[key]).filter(Boolean);
    const connectionAccess = [];
    async function readSelectionAccess(assistantSelection) {
      const fact = { ...await readFact(`access:${JSON.stringify(assistantSelection)}`,
        () => routingSelectionAccess(assistantSelection, options)) };
      connectionAccess.push(fact);
      return fact;
    }
    const accessible = [];
    for (const selection of selections) {
      const fact = await readSelectionAccess(selection);
      if (canUseVibe64Assistant(fact, actor)) accessible.push(selection);
    }
    const needsBackup = connectionAccess.some((access) => !canUseVibe64Assistant({ ...access, available: true }, actor));
    if (needsBackup && assignments.sharedBackup) {
      const fact = await readSelectionAccess(assignments.sharedBackup);
      if (canUseVibe64Assistant(fact, actor)) accessible.push(assignments.sharedBackup);
    }
    const catalogs = [];
    const readCatalog = (provider, input) => readFact(`catalog:${provider.id}:${JSON.stringify(input)}`,
      () => providerCapabilities(provider, input, { vibe64User: actor }));
    for (const engineId of new Set(accessible.map((selection) => selection.engineId))) {
      const selectionsForEngine = accessible.filter((selection) => selection.engineId === engineId);
      const provider = providerFor({ engineId });
      try {
        if (engineId !== "opencode") {
          const providerIds = new Set(selectionsForEngine.map((selection) => selection.modelProviderId));
          catalogs.push(await readCatalog(provider, providerIds.size === 1
            ? { modelProviderId: selectionsForEngine[0].modelProviderId } : {}));
          continue;
        }
        // OpenCode's catalogue is paginated. Ask for each exact saved model,
        // then combine only pages from the same catalogue revision.
        let catalog;
        for (const selection of selectionsForEngine) {
          const page = await readCatalog(provider, { modelProviderId: selection.modelProviderId,
            modelId: selection.modelId, limit: "1" });
          catalog = mergeRoutingCatalogPage(catalog, page, "The model catalogue changed. Retry routing.");
        }
        catalogs.push(catalog);
      } catch {
        // An unreadable catalogue makes its destination unavailable. It must
        // not fail an independent role or turn a provider outage into Backup.
        for (const fact of connectionAccess) if (fact.engineId === engineId) fact.available = false;
      }
    }
    return resolveAssistantPurpose({ purpose, workflowEngineId, actor, configuration, catalogs,
      connectionAccess, override, requirements, reviewEnabled });
  }

  async function inspectAssistantPurposes(input = {}, options = {}) {
    const configuration = structuredClone(options.configuration || await readRoutingConfiguration?.());
    const facts = new Map();
    const purposes = [...Object.keys(ASSISTANT_PURPOSE_ROLES), "auto"];
    return Object.fromEntries(await Promise.all(purposes.map(async (purpose) => [purpose,
      await resolvePurpose({ purpose, workflowEngineId: input.workflowEngineId,
        reviewEnabled: input.review === true && purpose === "auto",
        ...(input.override && purpose === input.mode
          ? { override: { role: input.mode, selection: input.override } } : {})
      }, { ...options, configuration }, facts)
    ])));
  }

  async function inspectWorkflowChoices(configuration, options) {
    const engineLabel = (id) => VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === id)?.label || id;
    const actor = await resolveAssistantUser(assistantUser(options));
    options = { ...options, vibe64User: actor };
    const access = new Map();
    const readAccess = (selection) => {
      const key = JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]);
      if (!access.has(key)) access.set(key, routingSelectionAccess(selection, options));
      return access.get(key);
    };
    const needsSetup = (engineId) => !["senior", "junior"].every((role) =>
      Object.hasOwn(configuration.orchestrators[engineId] || {}, role));
    const errors = new Map();
    const catalogs = [...providerById.keys()].some(needsSetup) ? (await Promise.all([...providerById.values()].map(async (provider) => {
      try { return await providerCapabilities(provider, { configuredOnly: "true" }, options); }
      catch (cause) { errors.set(provider.id, cause.message); return null; }
    }))).filter(Boolean) : [];
    const defaultAccess = await Promise.all(catalogs.flatMap((catalog) => routingModelChoices(catalog)).map(readAccess));
    const workflows = await Promise.all([...providerById.values()].map(async (provider) => {
      const saved = configuration.orchestrators[provider.id] || {};
      const assignments = { ...saved };
      const error = needsSetup(provider.id) ? errors.get(provider.id) || "" : "";
      // First use still offers connected assistants (including included OpenCode).
      // Only configured defaults are read; creation discovers and saves full recommendations.
      if (needsSetup(provider.id) && !error) {
        const catalog = catalogs.find(({ engineId }) => engineId === provider.id);
        const recommended = recommendedRoutingAssignments(catalog, { catalogs, assignments, connectionAccess: defaultAccess });
        for (const role of ["senior", "junior", "sharedBackup"]) {
          if (!Object.hasOwn(saved, role) && recommended[role]) assignments[role] = recommended[role];
        }
      }
      if (!Object.keys(saved).length && !assignments.senior && !assignments.junior && !error) return null;
      const connectionAccess = await Promise.all([assignments.senior, assignments.junior, assignments.sharedBackup].filter(Boolean).map(readAccess));
      const previewConfiguration = { ...configuration, orchestrators: { ...configuration.orchestrators, [provider.id]: assignments } };
      const decision = resolveAssistantPurpose({ purpose: "senior", workflowEngineId: provider.id, actor,
        configuration: previewConfiguration, connectionAccess, validateModels: false });
      const modelLabel = (role) => {
        const selection = decision.seniorJuniorPair?.[role]?.effectiveSelection || saved[role];
        if (!Object.hasOwn(saved, role)) return "Recommended on creation";
        return selection ? `${engineLabel(selection.engineId)} · ${selection.modelId}` : "Not configured";
      };
      return { engineId: provider.id, label: engineLabel(provider.id),
        seniorLabel: modelLabel("senior"), juniorLabel: modelLabel("junior"),
        backupUsed: Object.values(decision.seniorJuniorPair || {}).some((role) => role.backupUsed),
        available: !error && decision.available, error: error || decision.message };
    }));
    return { workflows: workflows.filter(Boolean) };
  }

  async function inspectRoutingConfiguration(configuration, options = {}) {
    if (options.workflowsOnly === true) return inspectWorkflowChoices(configuration, options);
    const catalogs = [];
    const catalogErrors = new Map();
    const connectedEngineIds = new Set();
    for (const provider of providerById.values()) {
      try {
        let catalog;
        async function pages(input = {}) {
          let cursor = "";
          const seen = new Set();
          do {
            if (seen.has(cursor)) throw new Error("The model catalogue did not advance. Reload routing.");
            seen.add(cursor);
            const page = await providerCapabilities(provider, { connectedOnly: "true", limit: "200", ...input, cursor }, options);
            if (page.modelProviders.some(({ connected }) => connected)) connectedEngineIds.add(provider.id);
            catalog = mergeRoutingCatalogPage(catalog, page, "The model catalogue changed. Reload routing.");
            cursor = page.page.hasMore ? page.page.nextCursor : "";
            if (page.page.hasMore && !cursor) throw new Error("The model catalogue page is incomplete. Reload routing.");
          } while (cursor);
        }
        await pages();
        if (provider.id === "opencode") {
          for (const row of catalog.modelProviders.filter(({ connected }) => connected)) await pages({ modelProviderId: row.id });
        }
        catalogs.push(catalog);
      } catch (error) { catalogErrors.set(provider.id, error.message); }
    }
    const routeKey = (selection) => JSON.stringify([selection.engineId, selection.modelProviderId, selection.modelId]);
    const selections = new Map(catalogs.flatMap((engine) => routingModelChoices(engine, { purpose: "request_routing" }))
      .map((selection) => [routeKey(selection), selection]));
    for (const assignments of Object.values(configuration.orchestrators)) {
      for (const role of ASSISTANT_ROUTING_ASSIGNMENTS) {
        if (assignments[role]) selections.set(routeKey(assignments[role]), assignments[role]);
      }
    }
    const access = new Map();
    for (const [key, selection] of selections) access.set(key, await routingSelectionAccess(selection, options));
    const connectionAccess = [...access.values()];
    // Illustrative actors affect only these read-only decisions. They never enter
    // a provider execution context. Preview uses the same policy as admission.
    const preview = (workflowEngineId, actor, previewConfiguration = configuration) => Object.fromEntries(
      ["senior", "junior", "intern", "prompt_hint", "request_routing", "review", "auto"].map((purpose) => {
        const decision = resolveAssistantPurpose({ purpose, workflowEngineId, actor, configuration: previewConfiguration, catalogs, connectionAccess });
        return [purpose, JSON.parse(JSON.stringify(decision, (key, value) =>
          ["connectionIdentity", "routerConnectionIdentity"].includes(key) ? undefined : value))];
      })
    );
    const engineIds = new Set([...connectedEngineIds, ...Object.keys(configuration.orchestrators).filter((engineId) => {
      const saved = configuration.orchestrators[engineId];
      return ASSISTANT_ROUTING_ASSIGNMENTS.some((role) => saved[role]) || saved.helperRoutingReview;
    })]);
    return { engines: [...engineIds].map((engineId) => {
      const engine = catalogs.find((entry) => entry.engineId === engineId);
      const assignments = configuration.orchestrators[engineId] || {};
      const recommendations = recommendedRoutingAssignments(engine, { catalogs, assignments, connectionAccess });
      const setupAssignments = { ...assignments };
      // Explicit setup fills only absent roles. An explicit null stays disabled.
      if (!catalogErrors.has(engineId) && recommendations.senior && recommendations.junior) {
        for (const role of ASSISTANT_ROUTING_ASSIGNMENTS) {
          if (!Object.hasOwn(setupAssignments, role) && recommendations[role]) {
            setupAssignments[role] = recommendations[role];
          }
        }
      }
      const setupConfiguration = { ...configuration,
        orchestrators: { ...configuration.orchestrators, [engineId]: setupAssignments } };
      const roles = Object.fromEntries(ASSISTANT_ROUTING_ASSIGNMENTS.map((role) => {
        const purpose = role === "router" ? "request_routing" : role === "sharedBackup" ? "junior" : role;
        const candidates = ["senior", "junior"].includes(role) ? (engine ? [engine] : []) : catalogs;
        const choices = candidates.flatMap((catalog) => routingModelChoices(catalog, { purpose }).map((choice) => {
          const fact = access.get(routeKey(choice));
          return { ...choice, engineLabel: catalog.label, ownerOnly: fact?.ownerOnly !== false,
            accessLabel: fact?.accessLabel || "Unavailable", available: fact?.available === true && Boolean(fact.connectionIdentity) };
        })).filter((choice) => role !== "sharedBackup" || !choice.ownerOnly);
        const assignment = assignments[role] || null;
        let error = "";
        if (assignment) {
          try {
            if (["senior", "junior"].includes(role) && assignment.engineId !== engineId) throw new Error("Senior and Junior must use the workflow orchestrator.");
            routingAssignmentSelection(catalogs.find((row) => row.engineId === assignment.engineId), assignment, { purpose });
            const choice = choices.find((row) => routeKey(row) === routeKey(assignment));
            if (!choice?.available) throw new Error(role === "sharedBackup" ? "Choose an available workspace connection for Shared backup." : "The selected AI connection is unavailable.");
            if (["junior", "sharedBackup"].includes(role) && choice.capabilities?.toolcall === false) throw new Error("Choose a model that supports coding tools.");
          } catch (cause) { error = cause.message; }
        }
        return [role, { assignment, recommendation: recommendations[role], choices, error }];
      }));
      return { engineId, label: engine?.label || engineId, connected: connectedEngineIds.has(engineId), roles, choices: roles.senior.choices,
        setupAssignments, setupPreview: preview(engineId, assistantUser(options), setupConfiguration),
        error: catalogErrors.get(engineId) || "", helperRoutingReview: assignments.helperRoutingReview || null,
        preview: { viewer: preview(engineId, assistantUser(options)), ...(options.includeCollaboratorPreview ? {
          owner: preview(engineId, { role: "owner" }), collaborator: preview(engineId, { role: "member" })
        } : {}) } };
    }) };
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
        assistantScope,
        routingConversationId: "",
        runtime: null,
        session: null
      });
    };
  }

  async function deleteEphemeralConversation(scope = {}, input = {}, options = {}) {
    const assistantScope = defineEphemeralAssistantScope(scope);
    const result = await callSessionProvider(
      input.conversationId || input.threadId ? "deleteConversation" : "closeSession",
      assistantScope.id,
      input,
      { ...options, assistantScope, routingConversationId: "", runtime: null, session: null }
    );
    if (result?.ok !== false) {
      bindings.delete(assistantScope.id);
      bindingTokens.delete(assistantScope.id);
    }
    return result;
  }

  async function runEphemeralChatTurn(scope = {}, input = {}, options = {}) {
    // Bounded features keep their own task/cache and cleanup reference. Compose
    // the existing scoped lifecycle without binding the working conversation.
    const executionProfile = input.executionProfile;
    if (!executionProfile) throw new TypeError("A bounded assistant turn requires an execution profile.");
    const profileSnapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
    const request = { ...input, ephemeral: true, message: input.prompt || input.message };
    options.signal?.throwIfAborted();
    let conversationId = normalizeText(input.conversationId || input.threadId);
    if (!conversationId) {
      const created = await ephemeralScopeMethod("createConversation")(scope, request, options);
      if (created?.ok === false) return created;
      conversationId = normalizeText(created.conversationId);
      if (!conversationId) throw new Error("The helper did not return its conversation identity.");
    }
    // Await ownership before starting: Stop or a failed parent write must not
    // leave an unidentified native turn running.
    await options.onEvent?.({ type: "thread", threadId: conversationId });
    options.signal?.throwIfAborted();
    const started = await ephemeralScopeMethod("startConversationTurn")(scope, { ...request, conversationId }, options);
    if (started?.ok === false) return { ...started, threadId: conversationId };
    const runId = normalizeText(started.runId);
    await options.onEvent?.({ type: "turn", threadId: conversationId, turnId: runId, status: started.status });
    if (options.signal?.aborted) {
      const stopped = await ephemeralScopeMethod("stopConversation")(scope, { ...request, conversationId, runId }, options);
      if (stopped?.ok === false) return { ...stopped, threadId: conversationId, turnId: runId };
      options.signal.throwIfAborted();
    }
    let stop;
    const interrupt = () => {
      stop ||= ephemeralScopeMethod("stopConversation")(scope, { ...request, conversationId, runId }, options);
      void stop.catch(() => {});
    };
    options.signal?.addEventListener("abort", interrupt, { once: true });
    let result;
    let failure;
    try {
      result = await ephemeralScopeMethod("waitForConversationTurn")(scope, { ...request, conversationId, runId }, options);
      options.signal?.throwIfAborted();
    } catch (error) { failure = error; }
    finally {
      options.signal?.removeEventListener("abort", interrupt);
    }
    try {
      const stopped = await stop;
      if (stopped?.ok === false) throw Object.assign(new Error(stopped.error || "The helper could not confirm a stop."), { code: stopped.code });
    } catch (error) {
      if (failure && error !== failure) error.cause = failure;
      failure = error;
    }
    if (failure) throw failure;
    return { ...result, threadId: conversationId, turnId: runId,
      text: result.rawText || result.text || result.message || "", executionProfile: profileSnapshot,
      ...(["failed", "cancelled", "interrupted"].includes(result.status) ? { ok: false,
        error: result.error || "The helper stopped before completing its answer." } : {}) };
  }

  async function closeSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    const provider = bindSession(id, options);
    const context = {
      changeover: options.changeover === true,
      forgetConversationBinding: options.forgetConversationBinding === true,
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
      for (const [terminalId, terminal] of terminalBindings) {
        if (terminal.sessionId === id && terminal.providerId === provider.id) terminalBindings.delete(terminalId);
      }
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
    resolveAssistantPurpose: resolvePurpose,
    inspectRoutingConfiguration,
    inspectAssistantPurposes,
    async readPlanUsage(sessionId, options = {}) {
      const provider = bindSession(sessionId, options);
      const access = await accessFor(provider, sessionId, options);
      if (typeof provider.readPlanUsage !== "function" || !access.canUse || !access.ownerOnly) {
        return { status: "unsupported", windows: [] };
      }
      return provider.readPlanUsage({ sessionId, runtime: options.runtime, session: options.session });
    },
    async readGoal(sessionId, options = {}) {
      options = goalOptions(options);
      const provider = providerFor({ ...options, providerId: sessionAgentProviderId(options,
        bindings.get(bindingKey(sessionId, options)) || defaultProviderId) });
      if (typeof provider.readGoal !== "function") {
        return { status: "unsupported", goal: null };
      }
      return provider.readGoal({ sessionId, runtime: options.runtime, session: options.session,
        assistantSelection: sessionAssistantSelection(options), vibe64User: assistantUser(options) });
    },
    // Local storage work is explicitly invoked by trusted host code. It neither
    // selects the current assistant nor authorizes a model inference.
    retireConversationHistory(sessionId, binding, options = {}) {
      const provider = providerById.get(binding.engineId);
      if (typeof provider?.retireConversationHistory !== "function") throw new TypeError("Native history retirement is unavailable for this engine.");
      return provider.retireConversationHistory({ ...options, sessionId }, binding);
    },
    listNativeConversationStorage(sessionId, binding, options = {}) {
      const provider = providerById.get(binding.engineId);
      if (typeof provider?.listNativeConversationStorage !== "function") throw new TypeError("Native history inventory is unavailable for this engine.");
      return provider.listNativeConversationStorage({ ...options, sessionId }, binding);
    },
    async updateGoal(sessionId, input = {}, options = {}) {
      const stopping = ["pause", "cancel"].includes(input.action);
      if (!stopping) requireCompletedNativeConversationReplacement(options.session, { requireBriefing: true });
      if (stopping) options = goalOptions(options);
      const provider = stopping
        ? providerFor({ ...options, providerId: sessionAgentProviderId(options,
          bindings.get(bindingKey(sessionId, options)) || defaultProviderId) })
        : bindSession(sessionId, options);
      const authorization = stopping ? null : await requireAccessContext(provider, sessionId, options);
      if (typeof provider.updateGoal !== "function") {
        throw new TypeError("This assistant does not support goal controls.");
      }
      return provider.updateGoal({ sessionId, runtime: options.runtime, session: options.session,
        assistantSelection: sessionAssistantSelection(options), vibe64User: authorization ? authorization.vibe64User : assistantUser(options) }, input);
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
      return requireAccessFor(providerFor({ engineId: selection.engineId }), "", selectionOptions);
    },
    binding(sessionId = "", options = {}) {
      return bindings.get(bindingKey(sessionId, options)) || "";
    },
    async closeProject(input = {}, options = {}) {
      const result = await callAllProviders("closeProject", input, options);
      if (result?.ok !== false) {
        const providerId = sessionAgentProviderId(options);
        for (const [terminalId, terminal] of terminalBindings) {
          if ((!providerId || terminal.providerId === providerId) &&
              (!input.modelProviderId || terminal.selection?.modelProviderId === input.modelProviderId)) {
            terminalBindings.delete(terminalId);
          }
        }
      }
      return result;
    },
    closeSession,
    closeTerminal: sessionMethod("closeTerminal"),
    createConversation: sessionMethod("createConversation"),
    createEphemeralConversation: ephemeralScopeMethod("createConversation"),
    resolveEphemeralExecutionProfile: ephemeralScopeMethod("resolveExecutionProfile"),
    async deleteConversation(sessionId, input = {}, options = {}) {
      const result = await callSessionProvider("deleteConversation", sessionId, input, options);
      if (result?.ok !== false && options.routingConversationId) {
        const key = bindingKey(sessionId, options);
        bindings.delete(key);
        bindingTokens.delete(key);
      }
      return result;
    },
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
    rewindConversation: sessionMethod("rewindConversation"),
    readEphemeralConversation: ephemeralScopeMethod("readConversation"),
    resolveExecutionProfile: sessionMethod("resolveExecutionProfile"),
    readTerminal(sessionId = "", terminalSessionId = "", options = {}) {
      return callSessionProvider("readTerminal", sessionId, { terminalSessionId }, options);
    },
    resizeTerminal(sessionId = "", terminalSessionId = "", size = {}, options = {}) {
      return callSessionProvider("resizeTerminal", sessionId, { size, terminalSessionId }, options);
    },
    runDetachedChatTurn: sessionMethod("runDetachedChatTurn"),
    runEphemeralChatTurn,
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
