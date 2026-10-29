import { aiConnectionError } from "./aiConnectionError.js";
import { AI_CONNECTION_PROVIDER_PATTERN } from "../shared/aiConnectionIdentity.js";
import { assistantProviderPolicy } from "./assistantProviderPolicy.js";
import { readAllOpenCodeCapabilityRows } from "./opencodeCatalogPages.js";
import { logAccountChange } from "./accountChangeLog.js";

function createAiConnectionService({ aiConnections, readAssistantCapabilities, initializeModelRouting, logger = null } = {}) {
  // OpenCode connection changes are account changes too: one line each.
  async function connectionChange(operation, { modelProviderId, vibe64User } = {}, work) {
    const startedAt = Date.now();
    const fields = { actor: String(vibe64User?.username || ""), engineId: "opencode", modelProviderId: String(modelProviderId || "") };
    try {
      const result = await work();
      logAccountChange(logger, operation, fields, result, startedAt);
      return result;
    } catch (error) {
      logAccountChange(logger, operation, fields, { ok: false, code: error?.code, error: error?.message || String(error) }, startedAt);
      throw error;
    }
  }

  function requireConnectionStore() {
    if (!aiConnections) {
      throw aiConnectionError(
        "vibe64_ai_connections_unavailable",
        "AI provider connections are unavailable on this Vibe64 host."
      );
    }
  }

  function requireAssistantCatalog() {
    if (!aiConnections || typeof readAssistantCapabilities !== "function") {
      throw aiConnectionError(
        "vibe64_ai_catalog_unavailable",
        "The OpenCode provider catalog is unavailable on this Vibe64 host.",
        503
      );
    }
  }

  function completeCapabilityPage(engine = {}, total = 0) {
    return {
      ...engine.page,
      cursor: "",
      hasMore: false,
      limit: total,
      nextCursor: "",
      total
    };
  }

  const readOpenCodeCapabilityPages = ({ currentUser, modelProviderId = "" } = {}) =>
    readAllOpenCodeCapabilityRows((query) => readAssistantCapabilities(query, currentUser), { modelProviderId });

  async function readOpenCodeProvider(modelProviderId, currentUser) {
    const id = String(modelProviderId || "").trim();
    if (!AI_CONNECTION_PROVIDER_PATTERN.test(id)) {
      throw aiConnectionError(
        "vibe64_ai_provider_invalid",
        "Choose a provider from the current OpenCode catalog.",
        400
      );
    }
    const {
      engine: firstEngine,
      provider: firstProvider,
      result: firstResult,
      rows: models
    } = await readOpenCodeCapabilityPages({ currentUser, modelProviderId: id });

    const provider = { ...firstProvider, models };
    if (provider.apiKeyCompatible === false) {
      throw aiConnectionError(
        "vibe64_ai_provider_credentials_unsupported",
        "This OpenCode provider needs additional account details that Vibe64 cannot connect yet.",
        409
      );
    }
    const policy = assistantProviderPolicy(provider);
    if (!models.some((model) => (
      model?.id === policy.defaultModelId && model?.status === "available"
    ))) {
      throw aiConnectionError(
        "vibe64_ai_provider_policy_stale",
        "This provider changed in OpenCode. Refresh its setup before connecting.",
        409
      );
    }
    return {
      engine: firstEngine,
      policy,
      provider,
      result: firstResult
    };
  }

  async function readAllOpenCodeProviders(currentUser) {
    const {
      engine: firstEngine,
      result: firstResult,
      rows: providers
    } = await readOpenCodeCapabilityPages({ currentUser });

    return {
      ...firstResult,
      engines: (firstResult?.engines || []).map((engine) => engine?.engineId === "opencode"
        ? {
            ...firstEngine,
            modelProviders: providers,
            page: completeCapabilityPage(firstEngine, providers.length)
          }
        : engine)
    };
  }

  return Object.freeze({
    async list() {
      return {
        connections: aiConnections ? await aiConnections.listConnections() : [],
        ok: true,
        unavailable: !aiConnections
      };
    },
    async catalog({ modelProviderId = "", vibe64User } = {}) {
      requireAssistantCatalog();
      modelProviderId = String(modelProviderId || "").trim();
      if (!modelProviderId) return readAllOpenCodeProviders(vibe64User);
      const { engine, policy, provider, result } = await readOpenCodeProvider(modelProviderId, vibe64User);
      const models = provider.models || [];
      return {
        ...result,
        engines: result.engines.map((candidate) => candidate?.engineId === "opencode"
          ? {
              ...engine,
              modelProviders: [{ ...provider, connectionPolicy: policy }],
              page: completeCapabilityPage(engine, models.length)
            }
          : candidate)
      };
    },
    save({ modelProviderId, vibe64User, ...input } = {}) {
      return connectionChange("save-connection", { modelProviderId, vibe64User }, async () => {
        requireConnectionStore();
        requireAssistantCatalog();
        const { provider } = await readOpenCodeProvider(modelProviderId, vibe64User);
        const connection = await aiConnections.upsertConnection({ ...input, modelProviderId }, { provider });
        // The connection is already saved. Report setup separately so a routing
        // conflict never tells the person that their working key was rejected.
        const routing = typeof initializeModelRouting === "function"
          ? await initializeModelRouting({ engineIds: ["opencode"], vibe64User }).catch((error) => ({ ok: false, error: error.message }))
          : { ok: false, error: "Open Models to finish choosing models for this connection." };
        return { connection, ok: true, routing };
      });
    },
    remove({ modelProviderId, vibe64User } = {}) {
      return connectionChange("remove-connection", { modelProviderId, vibe64User }, async () => {
        requireConnectionStore();
        return aiConnections.removeConnection(modelProviderId);
      });
    },
    modelAccess({ modelProviderId, ...input } = {}) {
      return connectionChange("update-model-access", { modelProviderId, vibe64User: input.vibe64User }, async () => {
        requireConnectionStore();
        return { connection: await aiConnections.updateModelAccess(modelProviderId, input), ok: true };
      });
    }
  });
}

export { createAiConnectionService };
