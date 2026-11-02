import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObject, toText } from "@jskit-ai/kernel/shared/support/normalize";

const VIBE64_ASSISTANT_ENGINE_IDS = Object.freeze({
  CLAUDE: "claude",
  CODEX: "codex",
  OPENCODE: "opencode"
});

const VIBE64_ASSISTANT_TRANSPORT_IDS = Object.freeze({
  CLAUDE_STREAM_JSON: "claude_stream_json",
  CODEX_APP_SERVER: "codex_app_server",
  OPENCODE_SERVER: "opencode_server"
});

const VIBE64_ASSISTANT_SELECTION_SCHEMA = "vibe64.assistant-selection.v1";
const VIBE64_ASSISTANT_CAPABILITIES_SCHEMA = "vibe64.assistant-capabilities.v1";
const VIBE64_ASSISTANT_SELECTION_METADATA = "assistant_selection";
const VIBE64_ASSISTANT_CATALOG_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VIBE64_ASSISTANT_ENGINE_ID_SET = new Set(Object.values(VIBE64_ASSISTANT_ENGINE_IDS));

const VIBE64_ASSISTANT_SELECTION_ERROR_CODES = Object.freeze({
  CATALOG_STALE: "vibe64_assistant_catalog_stale",
  CONNECTION_REQUIRED: "vibe64_assistant_connection_required",
  ENGINE_IMMUTABLE: "vibe64_assistant_engine_immutable",
  INVALID: "vibe64_assistant_selection_invalid",
  TURN_ACTIVE: "vibe64_assistant_selection_turn_active",
  UNAVAILABLE: "vibe64_assistant_selection_unavailable"
});

/**
 * A selection refusal the caller sees: a 409 whose details name the field or
 * catalogue revision it concerns.
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
function selectionError(code, message, details = {}) {
  return new AppError(409, message, { code, details: Object.freeze({ ...details }) });
}

function containsControlCharacter(value = "") {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
}

function boundedIdentifier(value, field, options = {}) {
  const {
    allowEmpty = false,
    maxLength = 512
  } = options;
  const normalized = toText(value);
  if (
    (!normalized && !allowEmpty) ||
    normalized.length > maxLength ||
    containsControlCharacter(normalized)
  ) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      `Assistant ${field} is invalid.`,
      { field }
    );
  }
  return normalized;
}

function catalogRevision(value, field = "catalogRevision") {
  const revision = toText(value);
  if (!VIBE64_ASSISTANT_CATALOG_REVISION_PATTERN.test(revision)) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      "Assistant catalog revision is invalid.",
      { field }
    );
  }
  return revision;
}

function defineVibe64AssistantSelection(value = {}) {
  const input = normalizeObject(value);
  const engineId = boundedIdentifier(input.engineId, "engineId", { maxLength: 64 });
  if (!VIBE64_ASSISTANT_ENGINE_ID_SET.has(engineId)) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      `Unknown assistant engine: ${engineId}.`,
      { engineId, field: "engineId" }
    );
  }
  const schema = toText(input.schema) || VIBE64_ASSISTANT_SELECTION_SCHEMA;
  if (schema !== VIBE64_ASSISTANT_SELECTION_SCHEMA) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      "Assistant selection schema is unsupported.",
      { field: "schema", schema }
    );
  }
  return Object.freeze({
    agentId: boundedIdentifier(input.agentId, "agentId", { maxLength: 256 }),
    catalogRevision: catalogRevision(input.catalogRevision),
    engineId,
    modelId: boundedIdentifier(input.modelId, "modelId"),
    modelProviderId: boundedIdentifier(input.modelProviderId, "modelProviderId", {
      maxLength: 256
    }),
    schema,
    variantId: boundedIdentifier(input.variantId, "variantId", {
      allowEmpty: true,
      maxLength: 256
    })
  });
}

function serializeVibe64AssistantSelection(value = {}) {
  return JSON.stringify(defineVibe64AssistantSelection(value));
}

function vibe64AssistantSelectionFromMetadata(metadata = {}, options = {}) {
  const {
    required = true
  } = options;
  const raw = toText(normalizeObject(metadata)[VIBE64_ASSISTANT_SELECTION_METADATA]);
  if (!raw && required !== true) {
    return null;
  }
  if (!raw) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      "This session has no durable assistant selection.",
      { field: VIBE64_ASSISTANT_SELECTION_METADATA }
    );
  }
  try {
    return defineVibe64AssistantSelection(JSON.parse(raw));
  } catch (error) {
    if (error?.code === VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID) {
      throw error;
    }
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.INVALID,
      "This session's durable assistant selection is unreadable.",
      { field: VIBE64_ASSISTANT_SELECTION_METADATA }
    );
  }
}

function normalizedVariant(value = {}) {
  const input = normalizeObject(value);
  const id = boundedIdentifier(input.id, "variant.id", { maxLength: 256 });
  return Object.freeze({
    description: toText(input.description),
    id,
    label: toText(input.label) || id
  });
}

function normalizedModel(value = {}) {
  const input = normalizeObject(value);
  const id = boundedIdentifier(input.id, "model.id");
  const variants = Array.isArray(input.variants) ? input.variants.map(normalizedVariant) : [];
  const ids = new Set();
  for (const variant of variants) {
    if (ids.has(variant.id)) {
      throw new TypeError(`Duplicate assistant variant: ${variant.id}.`);
    }
    ids.add(variant.id);
  }
  return Object.freeze({
    capabilities: Object.freeze({ ...normalizeObject(input.capabilities) }),
    description: toText(input.description),
    id,
    label: toText(input.label) || id,
    lockMessage: toText(input.lockMessage),
    status: toText(input.status) || "available",
    variants: Object.freeze(variants)
  });
}

function normalizedModelAccess(value = {}) {
  const input = normalizeObject(value);
  const mode = toText(input.mode);
  const enabledModelIds = [...new Set((Array.isArray(input.enabledModelIds)
    ? input.enabledModelIds
    : []).map((modelId) => boundedIdentifier(
    modelId,
    "modelProvider.modelAccess.enabledModelIds",
    { maxLength: 256 }
  )))];
  return Object.freeze({
    configurable: input.configurable === true,
    enabledModelIds: Object.freeze(enabledModelIds),
    label: toText(input.label),
    managementOnly: input.managementOnly === true,
    mode: ["recommended", "verified"].includes(mode) ? mode : "all",
    recommendedModelId: boundedIdentifier(
      input.recommendedModelId,
      "modelProvider.modelAccess.recommendedModelId",
      { allowEmpty: true }
    ),
    warning: toText(input.warning)
  });
}

function normalizedModelProvider(value = {}) {
  const input = normalizeObject(value);
  const id = boundedIdentifier(input.id, "modelProvider.id", { maxLength: 256 });
  const models = Array.isArray(input.models) ? input.models.map(normalizedModel) : [];
  const ids = new Set();
  for (const model of models) {
    if (ids.has(model.id)) {
      throw new TypeError(`Duplicate assistant model: ${model.id}.`);
    }
    ids.add(model.id);
  }
  return Object.freeze({
    apiKeyCompatible: input.apiKeyCompatible === true,
    connected: input.connected === true,
    connectionMessage: toText(input.connectionMessage),
    connectionStatus: toText(input.connectionStatus) || (input.connected === true ? "connected" : "disconnected"),
    defaultModelId: boundedIdentifier(input.defaultModelId, "modelProvider.defaultModelId", {
      allowEmpty: true
    }),
    definitionRevision: toText(input.definitionRevision),
    description: toText(input.description),
    id,
    label: toText(input.label) || id,
    modelAccess: normalizedModelAccess(input.modelAccess),
    preferred: input.preferred === true,
    models: Object.freeze(models)
  });
}

function normalizedAgent(value = {}) {
  const input = normalizeObject(value);
  const id = boundedIdentifier(input.id, "agent.id", { maxLength: 256 });
  return Object.freeze({
    description: toText(input.description),
    id,
    label: toText(input.label) || id,
    mode: toText(input.mode) || "primary",
    modelId: boundedIdentifier(input.modelId, "agent.modelId", {
      allowEmpty: true
    }),
    modelProviderId: boundedIdentifier(input.modelProviderId, "agent.modelProviderId", {
      allowEmpty: true,
      maxLength: 256
    }),
    variantId: boundedIdentifier(input.variantId, "agent.variantId", {
      allowEmpty: true,
      maxLength: 256
    })
  });
}

function normalizedCapabilityPage(value = {}) {
  const input = normalizeObject(value);
  const limit = Number.parseInt(String(input.limit || ""), 10);
  const total = Number.parseInt(String(input.total || ""), 10);
  return Object.freeze({
    cursor: toText(input.cursor),
    hasMore: input.hasMore === true,
    kind: ["models", "providers"].includes(toText(input.kind)) ? toText(input.kind) : "providers",
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    nextCursor: toText(input.nextCursor),
    search: toText(input.search),
    total: Number.isFinite(total) && total >= 0 ? total : 0
  });
}

function assertUniqueIds(values = [], label = "assistant item") {
  const ids = new Set();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw new TypeError(`Duplicate ${label}: ${value.id}.`);
    }
    ids.add(value.id);
  }
}

function defineVibe64AssistantCapabilities(value = {}) {
  const input = normalizeObject(value);
  const engineId = boundedIdentifier(input.engineId, "engineId", { maxLength: 64 });
  if (!VIBE64_ASSISTANT_ENGINE_ID_SET.has(engineId)) {
    throw new TypeError(`Unknown assistant engine capabilities: ${engineId}.`);
  }
  const schema = toText(input.schema) || VIBE64_ASSISTANT_CAPABILITIES_SCHEMA;
  if (schema !== VIBE64_ASSISTANT_CAPABILITIES_SCHEMA) {
    throw new TypeError(`Unsupported assistant capabilities schema: ${schema}.`);
  }
  const modelProviders = Array.isArray(input.modelProviders)
    ? input.modelProviders.map(normalizedModelProvider)
    : [];
  const agents = Array.isArray(input.agents) ? input.agents.map(normalizedAgent) : [];
  assertUniqueIds(modelProviders, "assistant model provider");
  assertUniqueIds(agents, "assistant agent");
  const authentication = normalizeObject(input.authentication);
  const modes = Array.isArray(authentication.modes)
    ? [...new Set(authentication.modes.map(toText).filter(Boolean))]
    : [];
  return Object.freeze({
    agents: Object.freeze(agents),
    authentication: Object.freeze({
      management: toText(authentication.management) || "account-owner",
      modes: Object.freeze(modes)
    }),
    defaults: Object.freeze({
      agentId: boundedIdentifier(input.defaults?.agentId, "defaults.agentId", {
        allowEmpty: true,
        maxLength: 256
      }),
      modelId: boundedIdentifier(input.defaults?.modelId, "defaults.modelId", {
        allowEmpty: true
      }),
      modelProviderId: boundedIdentifier(
        input.defaults?.modelProviderId,
        "defaults.modelProviderId",
        { allowEmpty: true, maxLength: 256 }
      ),
      variantId: boundedIdentifier(input.defaults?.variantId, "defaults.variantId", {
        allowEmpty: true,
        maxLength: 256
      })
    }),
    engineId,
    health: Object.freeze({
      message: toText(input.health?.message),
      status: toText(input.health?.status) || "unavailable"
    }),
    label: toText(input.label) || engineId,
    modelProviders: Object.freeze(modelProviders),
    page: normalizedCapabilityPage(input.page),
    revision: catalogRevision(input.revision, "revision"),
    schema,
    transportId: boundedIdentifier(input.transportId, "transportId", { maxLength: 128 })
  });
}

function requestedField(input, defaults, field) {
  return Object.hasOwn(input, field) ? toText(input[field]) : toText(defaults[field]);
}

function unavailableSelection(message, details = {}) {
  throw selectionError(
    VIBE64_ASSISTANT_SELECTION_ERROR_CODES.UNAVAILABLE,
    message,
    details
  );
}

function resolveVibe64AssistantSelection(capabilitiesValue = {}, requestedValue = {}) {
  const capabilities = defineVibe64AssistantCapabilities(capabilitiesValue);
  const requested = normalizeObject(requestedValue);
  const requestedEngineId = Object.hasOwn(requested, "engineId")
    ? toText(requested.engineId)
    : capabilities.engineId;
  if (requestedEngineId !== capabilities.engineId) {
    unavailableSelection(`Assistant engine is unavailable: ${requestedEngineId || "(missing)"}.`, {
      engineId: requestedEngineId,
      field: "engineId"
    });
  }
  if (
    Object.hasOwn(requested, "catalogRevision") &&
    toText(requested.catalogRevision) !== capabilities.revision
  ) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.CATALOG_STALE,
      "The assistant catalog changed. Review the current choices and try again.",
      {
        actualRevision: capabilities.revision,
        expectedRevision: toText(requested.catalogRevision)
      }
    );
  }
  const modelProviderId = requestedField(requested, capabilities.defaults, "modelProviderId");
  const modelProvider = capabilities.modelProviders.find((candidate) => (
    candidate.id === modelProviderId
  ));
  if (!modelProvider) {
    unavailableSelection(`Assistant model provider is unavailable: ${modelProviderId || "(missing)"}.`, {
      field: "modelProviderId",
      modelProviderId
    });
  }
  if (modelProvider.connected !== true) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.CONNECTION_REQUIRED,
      `Connect ${modelProvider.label} before creating or continuing this session.`,
      { field: "modelProviderId", modelProviderId }
    );
  }
  const modelId = requestedField(requested, capabilities.defaults, "modelId");
  const model = modelProvider.models.find((candidate) => candidate.id === modelId);
  if (!model || model.status !== "available") {
    unavailableSelection(`Assistant model is unavailable: ${modelId || "(missing)"}.`, {
      field: "modelId",
      modelId,
      modelProviderId
    });
  }
  const agentId = requestedField(requested, capabilities.defaults, "agentId");
  const agent = capabilities.agents.find((candidate) => candidate.id === agentId);
  if (!agent || !["primary", "all"].includes(agent.mode)) {
    unavailableSelection(`Assistant agent is unavailable: ${agentId || "(missing)"}.`, {
      agentId,
      field: "agentId"
    });
  }
  const variantId = requestedField(requested, capabilities.defaults, "variantId");
  if (variantId && !model.variants.some((candidate) => candidate.id === variantId)) {
    unavailableSelection(`Assistant variant is unavailable: ${variantId}.`, {
      field: "variantId",
      modelId,
      variantId
    });
  }
  if (
    (agent.modelProviderId && agent.modelProviderId !== modelProviderId) ||
    (agent.modelId && agent.modelId !== modelId) ||
    (agent.variantId && agent.variantId !== variantId)
  ) {
    unavailableSelection(
      `Assistant agent ${agent.label} is not available for the selected model and variant.`,
      { agentId, field: "agentId", modelId, modelProviderId, variantId }
    );
  }
  return defineVibe64AssistantSelection({
    agentId,
    catalogRevision: capabilities.revision,
    engineId: capabilities.engineId,
    modelId,
    modelProviderId,
    variantId
  });
}

function assertVibe64AssistantSelectionUpdate(currentValue = {}, nextValue = {}, options = {}) {
  const {
    turnActive = false
  } = options;
  defineVibe64AssistantSelection(currentValue);
  const next = defineVibe64AssistantSelection(nextValue);
  if (turnActive === true) {
    throw selectionError(
      VIBE64_ASSISTANT_SELECTION_ERROR_CODES.TURN_ACTIVE,
      "Wait for the active assistant turn to finish before changing its selection."
    );
  }
  return next;
}

// The fields that name one assistant: its tool, provider, model, agent and thinking level.
const VIBE64_ASSISTANT_SELECTION_IDENTITY_FIELDS = Object.freeze(["engineId", "modelProviderId", "modelId", "agentId", "variantId"]);
/**
 * An absent field and an empty one name the same assistant.
 */
function sameVibe64AssistantSelection(left, right) {
  return VIBE64_ASSISTANT_SELECTION_IDENTITY_FIELDS.every(
    (key) => String(left?.[key] ?? "").trim() === String(right?.[key] ?? "").trim()
  );
}

function vibe64AssistantConversationKey(selection = {}) {
  return selection.engineId === "codex" && selection.modelProviderId && selection.modelProviderId !== "openai"
    ? `codex/${selection.modelProviderId}` : selection.engineId;
}

const __testables = Object.freeze({ assertVibe64AssistantSelectionUpdate, VIBE64_ASSISTANT_SELECTION_ERROR_CODES });

export {
  vibe64AssistantConversationKey,
  VIBE64_ASSISTANT_CATALOG_REVISION_PATTERN,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_ENGINE_ID_SET,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  defineVibe64AssistantCapabilities,
  defineVibe64AssistantSelection,
  resolveVibe64AssistantSelection,
  sameVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata,
  __testables
};
