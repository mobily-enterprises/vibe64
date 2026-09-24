import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  OPENCODE_NATIVE_ENDPOINT_CODE,
  assistantProviderPolicy
} from "./assistantProviderPolicy.js";

const AI_CONNECTION_STORE_VERSION = 5;
const BUILT_IN_OPENCODE_API_KEY = "public";
const BUILT_IN_OPENCODE_MODEL_ID = "big-pickle";
const BUILT_IN_OPENCODE_PROVIDER_ID = "opencode";
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
const AI_CONNECTION_PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const AI_CONNECTION_REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const AI_CONNECTION_KEY_MAXIMUM_CHARACTERS = 16_384;
const AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS = 160;

function text(value = "") {
  return String(value ?? "").trim();
}

function containsControlCharacter(value = "") {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

function providerId(value = "") {
  const id = text(value);
  if (!AI_CONNECTION_PROVIDER_PATTERN.test(id)) {
    const error = new Error("AI provider id is invalid.");
    error.code = "vibe64_ai_provider_invalid";
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function providerRevision(value = "") {
  const revision = text(value);
  if (!AI_CONNECTION_REVISION_PATTERN.test(revision)) {
    const error = new Error("Refresh the provider catalog before saving this API key.");
    error.code = "vibe64_ai_provider_revision_invalid";
    error.statusCode = 409;
    throw error;
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
    const error = new Error("API key is invalid.");
    error.code = "vibe64_ai_api_key_invalid";
    error.statusCode = 400;
    throw error;
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
    const error = new Error("AI provider label is invalid.");
    error.code = "vibe64_ai_provider_label_invalid";
    error.statusCode = 400;
    throw error;
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
      defaultModelId: connection.economyModelId,
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
      economyModelId: text(connection.economyModelId) || policy.economyModelId,
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
      economyModelId: text(candidate.economyModelId) || policy?.economyModelId || "",
      endpointCode: OPENCODE_NATIVE_ENDPOINT_CODE,
      fingerprint: connectionFingerprint(id, key),
      label: text(candidate.label) || id,
      managementUrl: text(candidate.managementUrl) || policy?.managementUrl || "",
      modelAccessUnlocked: candidate.modelAccessUnlocked === true,
      ownerOnly: candidate.ownerOnly === false ? false : policy?.ownerOnly !== false,
      productLabel: text(candidate.productLabel) || policy?.productLabel || text(candidate.label) || id,
      providerRevision: text(candidate.providerRevision),
      updatedAt: text(candidate.updatedAt),
      ...(id === BUILT_IN_OPENCODE_PROVIDER_ID
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
  const preferredProviderId = requestedPreferredProviderId === BUILT_IN_OPENCODE_PROVIDER_ID ||
    Object.hasOwn(connections, requestedPreferredProviderId)
    ? requestedPreferredProviderId
    : Object.hasOwn(connections, ZAI_PROVIDER_ID)
      ? ZAI_PROVIDER_ID
      : BUILT_IN_OPENCODE_PROVIDER_ID;
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
  if (connection.builtIn === true) {
    return {
      configurable: false,
      enabledModelIds: [BUILT_IN_OPENCODE_MODEL_ID],
      label: "Big Pickle included",
      mode: "recommended",
      recommendedModelId: BUILT_IN_OPENCODE_MODEL_ID,
      warning: "Add an OpenCode Zen API key to use additional Zen models."
    };
  }
  if (id === BUILT_IN_OPENCODE_PROVIDER_ID) {
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
        BUILT_IN_OPENCODE_MODEL_ID,
        ...(mode === "verified" ? connection.zenEnabledModelIds : [])
      ]),
      label: "Zen model access",
      managementOnly: true,
      mode,
      recommendedModelId: BUILT_IN_OPENCODE_MODEL_ID,
      warning: "Checking models sends one tiny request to each current Zen model and may use API credit."
    };
  }
  return connectionPolicy(connection, id)?.modelAccess || null;
}

function publicConnection(connection = {}, id = "", options = {}) {
  const key = String(connection.apiKey || "");
  const route = connectionPolicy(connection, id);
  const builtIn = connection.builtIn === true;
  const modelAccess = connectionModelAccess(connection, id, options);
  return {
    accessLabel: route?.accessLabel || "Personal use",
    billingLabel: route?.billingLabel || "Billing endpoint not selected",
    canonicalUrl: "",
    builtIn,
    connected: Boolean(route),
    economyModelId: route?.economyModelId || "",
    endpointCode: text(connection.endpointCode),
    fingerprint: text(connection.fingerprint),
    id,
    keyHint: builtIn ? "Included" : key.length > 4 ? `••••${key.slice(-4)}` : "••••",
    label: text(connection.label) || id,
    managementUrl: route?.managementUrl || "",
    modelProviderId: id,
    modelAccess: modelAccess || null,
    ownerOnly: route?.ownerOnly !== false,
    preferred: connection.preferred === true,
    productLabel: route?.productLabel || "Unconfirmed provider route",
    providerRevision: text(connection.providerRevision),
    removable: !builtIn,
    updatedAt: text(connection.updatedAt)
  };
}

function builtInOpenCodeConnection({ preferred = false } = {}) {
  const route = assistantProviderPolicy({
    defaultModelId: BUILT_IN_OPENCODE_MODEL_ID,
    id: BUILT_IN_OPENCODE_PROVIDER_ID,
    label: "OpenCode Zen"
  });
  return {
    apiKey: BUILT_IN_OPENCODE_API_KEY,
    billingLabel: route.billingLabel,
    builtIn: true,
    economyModelId: BUILT_IN_OPENCODE_MODEL_ID,
    endpointCode: route.endpointCode,
    fingerprint: connectionFingerprint(
      BUILT_IN_OPENCODE_PROVIDER_ID,
      BUILT_IN_OPENCODE_API_KEY
    ),
    label: "OpenCode Zen",
    managementUrl: route.managementUrl,
    ownerOnly: route.ownerOnly,
    preferred,
    productLabel: route.productLabel,
    providerRevision: ""
  };
}

function stateConnection(state = {}, id = "") {
  const stored = state.connections?.[id] || null;
  if (stored) {
    return {
      ...stored,
      preferred: state.preferredProviderId === id
    };
  }
  return id === BUILT_IN_OPENCODE_PROVIDER_ID
    ? builtInOpenCodeConnection({
        preferred: state.preferredProviderId === BUILT_IN_OPENCODE_PROVIDER_ID
      })
    : null;
}

function connectionVerificationError(code, message, statusCode, fieldErrors = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (fieldErrors) {
    error.fieldErrors = fieldErrors;
  }
  return error;
}

async function verifyOpenCodeConnection({
  apiKey: key,
  policy,
  verifyConnection
} = {}) {
  try {
    const result = await verifyConnection({
      apiKey: key,
      engineId: "opencode",
      modelId: policy.economyModelId,
      modelProviderId: policy.modelProviderId
    });
    if (result?.ok !== true) {
      throw Object.assign(new Error("OpenCode verification did not complete."), {
        retryable: true,
        statusCode: 503
      });
    }
  } catch (error) {
    if (
      Number(error?.statusCode) === 409 ||
      error?.code === "vibe64_assistant_catalog_stale"
    ) {
      throw connectionVerificationError(
        "vibe64_ai_provider_policy_stale",
        `${policy.productLabel} changed in OpenCode. Refresh its setup before connecting.`,
        409
      );
    }
    const unavailable = error?.retryable === true || Number(error?.statusCode) >= 500;
    if (unavailable) {
      throw connectionVerificationError(
        "vibe64_ai_key_verification_unavailable",
        `${policy.productLabel} could not be reached to verify this key. Nothing was saved; try again.`,
        503
      );
    }
    const message = `${policy.productLabel} rejected this key or could not complete a test request. Check the key, billing, and quota, then try again.`;
    throw connectionVerificationError(
      "vibe64_ai_api_key_rejected",
      message,
      422,
      { apiKey: message }
    );
  }
}

function createAiConnectionStore({
  filePath = "",
  onConnectionChanged = () => null,
  readModelIds = null,
  verifyConnection = null,
  zenModelCheckDelayMs = ZEN_MODEL_CHECK_DELAY_MS
} = {}) {
  if (!text(filePath)) {
    throw new TypeError("AI connections require a private store path.");
  }
  if (typeof verifyConnection !== "function") {
    throw new TypeError("AI connections require OpenCode key verification.");
  }
  const targetPath = path.resolve(filePath);
  const zenModelChecks = new Map();
  let mutation = Promise.resolve();

  async function readState() {
    try {
      return normalizedState(JSON.parse(await readFile(targetPath, "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return normalizedState({});
      }
      if (error instanceof SyntaxError) {
        const malformed = new Error("AI connection state is not valid JSON.");
        malformed.code = "vibe64_ai_connection_state_malformed";
        malformed.statusCode = 500;
        throw malformed;
      }
      throw error;
    }
  }

  async function writeState(value = {}) {
    const state = normalizedState(value);
    const parentPath = path.dirname(targetPath);
    await mkdir(parentPath, { mode: 0o700, recursive: true });
    await chmod(parentPath, 0o700);
    const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await rename(temporaryPath, targetPath);
      await chmod(targetPath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => null);
      throw error;
    }
    return state;
  }

  function mutate(operation) {
    const pending = mutation.catch(() => null).then(async () => {
      const state = await readState();
      if (Object.values(state.connections).some((connection) => Object.hasOwn(connection, "helperModelId"))) {
        throw connectionVerificationError("vibe64_ai_routing_upgrade_required",
          "Stop the services and run the application state upgrade before changing AI connections.", 409);
      }
      return operation();
    });
    mutation = pending.catch(() => null);
    return pending;
  }

  function waitBeforeNextZenModel() {
    const milliseconds = Math.max(0, Number(zenModelCheckDelayMs) || 0);
    if (!milliseconds) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref?.();
    });
  }

  async function mutateZenModelCheck(job, operation) {
    return mutate(async () => {
      const state = await readState();
      const connection = state.connections[BUILT_IN_OPENCODE_PROVIDER_ID];
      if (
        !connection ||
        connection.fingerprint !== job.fingerprint ||
        connection.zenModelCheck?.id !== job.id
      ) {
        return null;
      }
      const result = operation(connection, state);
      if (result === false) {
        return null;
      }
      const now = new Date().toISOString();
      connection.zenModelCheck.updatedAt = now;
      state.updatedAt = now;
      await writeState(state);
      return connection;
    });
  }

  async function finishZenModelCheck(job, status, message = "") {
    await mutateZenModelCheck(job, (connection) => {
      connection.zenModelCheck.currentModelId = "";
      connection.zenModelCheck.finishedAt = new Date().toISOString();
      connection.zenModelCheck.message = text(message).slice(0, 320);
      connection.zenModelCheck.status = status;
    });
    if (zenModelChecks.get(BUILT_IN_OPENCODE_PROVIDER_ID) === job) {
      zenModelChecks.delete(BUILT_IN_OPENCODE_PROVIDER_ID);
    }
  }

  async function runZenModelCheck(job) {
    try {
      const currentModelIds = modelIds(await readModelIds());
      const candidates = currentModelIds
        .filter((id) => id !== BUILT_IN_OPENCODE_MODEL_ID)
        .sort((left, right) => left.localeCompare(right));
      if (!currentModelIds.includes(BUILT_IN_OPENCODE_MODEL_ID)) {
        throw new Error("The current Zen catalogue did not include Big Pickle.");
      }
      const started = await mutateZenModelCheck(job, (connection) => {
        connection.zenModelCheck.currentModelId = candidates[0] || "";
        connection.zenModelCheck.status = "running";
        connection.zenModelCheck.total = candidates.length;
      });
      if (!started) return;

      for (const [index, modelId] of candidates.entries()) {
        if (job.cancelled) {
          await finishZenModelCheck(job, "cancelled", "Model checking was cancelled.");
          return;
        }
        let available = false;
        let retryable = false;
        try {
          const result = await verifyConnection({
            apiKey: job.apiKey,
            engineId: "opencode",
            modelId,
            modelProviderId: BUILT_IN_OPENCODE_PROVIDER_ID
          });
          available = result?.ok === true;
          retryable = !available;
        } catch (error) {
          retryable = error?.retryable === true || Number(error?.statusCode) >= 500;
        }
        const nextModelId = candidates[index + 1] || "";
        const updated = await mutateZenModelCheck(job, (connection) => {
          if (job.cancelled || connection.zenModelAccessMode !== "verified") {
            return false;
          }
          connection.zenModelCheck.checked += 1;
          connection.zenModelCheck.currentModelId = nextModelId;
          if (available) {
            connection.zenEnabledModelIds = modelIds([
              ...connection.zenEnabledModelIds,
              modelId
            ]);
            connection.zenModelCheck.enabled += 1;
          } else if (retryable) {
            connection.zenModelCheck.retryable += 1;
          } else {
            connection.zenModelCheck.rejected += 1;
          }
        });
        if (!updated) {
          await finishZenModelCheck(job, "cancelled", "Model checking was cancelled.");
          return;
        }
        if (nextModelId) {
          await waitBeforeNextZenModel();
        }
      }
      await finishZenModelCheck(job, "complete");
    } catch {
      await finishZenModelCheck(
        job,
        job.cancelled ? "cancelled" : "failed",
        job.cancelled
          ? "Model checking was cancelled."
          : "Vibe64 could not complete the Zen model check. Try again."
      );
    }
  }

  return Object.freeze({
    filePath: targetPath,
    async listConnections() {
      const state = await readState();
      const ids = new Set([
        BUILT_IN_OPENCODE_PROVIDER_ID,
        ...Object.keys(state.connections)
      ]);
      return [...ids]
        .map((id) => publicConnection(stateConnection(state, id), id, {
          activeZenCheck: zenModelChecks.has(id)
        }))
        .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
    },
    async assistantAccess(value = "", { modelId = "" } = {}) {
      const id = providerId(value);
      const state = await readState();
      const connection = stateConnection(state, id);
      const route = connection ? connectionPolicy(connection, id) : null;
      const access = connection ? connectionModelAccess(connection, id, {
        activeZenCheck: zenModelChecks.has(id)
      }) : null;
      const requestedModelId = text(modelId);
      const enabledModelIds = new Set(modelIds([
        access?.recommendedModelId,
        ...modelIds(access?.enabledModelIds)
      ]));
      const modelAvailable = !requestedModelId || !access || access.mode === "all" ||
        enabledModelIds.has(requestedModelId);
      return route ? {
        accessLabel: route.accessLabel,
        available: modelAvailable,
        connectionIdentity: `opencode:${id}:${connection.fingerprint}`,
        endpointCode: route.endpointCode,
        ownerOnly: route.ownerOnly
      } : {
        available: false,
        ownerOnly: true
      };
    },
    async removeConnection(value = "") {
      const id = providerId(value);
      return mutate(async () => {
        const state = await readState();
        const previous = state.connections[id] || null;
        if (!previous) {
          return {
            connected: id === BUILT_IN_OPENCODE_PROVIDER_ID,
            id,
            ok: true,
            removed: false
          };
        }
        const zenModelCheck = zenModelChecks.get(id);
        if (zenModelCheck) {
          zenModelCheck.cancelled = true;
          zenModelChecks.delete(id);
        }
        delete state.connections[id];
        if (state.preferredProviderId === id) {
          state.preferredProviderId = BUILT_IN_OPENCODE_PROVIDER_ID;
        }
        state.updatedAt = new Date().toISOString();
        await writeState(state);
        const reverted = id === BUILT_IN_OPENCODE_PROVIDER_ID;
        await onConnectionChanged({
          modelProviderId: id,
          reason: reverted ? "reverted" : "removed"
        });
        return reverted
          ? { connected: true, id, ok: true, removed: true, reverted: true }
          : { id, ok: true, removed: true };
      });
    },
    async resolveConnection(value = "") {
      const id = providerId(value);
      const state = await readState();
      const connection = stateConnection(state, id);
      if (!connection) {
        return null;
      }
      const route = connectionPolicy(connection, id);
      if (!route) {
        const error = new Error(
          "The owner must choose this provider's billing endpoint before it can be used."
        );
        error.code = "vibe64_ai_endpoint_selection_required";
        error.statusCode = 409;
        throw error;
      }
      return {
        apiKey: connection.apiKey,
        canonicalUrl: "",
        economyModelId: route.economyModelId,
        endpointCode: route.endpointCode,
        fingerprint: connection.fingerprint,
        modelProviderId: id,
        providerRevision: connection.providerRevision
      };
    },
    async upsertConnection(input = {}, { provider = null } = {}) {
      const id = providerId(input.modelProviderId || input.providerId || input.id);
      const key = apiKey(input.apiKey);
      const revision = providerRevision(input.providerRevision);
      if (id === BUILT_IN_OPENCODE_PROVIDER_ID && key === BUILT_IN_OPENCODE_API_KEY) {
        throw connectionVerificationError(
          "vibe64_ai_public_key_already_included",
          "Big Pickle public access is already included. Paste a Zen API key to manage additional Zen models.",
          400,
          {
            apiKey: "Big Pickle public access is already included. Paste a Zen API key to manage additional Zen models."
          }
        );
      }
      if (
        text(provider?.id) !== id ||
        text(provider?.definitionRevision) !== revision
      ) {
        const error = new Error("Refresh the provider catalogue before saving this API key.");
        error.code = "vibe64_ai_provider_revision_changed";
        error.statusCode = 409;
        throw error;
      }
      const route = assistantProviderPolicy(provider);
      return mutate(async () => {
        await verifyOpenCodeConnection({
          apiKey: key,
          policy: route,
          verifyConnection
        });
        const state = await readState();
        const previous = state.connections[id] || null;
        const now = new Date().toISOString();
        const fingerprint = connectionFingerprint(id, key);
        const sameCredential = previous?.fingerprint === fingerprint;
        const runningZenModelCheck = zenModelChecks.get(id);
        if (runningZenModelCheck) {
          runningZenModelCheck.cancelled = true;
          zenModelChecks.delete(id);
        }
        const connection = {
          apiKey: key,
          billingLabel: route.billingLabel,
          createdAt: text(previous?.createdAt) || now,
          economyModelId: route.economyModelId,
          endpointCode: route.endpointCode,
          fingerprint,
          label: connectionLabel(input.label, text(previous?.label) || route.productLabel || id),
          managementUrl: route.managementUrl,
          modelAccessUnlocked: previous?.modelAccessUnlocked === true,
          ownerOnly: route.ownerOnly,
          productLabel: route.productLabel,
          providerRevision: revision,
          updatedAt: now,
          ...(id === BUILT_IN_OPENCODE_PROVIDER_ID
            ? {
                zenEnabledModelIds: sameCredential
                  ? modelIds(previous.zenEnabledModelIds)
                  : [],
                zenModelAccessMode: sameCredential
                  ? previous.zenModelAccessMode
                  : "recommended",
                zenModelCheck: sameCredential
                  ? normalizedZenModelCheck(previous.zenModelCheck)
                  : null
              }
            : {})
        };
        state.connections[id] = connection;
        if (id === ZAI_PROVIDER_ID) {
          state.preferredProviderId = ZAI_PROVIDER_ID;
        }
        state.updatedAt = now;
        await writeState(state);
        await onConnectionChanged({
          modelProviderId: id,
          reason: previous ? "replaced" : "created"
        });
        return publicConnection({
          ...connection,
          preferred: state.preferredProviderId === id
        }, id);
      });
    },
    async updateModelAccess(value = "", options = {}) {
      const id = providerId(value);
      const requestedOperation = text(options.operation) || (
        typeof options.unlocked === "boolean"
          ? options.unlocked ? "enable-all" : "disable-additional"
          : ""
      );
      if (![ZAI_PROVIDER_ID, BUILT_IN_OPENCODE_PROVIDER_ID].includes(id)) {
        const error = new Error("This provider does not have configurable model access.");
        error.code = "vibe64_ai_model_access_not_configurable";
        error.statusCode = 400;
        throw error;
      }

      if (id === ZAI_PROVIDER_ID) {
        if (!["disable-additional", "enable-all"].includes(requestedOperation)) {
          const error = new Error("Choose whether all Z.AI models should be unlocked.");
          error.code = "vibe64_ai_model_access_invalid";
          error.statusCode = 400;
          throw error;
        }
        return mutate(async () => {
          const state = await readState();
          const connection = state.connections[id];
          if (!connection) {
            const error = new Error("Connect a Z.AI API key before changing model access.");
            error.code = "vibe64_ai_connection_required";
            error.statusCode = 409;
            throw error;
          }
          const nextUnlocked = requestedOperation === "enable-all";
          if (connection.modelAccessUnlocked === nextUnlocked) {
            return publicConnection({
              ...connection,
              preferred: state.preferredProviderId === id
            }, id);
          }
          const now = new Date().toISOString();
          connection.modelAccessUnlocked = nextUnlocked;
          connection.updatedAt = now;
          state.updatedAt = now;
          await writeState(state);
          await onConnectionChanged({
            modelProviderId: id,
            reason: "model-access-updated"
          });
          return publicConnection({
            ...connection,
            preferred: state.preferredProviderId === id
          }, id);
        });
      }

      if (!["cancel-check", "check-available", "disable-additional", "enable-all"].includes(requestedOperation)) {
        const error = new Error("Choose how OpenCode Zen models should be enabled.");
        error.code = "vibe64_ai_model_access_invalid";
        error.statusCode = 400;
        throw error;
      }

      if (requestedOperation === "check-available") {
        if (typeof readModelIds !== "function") {
          const error = new Error("This Vibe64 host cannot read the current Zen model list.");
          error.code = "vibe64_ai_model_check_unavailable";
          error.statusCode = 503;
          throw error;
        }
        let startedJob = null;
        const connection = await mutate(async () => {
          const state = await readState();
          const current = state.connections[id];
          if (!current) {
            const error = new Error("Add a Zen API key before checking model access.");
            error.code = "vibe64_ai_connection_required";
            error.statusCode = 409;
            throw error;
          }
          if (zenModelChecks.has(id)) {
            return publicConnection({
              ...current,
              preferred: state.preferredProviderId === id
            }, id, { activeZenCheck: true });
          }
          const now = new Date().toISOString();
          startedJob = {
            apiKey: current.apiKey,
            cancelled: false,
            fingerprint: current.fingerprint,
            id: randomUUID()
          };
          zenModelChecks.set(id, startedJob);
          current.zenEnabledModelIds = [];
          current.zenModelAccessMode = "verified";
          current.zenModelCheck = {
            checked: 0,
            currentModelId: "",
            enabled: 0,
            finishedAt: "",
            id: startedJob.id,
            message: "",
            rejected: 0,
            retryable: 0,
            startedAt: now,
            status: "starting",
            total: 0,
            updatedAt: now
          };
          current.updatedAt = now;
          state.updatedAt = now;
          await writeState(state);
          return publicConnection({
            ...current,
            preferred: state.preferredProviderId === id
          }, id, { activeZenCheck: true });
        });
        if (startedJob) {
          try {
            await onConnectionChanged({
              modelProviderId: id,
              reason: "model-access-updated"
            });
          } catch (error) {
            startedJob.cancelled = true;
            await finishZenModelCheck(
              startedJob,
              "failed",
              "Vibe64 could not prepare the Zen model check. Try again."
            );
            throw error;
          }
          void runZenModelCheck(startedJob).catch(() => null);
        }
        return connection;
      }

      if (requestedOperation === "cancel-check") {
        const running = zenModelChecks.get(id);
        if (running) {
          running.cancelled = true;
        }
        return mutate(async () => {
          const state = await readState();
          const connection = state.connections[id];
          if (!connection) {
            const error = new Error("Add a Zen API key before changing model access.");
            error.code = "vibe64_ai_connection_required";
            error.statusCode = 409;
            throw error;
          }
          const now = new Date().toISOString();
          if (connection.zenModelCheck) {
            connection.zenModelCheck.status = running ? "cancelling" : "cancelled";
            connection.zenModelCheck.updatedAt = now;
            if (!running) {
              connection.zenModelCheck.currentModelId = "";
              connection.zenModelCheck.finishedAt = now;
              connection.zenModelCheck.message = "Model checking was cancelled.";
            }
            state.updatedAt = now;
            await writeState(state);
          }
          return publicConnection({
            ...connection,
            preferred: state.preferredProviderId === id
          }, id, { activeZenCheck: Boolean(running) });
        });
      }

      const running = zenModelChecks.get(id);
      if (running) {
        running.cancelled = true;
        zenModelChecks.delete(id);
      }
      return mutate(async () => {
        const state = await readState();
        const connection = state.connections[id];
        if (!connection) {
          const error = new Error("Add a Zen API key before changing model access.");
          error.code = "vibe64_ai_connection_required";
          error.statusCode = 409;
          throw error;
        }
        const mode = requestedOperation === "enable-all" ? "all" : "recommended";
        const now = new Date().toISOString();
        connection.zenEnabledModelIds = [];
        connection.zenModelAccessMode = mode;
        if (connection.zenModelCheck && ["starting", "running", "cancelling"].includes(
          connection.zenModelCheck.status
        )) {
          connection.zenModelCheck.currentModelId = "";
          connection.zenModelCheck.finishedAt = now;
          connection.zenModelCheck.message = requestedOperation === "enable-all"
            ? "The check stopped because all current Zen models were enabled."
            : "The check stopped because additional Zen models were disabled.";
          connection.zenModelCheck.status = "cancelled";
          connection.zenModelCheck.updatedAt = now;
        }
        connection.updatedAt = now;
        state.updatedAt = now;
        await writeState(state);
        await onConnectionChanged({
          modelProviderId: id,
          reason: "model-access-updated"
        });
        return publicConnection({
          ...connection,
          preferred: state.preferredProviderId === id
        }, id, { activeZenCheck: false });
      });
    }
  });
}

export {
  AI_CONNECTION_KEY_MAXIMUM_CHARACTERS,
  AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS,
  AI_CONNECTION_PROVIDER_PATTERN,
  AI_CONNECTION_REVISION_PATTERN,
  AI_CONNECTION_STORE_VERSION,
  BUILT_IN_OPENCODE_API_KEY,
  BUILT_IN_OPENCODE_MODEL_ID,
  BUILT_IN_OPENCODE_PROVIDER_ID,
  connectionFingerprint,
  createAiConnectionStore
};
