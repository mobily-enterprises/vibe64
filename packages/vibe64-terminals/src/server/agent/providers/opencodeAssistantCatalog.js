import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS
} from "@local/vibe64-runtime/shared";

const OPENCODE_CAPABILITY_PAGE_LIMIT = 25;
const OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM = 100;
const OPENCODE_ZEN_PROVIDER_ID = "opencode";

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function modelTokenLimit(value) {
  const limit = Number(value);
  return Number.isSafeInteger(limit) ? limit : 0;
}

function pageLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM)
    : OPENCODE_CAPABILITY_PAGE_LIMIT;
}

function decodedCursor(value = "", kind = "providers", modelProviderId = "") {
  const cursor = text(value);
  if (!cursor) {
    return 0;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded?.kind !== kind ||
      text(decoded?.modelProviderId) !== text(modelProviderId) ||
      !Number.isSafeInteger(decoded?.offset) ||
      decoded.offset < 0
    ) {
      throw new Error("cursor mismatch");
    }
    return decoded.offset;
  } catch {
    const error = new Error("The assistant catalog cursor is invalid for this request.");
    error.code = "vibe64_assistant_catalog_cursor_invalid";
    error.statusCode = 400;
    throw error;
  }
}

function encodedCursor(offset = 0, kind = "providers", modelProviderId = "") {
  return Buffer.from(JSON.stringify({
    kind,
    modelProviderId: text(modelProviderId),
    offset
  })).toString("base64url");
}

function normalizedConnections(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.connections) ? value.connections : [];
  return rows
    .map((connection) => typeof connection === "string"
      ? {
          accessLabel: "",
          billingLabel: "",
          builtIn: false,
          connected: true,
          defaultModelId: "",
          fingerprint: "",
          id: text(connection),
          label: text(connection),
          modelAccess: null,
          preferred: false,
          providerRevision: ""
        }
      : {
          accessLabel: text(connection?.accessLabel),
          billingLabel: text(connection?.billingLabel),
          builtIn: connection?.builtIn === true,
          connected: connection?.connected !== false,
          defaultModelId: text(connection?.defaultModelId || connection?.defaultModelId),
          fingerprint: text(connection?.fingerprint),
          id: text(connection?.modelProviderId || connection?.providerId || connection?.id),
          label: text(connection?.productLabel || connection?.label),
          modelAccess: record(connection?.modelAccess),
          preferred: connection?.preferred === true,
          providerRevision: text(connection?.providerRevision)
        })
    .filter((connection) => connection.id);
}

function openCodeConfiguredAssistantCapabilities({ connections = [] } = {}) {
  const providers = normalizedConnections(connections)
    .filter((connection) => connection.connected && connection.defaultModelId)
    .sort((left, right) => Number(right.preferred) - Number(left.preferred) ||
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    .map((connection) => ({
      apiKeyCompatible: true,
      builtIn: connection.builtIn,
      connected: true,
      connectionMessage: "",
      connectionStatus: "connected",
      defaultModelId: connection.defaultModelId,
      definitionRevision: connection.providerRevision,
      description: [connection.billingLabel, connection.accessLabel].filter(Boolean).join(" · "),
      id: connection.id,
      label: connection.label || connection.id,
      modelAccess: connection.modelAccess,
      models: [{
        capabilities: {},
        description: "Saved default model",
        id: connection.defaultModelId,
        label: connection.defaultModelId,
        status: "available",
        variants: []
      }],
      preferred: connection.preferred
    }));
  const defaultProvider = providers[0] || null;
  const revision = `sha256:${createHash("sha256").update(JSON.stringify(
    normalizedConnections(connections).map((connection) => ({
      defaultModelId: connection.defaultModelId,
      builtIn: connection.builtIn,
      fingerprint: connection.fingerprint,
      id: connection.id,
      modelAccess: connection.modelAccess,
      preferred: connection.preferred,
      providerRevision: connection.providerRevision
    }))
  )).digest("hex")}`;
  return {
    agents: [{
      description: "OpenCode coding agent",
      id: "build",
      label: "Build",
      mode: "primary"
    }],
    authentication: {
      management: "account-owner",
      modes: ["api-key"]
    },
    defaults: {
      agentId: defaultProvider ? "build" : "",
      modelId: defaultProvider?.defaultModelId || "",
      modelProviderId: defaultProvider?.id || "",
      variantId: ""
    },
    engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    health: {
      message: defaultProvider ? "" : "Connect an OpenCode AI before starting a session.",
      status: defaultProvider ? "ready" : "unavailable"
    },
    label: "OpenCode",
    modelProviders: providers,
    page: {
      cursor: "",
      hasMore: false,
      kind: "providers",
      limit: providers.length,
      nextCursor: "",
      search: "",
      total: providers.length
    },
    revision,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER
  };
}

function modelVariants(model = {}) {
  return Object.keys(record(model.variants))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({
      id,
      label: id.replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase())
    }));
}

function normalizedModel(model = {}) {
  const id = text(model.id);
  const status = text(model.status);
  return {
    capabilities: {
      attachment: model.capabilities?.attachment === true,
      contextWindow: modelTokenLimit(model.limit?.context),
      input: { ...record(model.capabilities?.input) },
      maxOutputTokens: modelTokenLimit(model.limit?.output),
      output: { ...record(model.capabilities?.output) },
      reasoning: model.capabilities?.reasoning === true,
      toolcall: model.capabilities?.toolcall === true
    },
    description: [text(model.family), text(model.release_date)].filter(Boolean).join(" · "),
    id,
    label: text(model.name) || id,
    status: status === "deprecated" ? "unavailable" : "available",
    variants: modelVariants(model)
  };
}

function normalizedProvider(
  provider = {},
  connectionById = new Map(),
  defaultModelId = "",
  currentModelIds = null
) {
  const id = text(provider.id);
  const connection = connectionById.get(id);
  const modelAccess = record(connection?.modelAccess);
  const recommendedModelId = text(modelAccess.recommendedModelId);
  const accessRestricted = ["recommended", "verified"].includes(text(modelAccess.mode));
  const enabledModelIds = new Set((Array.isArray(modelAccess.enabledModelIds)
    ? modelAccess.enabledModelIds
    : []).map(text).filter(Boolean));
  if (recommendedModelId) {
    enabledModelIds.add(recommendedModelId);
  }
  const upstreamModels = Object.values(record(provider.models))
    .map(normalizedModel)
    .filter((model) => model.id)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const upstreamModelById = new Map(upstreamModels.map((model) => [model.id, model]));
  const currentModels = currentModelIds instanceof Set
    ? [...currentModelIds]
      .map((modelId) => upstreamModelById.get(modelId) || normalizedModel({
        id: modelId,
        name: modelId,
        status: "active"
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id))
    : upstreamModels;
  const models = currentModels.map((model) => (
    accessRestricted && !enabledModelIds.has(model.id) && model.status === "available"
      ? {
        ...model,
        lockMessage: text(modelAccess.warning) || "This model needs additional provider access.",
        status: "locked"
      }
      : model
  ));
  const upstreamDefaultModelId = text(defaultModelId);
  const configuredDefaultModelId = text(connection?.defaultModelId);
  const requestedDefaultModelId = accessRestricted
    ? recommendedModelId
    : configuredDefaultModelId || upstreamDefaultModelId;
  const resolvedDefaultModelId = models.some((model) => (
    model.id === requestedDefaultModelId && model.status === "available"
  )) ? requestedDefaultModelId : "";
  const definitionDefaultModelId = upstreamModels.some((model) => (
    model.id === upstreamDefaultModelId && model.status === "available"
  )) ? upstreamDefaultModelId : "";
  const definitionRevision = `sha256:${createHash("sha256").update(JSON.stringify({
    apiKeyCompatible: provider.apiKeyCompatible === true,
    defaultModelId: definitionDefaultModelId,
    id,
    models: upstreamModels.map((model) => ({
      capabilities: model.capabilities,
      id: model.id,
      status: model.status,
      variants: model.variants.map((variant) => variant.id)
    }))
  })).digest("hex")}`;
  const stale = Boolean(
    connection &&
    connection.builtIn !== true &&
    id !== OPENCODE_ZEN_PROVIDER_ID &&
    connection.providerRevision !== definitionRevision
  );
  return {
    apiKeyCompatible: provider.apiKeyCompatible === true,
    builtIn: connection?.builtIn === true,
    connected: Boolean(connection) && !stale,
    connectionMessage: stale
      ? "This provider changed since its key was confirmed. Reconfirm the connection before use."
      : "",
    connectionStatus: stale ? "reconfirmation-required" : connection ? "connected" : "disconnected",
    defaultModelId: resolvedDefaultModelId,
    definitionRevision,
    description: "OpenCode provider",
    id,
    label: text(provider.name) || id,
    modelAccess,
    models,
    preferred: connection?.preferred === true
  };
}

function normalizedAgent(agent = {}) {
  const mode = text(agent.mode);
  if (agent.hidden === true || !["all", "primary"].includes(mode)) {
    return null;
  }
  return {
    description: text(agent.description),
    id: text(agent.name),
    label: text(agent.name).replaceAll("-", " ").replace(/^./u, (character) => character.toUpperCase()),
    mode,
    modelId: text(agent.model?.modelID),
    modelProviderId: text(agent.model?.providerID),
    variantId: text(agent.variant)
  };
}

function searchable(value = "", search = "") {
  return !search || String(value || "").toLocaleLowerCase().includes(search);
}

function openCodeAssistantCapabilities({
  agents: agentRows = [],
  connections = [],
  input = {},
  providers: providerResult = {},
  zenModelIds = null
} = {}) {
  const normalizedConnectionRows = normalizedConnections(connections);
  const connectionById = new Map(normalizedConnectionRows.map((connection) => [connection.id, connection]));
  const currentZenModelIds = Array.isArray(zenModelIds)
    ? new Set(zenModelIds.map(text).filter(Boolean))
    : null;
  const providers = (Array.isArray(providerResult?.all) ? providerResult.all : [])
    .map((provider) => normalizedProvider(
      provider,
      connectionById,
      providerResult?.default?.[text(provider?.id)],
      text(provider?.id) === "opencode" ? currentZenModelIds : null
    ))
    .filter((provider) => provider.id)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const agents = (Array.isArray(agentRows) ? agentRows : [])
    .map(normalizedAgent)
    .filter(Boolean)
    .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  const requestedProviderId = text(input.modelProviderId);
  const connectedOnly = text(input.connectedOnly).toLowerCase() === "true";
  const search = text(input.search).toLocaleLowerCase();
  const kind = requestedProviderId ? "models" : "providers";
  const limit = pageLimit(input.limit);
  const offset = decodedCursor(input.cursor, kind, requestedProviderId);
  const defaultProvider = providers.find((provider) => provider.connected && provider.preferred) ||
    providers.find((provider) => provider.connected) || null;
  const upstreamDefaultModelId = text(defaultProvider?.defaultModelId);
  const defaultModel = defaultProvider?.models.find((model) => (
    model.id === upstreamDefaultModelId && model.status === "available"
  )) || defaultProvider?.models.find((model) => model.status === "available") || null;
  const defaultAgent = agents.find((agent) => (
    (!agent.modelProviderId || agent.modelProviderId === defaultProvider?.id) &&
    (!agent.modelId || agent.modelId === defaultModel?.id)
  )) || null;
  const selectableProviders = connectedOnly
    ? providers.filter((provider) => provider.connected)
    : providers;
  const hasConnectedProvider = providers.some((provider) => provider.connected);

  let pageProviders;
  let total;
  if (requestedProviderId) {
    const provider = selectableProviders.find((candidate) => candidate.id === requestedProviderId);
    const requestedModelId = text(input.modelId);
    const filteredModels = (provider?.models || []).filter((model) => (
      (!requestedModelId || model.id === requestedModelId) &&
      searchable(`${model.label}\n${model.id}\n${model.description}`, search)
    ));
    total = filteredModels.length;
    pageProviders = provider ? [{
      ...provider,
      models: filteredModels.slice(offset, offset + limit)
    }] : [];
  } else {
    const filteredProviders = selectableProviders.filter((provider) => searchable(
      `${provider.label}\n${provider.id}\n${provider.description}`,
      search
    ));
    total = filteredProviders.length;
    pageProviders = filteredProviders.slice(offset, offset + limit).map((provider) => ({
      ...provider,
      models: provider.id === defaultProvider?.id ? provider.models.slice(0, limit) : []
    }));
  }

  const revisionSource = {
    agents,
    connections: normalizedConnectionRows
      .map((connection) => JSON.stringify({
        builtIn: connection.builtIn,
        fingerprint: connection.fingerprint,
        id: connection.id,
        modelAccess: connection.modelAccess,
        preferred: connection.preferred,
        providerRevision: connection.providerRevision
      }))
      .sort(),
    providers: providers.map((provider) => ({
      apiKeyCompatible: provider.apiKeyCompatible,
      defaultModelId: provider.defaultModelId,
      id: provider.id,
      models: provider.models.map((model) => ({
        capabilities: model.capabilities,
        id: model.id,
        status: model.status,
        variants: model.variants.map((variant) => variant.id)
      }))
    }))
  };
  const revision = `sha256:${createHash("sha256").update(JSON.stringify(revisionSource)).digest("hex")}`;
  const nextOffset = offset + pageProviders.reduce((count, provider) => (
    count + (kind === "models" ? provider.models.length : 1)
  ), 0);
  const hasMore = nextOffset < total;
  return {
    agents,
    authentication: {
      management: "account-owner",
      modes: ["api-key"]
    },
    defaults: {
      agentId: defaultAgent?.id || "",
      modelId: defaultModel?.id || "",
      modelProviderId: defaultProvider?.id || "",
      variantId: defaultAgent?.variantId || ""
    },
    engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    health: {
      message: hasConnectedProvider
        ? ""
        : "Connect an API-key provider before starting an OpenCode session.",
      status: hasConnectedProvider ? "ready" : "unavailable"
    },
    label: "OpenCode",
    modelProviders: pageProviders,
    page: {
      cursor: text(input.cursor),
      hasMore,
      kind,
      limit,
      nextCursor: hasMore ? encodedCursor(nextOffset, kind, requestedProviderId) : "",
      search: text(input.search),
      total
    },
    revision,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER
  };
}

export {
  OPENCODE_CAPABILITY_PAGE_LIMIT,
  OPENCODE_CAPABILITY_PAGE_LIMIT_MAXIMUM,
  openCodeAssistantCapabilities,
  openCodeConfiguredAssistantCapabilities
};
