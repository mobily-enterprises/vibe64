import { randomUUID } from "node:crypto";
import path from "node:path";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import {
  openCodeAssistantCapabilities,
  openCodeConfiguredAssistantCapabilities,
  openCodeHasConnection
} from "./agent/providers/opencodeAssistantCatalog.js";
import { openCodeError } from "./terminalShared.js";
import { requireOpenCodeConnection } from "./opencodeServerProcess.js";
import { normalizeText } from "@local/vibe64-core/server/core";
import { record } from "./record.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").OpenCodeMainMessagePreparation} OpenCodeMainMessagePreparation */
/** @typedef {typeof import("./opencodeServerProcess.js").createOpenCodeServerProcess} CreateOpenCodeServerProcess */
/** @typedef {import("./types.js").OpenCodeHostPreparation} OpenCodeHostPreparation */

const OPENCODE_CATALOG_CACHE_MS = 10 * 60 * 1000;

/**
 * Application account visibility and catalogue policy use the existing native probes.
 * @param {object} dependencies
 * @param {string} dependencies.command
 * @param {CreateOpenCodeServerProcess} dependencies.createServerProcess
 * @param {RuntimeEnv} dependencies.env
 * @param {(request: object) => Promise<object[]>} dependencies.listConnections
 * @param {typeof import("./opencodeServerProcess.js").readOpenCodeCatalog} dependencies.readCatalogCommand
 * @param {typeof import("./opencodeServerProcess.js").readOpenCodeZenModelIds} dependencies.readZenModelsCommand
 * @param {OpenCodeHostPreparation["sharedRoots"]} dependencies.sharedRoots
 * @param {typeof import("./opencodeServerProcess.js").verifyOpenCodeApiKey} dependencies.verifyConnectionCommand
 * @param {OpenCodeMainMessagePreparation} dependencies.mainMessagePreparation
 * @param {(selection: object) => Promise<object | null>} dependencies.resolveConnection
 */
function createOpenCodeConversationAccounts({
  command,
  createServerProcess,
  env,
  listConnections,
  readCatalogCommand,
  readZenModelsCommand,
  sharedRoots,
  verifyConnectionCommand,
  mainMessagePreparation,
  resolveConnection
}) {
  const { contextFor } = mainMessagePreparation;
  let catalogRead = null;
  let catalogSnapshot = null;

  async function readCatalog() {
    if (catalogSnapshot && Date.now() - catalogSnapshot.readAt < OPENCODE_CATALOG_CACHE_MS) {
      return catalogSnapshot;
    }
    if (catalogRead) {
      return catalogRead;
    }
    catalogRead = Promise.resolve().then(async () => {
      const roots = sharedRoots();
      // The managed process changes model defaults and output limits. Always
      // fingerprint the same credential-free catalogue used during connection setup.
      const [catalog, zenModelIds] = await Promise.all([
        readCatalogCommand({
          cacheRoot: roots.cacheRoot,
          command,
          createServerProcess,
          env,
          privateRoot: path.join(roots.root, `catalog-${randomUUID()}`),
          workdir: roots.workdir
        }),
        readZenModelsCommand()
      ]);
      catalogSnapshot = {
        agents: catalog.agents,
        providers: catalog.providers,
        readAt: Date.now(),
        zenModelIds
      };
      return catalogSnapshot;
    });
    try {
      return await catalogRead;
    } finally {
      catalogRead = null;
    }
  }

  async function capabilities(input = {}, options = {}) {
    const listed = listConnections({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      vibe64User: options.vibe64User || null
    });
    // The live catalogue starts a temporary `opencode serve`; a connected-only
    // read has nothing to offer without a connection, so it never starts one.
    if (normalizeText(input.configuredOnly).toLowerCase() === "true" ||
        normalizeText(input.connectedOnly).toLowerCase() === "true" && !openCodeHasConnection(await listed)) {
      return openCodeConfiguredAssistantCapabilities({ connections: await listed });
    }
    const [catalog, connections] = await Promise.all([readCatalog(), listed]);
    return openCodeAssistantCapabilities({
      agents: catalog.agents,
      connections,
      input,
      providers: catalog.providers,
      zenModelIds: catalog.zenModelIds
    });
  }

  async function verifyConnection(input = {}) {
    if (normalizeText(input.engineId) !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
      throw openCodeError(
        "vibe64_assistant_engine_invalid",
        "OpenCode connection verification requires the OpenCode engine.",
        { engineId: normalizeText(input.engineId) },
        400
      );
    }
    const modelProviderId = normalizeText(input.modelProviderId);
    const modelId = normalizeText(input.modelId);
    const catalog = await readCatalog();
    const provider = (Array.isArray(catalog.providers?.all) ? catalog.providers.all : [])
      .find((candidate) => normalizeText(candidate?.id) === modelProviderId);
    const providerModels = record(provider?.models);
    const model = Object.hasOwn(providerModels, modelId) ? providerModels[modelId] : null;
    const currentZenModelIds = new Set(Array.isArray(catalog.zenModelIds)
      ? catalog.zenModelIds
      : []);
    const currentZenModel = modelProviderId === "opencode" && currentZenModelIds.has(modelId);
    if (
      !provider ||
      (modelProviderId === "opencode"
        ? !currentZenModel
        : !model || normalizeText(model.status) === "deprecated")
    ) {
      throw openCodeError(
        "vibe64_assistant_catalog_stale",
        "The selected OpenCode provider model is no longer available. Refresh the provider catalogue and try again.",
        { modelId, modelProviderId },
        409
      );
    }
    const roots = sharedRoots();
    return verifyConnectionCommand({
      apiKey: String(input.apiKey || ""),
      cacheRoot: roots.cacheRoot,
      command,
      env,
      modelId,
      modelProviderId,
      privateRoot: path.join(roots.root, `verify-${randomUUID()}`),
      workdir: roots.workdir
    });
  }

  async function describeProvider(sessionId, options = {}) {
    const context = await contextFor(sessionId, options);
    const connection = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: context.selection.modelProviderId,
      sessionId: context.sessionId,
      vibe64User: options.vibe64User || null
    }), context.selection.modelProviderId);
    return {
      accountIdentitySignature: connection.fingerprint,
      providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      transportId: "opencode_server"
    };
  }

  return Object.freeze({
    capabilities,
    describeProvider,
    verifyConnection
  });
}

export { createOpenCodeConversationAccounts, OPENCODE_CATALOG_CACHE_MS };
