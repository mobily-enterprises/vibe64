import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { aiConnectionError } from "./aiConnectionError.js";
import {
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
} from "./aiConnectionRecords.js";
import { assistantProviderPolicy, assistantProviderProductLabel } from "./assistantProviderPolicy.js";
import { trimmedText } from "./trimmedText.js";

async function verifyOpenCodeConnection({
  apiKey: key,
  policy,
  verifyConnection
} = {}) {
  try {
    const result = await verifyConnection({
      apiKey: key,
      engineId: "opencode",
      modelId: policy.defaultModelId,
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
      throw aiConnectionError(
        "vibe64_ai_provider_policy_stale",
        `${policy.productLabel} changed in OpenCode. Refresh its setup before connecting.`,
        409
      );
    }
    let providerReason = "";
    if (policy.modelProviderId === "zai") {
      if (error?.providerErrorCode === "1305") {
        providerReason = "Z.AI is temporarily overloaded.";
      } else if (error?.providerErrorCode === "1113") {
        providerReason = "Z.AI reports insufficient balance or no resource package.";
      }
    }
    const unavailable = error?.retryable === true || Number(error?.statusCode) >= 500;
    if (unavailable) {
      const message = `${providerReason || `${policy.productLabel} could not be reached to verify this key.`} Nothing was saved; try again later.`;
      throw aiConnectionError(
        "vibe64_ai_key_verification_unavailable",
        message,
        503,
        providerReason ? { apiKey: message } : null
      );
    }
    const message = providerReason
      ? `${providerReason} Nothing was saved. Check billing and quota, then try again.`
      : `${policy.productLabel} rejected this key or could not complete a test request. Check the key, billing, and quota, then try again.`;
    throw aiConnectionError(
      "vibe64_ai_api_key_rejected",
      message,
      422,
      { apiKey: message }
    );
  }
}

/**
 * @param {object} dependencies
 * @param {string} [dependencies.filePath]
 * @param {(change: object) => unknown} dependencies.onConnectionChanged
 * @param {(change: object, publish: () => Promise<unknown>) => Promise<unknown>} [dependencies.withConnectionChange]
 * @param {() => Promise<string[]>} dependencies.readModelIds
 * @param {(input: object) => Promise<object>} dependencies.verifyConnection
 * @param {number} [dependencies.zenModelCheckDelayMs]
 */
function createAiConnectionStore({
  filePath = "",
  onConnectionChanged,
  withConnectionChange = async (_change, publish) => publish(),
  readModelIds,
  verifyConnection,
  zenModelCheckDelayMs = ZEN_MODEL_CHECK_DELAY_MS
}) {
  if (!trimmedText(filePath)) {
    throw new TypeError("AI connections require a private store path.");
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
        throw aiConnectionError("vibe64_ai_connection_state_malformed", "AI connection state is not valid JSON.", 500);
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
        throw aiConnectionError("vibe64_ai_routing_upgrade_required",
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
      timer.unref();
    });
  }

  async function mutateZenModelCheck(job, operation) {
    return mutate(async () => {
      const state = await readState();
      const connection = state.connections[OPENCODE_ZEN_PROVIDER_ID];
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
      connection.zenModelCheck.message = trimmedText(message).slice(0, 320);
      connection.zenModelCheck.status = status;
    });
    if (zenModelChecks.get(OPENCODE_ZEN_PROVIDER_ID) === job) {
      zenModelChecks.delete(OPENCODE_ZEN_PROVIDER_ID);
    }
  }

  async function runZenModelCheck(job) {
    try {
      const currentModelIds = modelIds(await readModelIds());
      const recommended = connectionPolicy({}, OPENCODE_ZEN_PROVIDER_ID)?.defaultModelId;
      const candidates = currentModelIds
        .filter((id) => id !== RETIRED_ZEN_MODEL_ID && id !== recommended)
        .sort((left, right) => left.localeCompare(right));
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
            modelProviderId: OPENCODE_ZEN_PROVIDER_ID
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
      return Object.keys(state.connections)
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
      const requestedModelId = trimmedText(modelId);
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
        missingAccountLabel: assistantProviderProductLabel(id),
        ownerOnly: true
      };
    },
    async removeConnection(value = "") {
      const id = providerId(value);
      return mutate(async () => {
        const state = await readState();
        const previous = state.connections[id] || null;
        if (!previous) {
          return { id, ok: true, removed: false };
        }
        const zenModelCheck = zenModelChecks.get(id);
        if (zenModelCheck) {
          zenModelCheck.cancelled = true;
          zenModelChecks.delete(id);
        }
        delete state.connections[id];
        if (state.preferredProviderId === id) {
          state.preferredProviderId = "";
        }
        state.updatedAt = new Date().toISOString();
        const change = { modelProviderId: id, reason: "removed" };
        await withConnectionChange(change, () => writeState(state));
        await onConnectionChanged(change);
        return { id, ok: true, removed: true };
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
        throw aiConnectionError("vibe64_ai_endpoint_selection_required", "The owner must choose this provider's billing endpoint before it can be used.", 409);
      }
      return {
        apiKey: connection.apiKey,
        canonicalUrl: "",
        defaultModelId: route.defaultModelId,
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
      if (id === OPENCODE_ZEN_PROVIDER_ID && key === "public") {
        throw aiConnectionError(
          "vibe64_ai_public_key_unsupported",
          "Vibe64 does not use OpenCode Zen's account-free access. Paste your Zen API key.",
          400,
          { apiKey: "Paste your own OpenCode Zen API key." }
        );
      }
      if (
        trimmedText(provider?.id) !== id ||
        trimmedText(provider?.definitionRevision) !== revision
      ) {
        throw aiConnectionError("vibe64_ai_provider_revision_changed", "Refresh the provider catalogue before saving this API key.", 409);
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
          createdAt: trimmedText(previous?.createdAt) || now,
          defaultModelId: route.defaultModelId,
          endpointCode: route.endpointCode,
          fingerprint,
          label: connectionLabel(input.label, trimmedText(previous?.label) || route.productLabel || id),
          managementUrl: route.managementUrl,
          modelAccessUnlocked: previous?.modelAccessUnlocked === true,
          ownerOnly: route.ownerOnly,
          productLabel: route.productLabel,
          providerRevision: revision,
          updatedAt: now,
          ...(id === OPENCODE_ZEN_PROVIDER_ID
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
        const change = { modelProviderId: id, reason: previous ? "replaced" : "created" };
        await withConnectionChange(change, () => writeState(state));
        await onConnectionChanged(change);
        return publicConnection(stateConnection(state, id), id);
      });
    },
    async updateModelAccess(value = "", options = {}) {
      const id = providerId(value);
      const requestedOperation = trimmedText(options.operation) || (
        typeof options.unlocked === "boolean"
          ? options.unlocked ? "enable-all" : "disable-additional"
          : ""
      );
      if (![ZAI_PROVIDER_ID, OPENCODE_ZEN_PROVIDER_ID].includes(id)) {
        throw aiConnectionError("vibe64_ai_model_access_not_configurable", "This provider does not have configurable model access.", 400);
      }

      if (id === ZAI_PROVIDER_ID) {
        if (!["disable-additional", "enable-all"].includes(requestedOperation)) {
          throw aiConnectionError("vibe64_ai_model_access_invalid", "Choose whether all Z.AI models should be unlocked.", 400);
        }
        return mutate(async () => {
          const state = await readState();
          const connection = state.connections[id];
          if (!connection) {
            throw aiConnectionError("vibe64_ai_connection_required", "Connect a Z.AI API key before changing model access.", 409);
          }
          const nextUnlocked = requestedOperation === "enable-all";
          if (connection.modelAccessUnlocked === nextUnlocked) {
            return publicConnection(stateConnection(state, id), id);
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
          return publicConnection(stateConnection(state, id), id);
        });
      }

      if (!["cancel-check", "check-available", "disable-additional", "enable-all"].includes(requestedOperation)) {
        throw aiConnectionError("vibe64_ai_model_access_invalid", "Choose how OpenCode Zen models should be enabled.", 400);
      }

      if (requestedOperation === "check-available") {
        let startedJob = null;
        const connection = await mutate(async () => {
          const state = await readState();
          const current = state.connections[id];
          if (!current) {
            throw aiConnectionError("vibe64_ai_connection_required", "Add a Zen API key before checking model access.", 409);
          }
          if (zenModelChecks.has(id)) {
            return publicConnection(stateConnection(state, id), id, { activeZenCheck: true });
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
          return publicConnection(stateConnection(state, id), id, { activeZenCheck: true });
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
            throw aiConnectionError("vibe64_ai_connection_required", "Add a Zen API key before changing model access.", 409);
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
          return publicConnection(stateConnection(state, id), id, { activeZenCheck: Boolean(running) });
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
          throw aiConnectionError("vibe64_ai_connection_required", "Add a Zen API key before changing model access.", 409);
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
        return publicConnection(stateConnection(state, id), id, { activeZenCheck: false });
      });
    }
  });
}

export {
  AI_CONNECTION_KEY_MAXIMUM_CHARACTERS,
  AI_CONNECTION_LABEL_MAXIMUM_CHARACTERS,
  AI_CONNECTION_STORE_VERSION,
  OPENCODE_ZEN_PROVIDER_ID,
  RETIRED_ZEN_MODEL_ID,
  connectionFingerprint,
  createAiConnectionStore
};
