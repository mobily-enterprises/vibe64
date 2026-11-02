import { aiConnectionError } from "./aiConnectionError.js";
import { AI_CONNECTION_PROVIDER_PATTERN } from "../shared/aiConnectionIdentity.js";
import { assistantProviderPolicy } from "./assistantProviderPolicy.js";
import { readAllOpenCodeCapabilityRows } from "./opencodeCatalogPages.js";
import { runLoggedAccountChange } from "./accountChangeLog.js";

/** @typedef {import("./types.js").AiConnectionStore} AiConnectionStore */
/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").AiConnectionService} AiConnectionService */
/** @typedef {import("./types.js").AccountsRequireAiManagement} AccountsRequireAiManagement */

/**
 * @param {object} dependencies
 * @param {AiConnectionStore} dependencies.aiConnections
 * @param {(query: object, vibe64User: object | null) => Promise<object>} dependencies.readAssistantCapabilities
 * @param {AccountsService["initializeModelRouting"]} dependencies.initializeModelRouting
 * @param {RuntimeLogger} dependencies.logger
 */
function createAiConnectionService({
  aiConnections,
  readAssistantCapabilities,
  initializeModelRouting,
  logger
}) {
  /**
   * OpenCode connection changes are account changes too: one line each.
   */
  function connectionChange(operation, { modelProviderId, vibe64User }, work) {
    return runLoggedAccountChange(
      logger,
      operation,
      { actor: String(vibe64User?.username || ""), engineId: "opencode", modelProviderId: String(modelProviderId || "") },
      work
    );
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

  const readOpenCodeCapabilityPages = ({ currentUser, modelProviderId = "" }) =>
    readAllOpenCodeCapabilityRows((query) => readAssistantCapabilities(query, currentUser), { modelProviderId });

  async function readOpenCodeProvider(modelProviderId, currentUser) {
    const id = String(modelProviderId || "").trim();
    if (!AI_CONNECTION_PROVIDER_PATTERN.test(id)) {
      throw aiConnectionError(
        "vibe64_ai_provider_not_in_catalog",
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
        "vibe64_ai_provider_catalog_changed",
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

  async function list() {
    return {
      connections: await aiConnections.listConnections(),
      ok: true,
      unavailable: false
    };
  }

  async function catalog({ modelProviderId, vibe64User }) {
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
  }

  function save({ modelProviderId, vibe64User, ...input }) {
    return connectionChange("save-connection", { modelProviderId, vibe64User }, async () => {
      const { provider } = await readOpenCodeProvider(modelProviderId, vibe64User);
      const connection = await aiConnections.upsertConnection({ ...input, modelProviderId }, { provider });
      // The connection is already saved. Report setup separately so a routing
      // conflict never tells the person that their working key was rejected.
      const routing = await initializeModelRouting({ engineIds: ["opencode"], vibe64User })
        .catch((error) => ({ ok: false, error: error.message }));
      return { connection, ok: true, routing };
    });
  }

  function remove({ modelProviderId, vibe64User }) {
    return connectionChange("remove-connection", { modelProviderId, vibe64User }, () => aiConnections.removeConnection(modelProviderId));
  }

  function modelAccess({ modelProviderId, ...input }) {
    return connectionChange("update-model-access", { modelProviderId, vibe64User: input.vibe64User }, async () => {
      return { connection: await aiConnections.updateModelAccess(modelProviderId, input), ok: true };
    });
  }

  return Object.freeze({
    list,
    catalog,
    save,
    remove,
    modelAccess
  });
}

/**
 * The AI connection operations as only whoever manages AI may run them: each refuses anyone else, with status 403,
 * before it reaches the connection service.
 * @param {object} dependencies
 * @param {AiConnectionService} dependencies.aiConnectionService
 * @param {AccountsRequireAiManagement} dependencies.requireAiManagement
 */
function createManagedAiConnections({ aiConnectionService, requireAiManagement }) {
  /**
   * The refusal for a person who may not manage AI here, or null.
   * @param {object} input
   */
  async function managementRefusal(input) {
    const denied = await requireAiManagement({ vibe64User: input.vibe64User });
    return denied ? { ...denied, statusCode: 403 } : null;
  }

  /**
   * @param {object} input
   */
  async function list(input) {
    return await managementRefusal(input) || aiConnectionService.list(input);
  }

  /**
   * @param {object} input
   */
  async function catalog(input) {
    return await managementRefusal(input) || aiConnectionService.catalog(input);
  }

  /**
   * @param {object} input
   */
  async function save(input) {
    return await managementRefusal(input) || aiConnectionService.save(input);
  }

  /**
   * @param {object} input
   */
  async function remove(input) {
    return await managementRefusal(input) || aiConnectionService.remove(input);
  }

  /**
   * @param {object} input
   */
  async function modelAccess(input) {
    return await managementRefusal(input) || aiConnectionService.modelAccess(input);
  }

  return Object.freeze({
    list,
    catalog,
    save,
    remove,
    modelAccess
  });
}

export { createAiConnectionService, createManagedAiConnections };
