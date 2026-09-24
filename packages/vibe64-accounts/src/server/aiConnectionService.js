import { AI_CONNECTION_PROVIDER_PATTERN } from "./aiConnectionStore.js";
import { assistantProviderPolicy } from "./assistantProviderPolicy.js";

function aiConnectionError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function createAiConnectionService({ aiConnections, readAssistantCapabilities, initializeModelRouting } = {}) {
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

  async function readOpenCodeCapabilityPages({
    currentUser,
    modelProviderId = ""
  } = {}) {
    const rows = [];
    const seenCursors = new Set();
    let cursor = "";
    let firstResult = null;
    let firstEngine = null;
    let firstProvider = null;
    do {
      const result = await readAssistantCapabilities({
        ...(cursor ? { cursor } : {}),
        engineId: "opencode",
        limit: "100",
        ...(modelProviderId ? { modelProviderId } : {})
      }, currentUser);
      const engine = Array.isArray(result?.engines)
        ? result.engines.find((candidate) => candidate?.engineId === "opencode")
        : null;
      if (!engine) {
        throw aiConnectionError(
          "vibe64_ai_catalog_invalid",
          "OpenCode returned an invalid provider catalog.",
          502
        );
      }
      const provider = modelProviderId
        ? (Array.isArray(engine.modelProviders)
            ? engine.modelProviders.find((candidate) => candidate?.id === modelProviderId)
            : null)
        : null;
      if (modelProviderId && !provider) {
        throw aiConnectionError(
          "vibe64_ai_provider_unavailable",
          "The current OpenCode catalog did not return this provider.",
          404
        );
      }
      firstResult ||= result;
      firstEngine ||= engine;
      firstProvider ||= provider;
      rows.push(...(modelProviderId
        ? (Array.isArray(provider.models) ? provider.models : [])
        : (Array.isArray(engine.modelProviders) ? engine.modelProviders : [])));
      cursor = engine.page?.hasMore === true
        ? String(engine.page.nextCursor || "").trim()
        : "";
      if (cursor && seenCursors.has(cursor)) {
        throw aiConnectionError(
          "vibe64_ai_catalog_cursor_stalled",
          "OpenCode could not finish reading its provider catalog.",
          502
        );
      }
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return { engine: firstEngine, provider: firstProvider, result: firstResult, rows };
  }

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
      model?.id === policy.economyModelId && model?.status === "available"
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
    async save({ modelProviderId, vibe64User, ...input } = {}) {
      requireConnectionStore();
      requireAssistantCatalog();
      const { provider } = await readOpenCodeProvider(modelProviderId, vibe64User);
      const connection = await aiConnections.upsertConnection({ ...input, modelProviderId }, { provider });
      // The connection is already saved. Report setup separately so a routing
      // conflict never tells the person that their working key was rejected.
      const routing = typeof initializeModelRouting === "function"
        ? await initializeModelRouting({ engineIds: ["opencode"], vibe64User }).catch((error) => ({ ok: false, error: error.message }))
        : { ok: false, error: "Open Model routing to finish choosing models for this connection." };
      return { connection, ok: true, routing };
    },
    remove({ modelProviderId } = {}) {
      requireConnectionStore();
      return aiConnections.removeConnection(modelProviderId);
    },
    async modelAccess({ modelProviderId, ...input } = {}) {
      requireConnectionStore();
      return { connection: await aiConnections.updateModelAccess(modelProviderId, input), ok: true };
    }
  });
}

export { createAiConnectionService };
