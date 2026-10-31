import { createHash } from "node:crypto";

import {
  AI_CONNECTION_PROVIDER_PATTERN,
  AI_CONNECTION_REVISION_PATTERN
} from "../shared/aiConnectionIdentity.js";
import { aiConnectionError } from "./aiConnectionError.js";
import { OPENCODE_NATIVE_ENDPOINT_CODE, assistantProviderPolicy } from "./assistantProviderPolicy.js";
import { trimmedText as text } from "./trimmedText.js";

// What a saved AI connection is: its provider, key, label and model access,
// the saved state's normal form and the view of a connection the person sees.
const AI_CONNECTION_STORE_VERSION = 5;
// Vibe64 offers no account-free model. Zen is an ordinary keyed provider, and
// its free Big Pickle model is never offered, recommended or checked.
const OPENCODE_ZEN_PROVIDER_ID = "opencode";
const RETIRED_ZEN_MODEL_ID = "big-pickle";
const ZEN_MODEL_CHECK_DELAY_MS = 2_000;
const ZEN_MODEL_ACCESS_MODES = new Set(["all", "recommended", "verified"]);
const ZEN_MODEL_CHECK_STATUSES = new Set([
  "cancelled",
  "cancelling",
  "complete",
  "failed",
  "interrupted",
  "running",
  "starting"
]);
const ZAI_PROVIDER_ID = "zai";
const AI_CONNECTION_KEY_MAXIMUM_CHARACTERS = 16_384;
const AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS = 160;

function containsControlCharacter(value = "") {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

function providerId(value = "") {
  const id = text(value);
  if (!AI_CONNECTION_PROVIDER_PATTERN.test(id)) {
    throw aiConnectionError("vibe64_ai_provider_invalid", "AI provider id is invalid.", 400);
  }
  return id;
}

function providerRevision(value = "") {
  const revision = text(value);
  if (!AI_CONNECTION_REVISION_PATTERN.test(revision)) {
    throw aiConnectionError("vibe64_ai_provider_revision_invalid", "Refresh the provider catalog before saving this API key.", 409);
  }
  return revision;
}

function apiKey(value = "") {
  const key = typeof value === "string" ? value.trim() : "";
  if (
    !key ||
    Array.from(key).length > AI_CONNECTION_KEY_MAXIMUM_CHARACTERS ||
    containsControlCharacter(key)
  ) {
    throw aiConnectionError("vibe64_ai_api_key_invalid", "API key is invalid.", 400);
  }
  return key;
}

function connectionLabel(value = "", fallback = "") {
  if (value === undefined || value === null || value === "") {
    return text(fallback);
  }
  const label = typeof value === "string" ? value.trim() : "";
  if (
    !label ||
    Array.from(label).length > AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS ||
    containsControlCharacter(label)
  ) {
    throw aiConnectionError("vibe64_ai_provider_label_invalid", "AI provider label is invalid.", 400);
  }
  return label;
}

function connectionFingerprint(id = "", key = "") {
  return `sha256:${createHash("sha256").update(`${id}\0${key}`).digest("hex")}`;
}

function modelIds(value = null) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(text)
    .filter((id) => id && id.length <= 256 && !containsControlCharacter(id)))];
}

function count(value = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function normalizedZenModelCheck(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status = text(value.status);
  if (!ZEN_MODEL_CHECK_STATUSES.has(status)) {
    return null;
  }
  return {
    checked: count(value.checked),
    currentModelId: text(value.currentModelId).slice(0, 256),
    enabled: count(value.enabled),
    finishedAt: text(value.finishedAt),
    id: text(value.id),
    message: text(value.message).slice(0, 320),
    rejected: count(value.rejected),
    retryable: count(value.retryable),
    startedAt: text(value.startedAt),
    status,
    total: count(value.total),
    updatedAt: text(value.updatedAt)
  };
}

function connectionPolicy(connection = {}, id = "") {
  try {
    const policy = assistantProviderPolicy({
      defaultModelId: connection.defaultModelId,
      id,
      label: connection.productLabel || connection.label
    });
    const ownerOnly = typeof connection.ownerOnly === "boolean"
      ? connection.ownerOnly
      : policy.ownerOnly;
    return {
      ...policy,
      accessLabel: ownerOnly ? "Personal use" : "Workspace use",
      billingLabel: text(connection.billingLabel) || policy.billingLabel,
      defaultModelId: text(connection.defaultModelId) || policy.defaultModelId,
      managementUrl: text(connection.managementUrl) || policy.managementUrl,
      modelAccess: policy.modelAccess
        ? {
            ...policy.modelAccess,
            mode: connection.modelAccessUnlocked === true ? "all" : "recommended"
          }
        : null,
      ownerOnly,
      productLabel: policy.productLabel
    };
  } catch {
    return null;
  }
}

function normalizedState(value = null) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rows = source.connections && typeof source.connections === "object" && !Array.isArray(source.connections)
    ? source.connections
    : {};
  const connections = {};
  for (const [id, candidate] of Object.entries(rows)) {
    if (!AI_CONNECTION_PROVIDER_PATTERN.test(id) || !candidate || typeof candidate !== "object") {
      continue;
    }
    const key = String(candidate.apiKey || "");
    if (!key) {
      continue;
    }
    const policy = connectionPolicy(candidate, id);
    connections[id] = {
      apiKey: key,
      billingLabel: text(candidate.billingLabel) || policy?.billingLabel || "",
      createdAt: text(candidate.createdAt),
      ...(Object.hasOwn(candidate, "helperModelId") ? { helperModelId: candidate.helperModelId } : {}),
      defaultModelId: text(candidate.defaultModelId) || policy?.defaultModelId || "",
      endpointCode: OPENCODE_NATIVE_ENDPOINT_CODE,
      fingerprint: connectionFingerprint(id, key),
      label: text(candidate.label) || id,
      managementUrl: text(candidate.managementUrl) || policy?.managementUrl || "",
      modelAccessUnlocked: candidate.modelAccessUnlocked === true,
      ownerOnly: candidate.ownerOnly === false ? false : policy?.ownerOnly !== false,
      productLabel: text(candidate.productLabel) || policy?.productLabel || text(candidate.label) || id,
      providerRevision: text(candidate.providerRevision),
      updatedAt: text(candidate.updatedAt),
      ...(id === OPENCODE_ZEN_PROVIDER_ID
        ? {
            zenEnabledModelIds: modelIds(candidate.zenEnabledModelIds),
            zenModelAccessMode: ZEN_MODEL_ACCESS_MODES.has(text(candidate.zenModelAccessMode))
              ? text(candidate.zenModelAccessMode)
              : "recommended",
            zenModelCheck: normalizedZenModelCheck(candidate.zenModelCheck)
          }
        : {})
    };
  }
  const requestedPreferredProviderId = text(source.preferredProviderId);
  const preferredProviderId = AI_CONNECTION_PROVIDER_PATTERN.test(requestedPreferredProviderId)
    ? requestedPreferredProviderId
    : Object.hasOwn(connections, ZAI_PROVIDER_ID)
      ? ZAI_PROVIDER_ID
      : "";
  return {
    connections,
    preferredProviderId,
    updatedAt: text(source.updatedAt),
    version: AI_CONNECTION_STORE_VERSION
  };
}

function connectionModelAccess(connection = {}, id = "", {
  activeZenCheck = false
} = {}) {
  if (id === OPENCODE_ZEN_PROVIDER_ID) {
    const mode = ZEN_MODEL_ACCESS_MODES.has(text(connection.zenModelAccessMode))
      ? text(connection.zenModelAccessMode)
      : "recommended";
    const modelCheck = normalizedZenModelCheck(connection.zenModelCheck);
    const interrupted = modelCheck &&
      ["starting", "running", "cancelling"].includes(modelCheck.status) &&
      !activeZenCheck;
    return {
      check: interrupted
        ? {
            ...modelCheck,
            currentModelId: "",
            message: "The previous model check stopped when Vibe64 restarted.",
            status: "interrupted"
          }
        : modelCheck,
      configurable: true,
      enabledModelIds: modelIds([
        connectionPolicy(connection, id)?.defaultModelId,
        ...(mode === "verified" ? connection.zenEnabledModelIds : [])
      ]),
      label: "Zen model access",
      managementOnly: true,
      mode,
      recommendedModelId: connectionPolicy(connection, id)?.defaultModelId || "",
      warning: "Checking models sends one tiny request to each current Zen model and may use API credit."
    };
  }
  return connectionPolicy(connection, id)?.modelAccess || null;
}

function publicConnection(connection = {}, id = "", options = {}) {
  const key = String(connection.apiKey || "");
  const route = connectionPolicy(connection, id);
  const modelAccess = connectionModelAccess(connection, id, options);
  return {
    accessLabel: route?.accessLabel || "Personal use",
    billingLabel: route?.billingLabel || "Billing endpoint not selected",
    canonicalUrl: "",
    connected: Boolean(route),
    defaultModelId: route?.defaultModelId || "",
    endpointCode: text(connection.endpointCode),
    fingerprint: text(connection.fingerprint),
    id,
    keyHint: key.length > 4 ? `••••${key.slice(-4)}` : "••••",
    label: text(connection.label) || id,
    managementUrl: route?.managementUrl || "",
    modelProviderId: id,
    modelAccess: modelAccess || null,
    ownerOnly: route?.ownerOnly !== false,
    preferred: connection.preferred === true,
    productLabel: route?.productLabel || "Unconfirmed provider route",
    providerRevision: text(connection.providerRevision),
    removable: true,
    updatedAt: text(connection.updatedAt)
  };
}

function stateConnection(state = {}, id = "") {
  const stored = state.connections?.[id] || null;
  return stored ? { ...stored, preferred: state.preferredProviderId === id } : null;
}

export {
  AI_CONNECTION_KEY_MAXIMUM_CHARACTERS,
  AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS,
  AI_CONNECTION_STORE_VERSION,
  OPENCODE_ZEN_PROVIDER_ID,
  RETIRED_ZEN_MODEL_ID,
  ZAI_PROVIDER_ID,
  ZEN_MODEL_CHECK_DELAY_MS,
  apiKey,
  connectionFingerprint,
  connectionLabel,
  connectionModelAccess,
  connectionPolicy,
  modelIds,
  normalizedState,
  normalizedZenModelCheck,
  providerId,
  providerRevision,
  publicConnection,
  stateConnection
};
