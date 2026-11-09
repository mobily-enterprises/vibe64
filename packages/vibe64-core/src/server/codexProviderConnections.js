import {
  codexHomeDisposablePaths,
  codexProviderModelCatalog as nativeModelCatalog,
  codexProviderConfiguration,
  codexProviderFileConfiguration,
  verifyCodexProviderKey
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { verifyClaudeProviderKey } from "@jskit-ai/assistant-core/server/claude-process";
import { checkCustomEndpoint, probeCustomEndpoint } from "@jskit-ai/assistant-core/server/custom-endpoint";
import { CUSTOM_AI_MINIMUM_CONTEXT, CUSTOM_AI_PROVIDER_ID } from "@jskit-ai/assistant-core/shared/native-providers";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { serializeByKey, writeFileAtomic } from "./atomicFile.js";
import { vibe64Error } from "./core.js";
import {
  CURATED_CODEX_PROVIDERS,
  curatedCodexProvider,
  curatedProviderEngines,
  customEndpointProvider
} from "../shared/curatedCodexProviders.js";
import { doNothing } from "../shared/doNothing.js";
import { codexAuthMarkerPath, clearCodexAuthStatus, markCodexAuthReconnecting, readCodexAuthStatus } from "./codexAuthState.js";

const changes = new Map();

function codexProviderPaths(systemRoot, providerId, engineId = "codex") {
  if (!path.isAbsolute(systemRoot || "") || !curatedCodexProvider(providerId) ||
      !curatedProviderEngines(providerId).includes(engineId)) {
    throw new Error("Choose a supported Codex or Claude Code provider.");
  }
  const root = path.join(systemRoot, "ai-connections", engineId, providerId);
  const home = path.join(root, "home");
  return {
    systemRoot: root,
    toolHomeSource: home,
    codexHome: path.join(home, ".codex"),
    connectionPath: path.join(root, "connection.json")
  };
}

const CUSTOM_MAXIMUM_CONTEXT = 10_000_000;
// Names the custom endpoint's Codex home to a runtime process that serves it.
const CODEX_CUSTOM_HOME_ENV = "VIBE64_CODEX_CUSTOM_HOME";
const ENGINE_LABELS = Object.freeze({ codex: "Codex", claude: "Claude Code", opencode: "OpenCode" });

function validCustomConnection(value) {
  return typeof value?.baseUrl === "string" && value.baseUrl !== "" && typeof value.model === "string" && value.model !== "" &&
    Number.isSafeInteger(value.contextWindow) && typeof value.apiKey === "string";
}

function invalidKey(key) {
  return key.length > 16384 || /\s/u.test(key) ||
    [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

/**
 * The endpoint fields a person entered: an http(s) base URL without
 * credentials, the server's exact model name and the context the server loads.
 * Any address is accepted; it only has to be reachable from this computer.
 */
function customEndpointInput(input) {
  const text = (value) => typeof value === "string" ? value.trim() : "";
  const baseUrl = text(input.baseUrl).replace(/\/+$/u, "");
  let url = null;
  try {
    url = baseUrl.length <= 2048 ? new URL(baseUrl) : null;
  } catch {
    url = null;
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw vibe64Error("Enter the server's base URL, starting with http:// or https://.", "vibe64_custom_endpoint_url_invalid");
  }
  const model = text(input.model);
  if (!model || model.length > 256 || invalidKey(model)) {
    throw vibe64Error("Enter the model name exactly as your server lists it.", "vibe64_custom_endpoint_model_invalid");
  }
  const contextWindow = Number(input.contextWindow);
  if (!Number.isSafeInteger(contextWindow) || contextWindow < CUSTOM_AI_MINIMUM_CONTEXT || contextWindow > CUSTOM_MAXIMUM_CONTEXT) {
    throw vibe64Error(
      `Enter a context length of at least ${CUSTOM_AI_MINIMUM_CONTEXT.toLocaleString("en-US")} tokens.`,
      "vibe64_custom_endpoint_context_invalid"
    );
  }
  return { baseUrl, model, contextWindow };
}

/** The provider a saved connection routes to: a fixed one, or the endpoint it names. */
function connectionProvider(providerId, engineId, connection) {
  return providerId === CUSTOM_AI_PROVIDER_ID ? customEndpointProvider(engineId, connection) : curatedCodexProvider(providerId);
}

function privateFile(filePath, contents) {
  return writeFileAtomic(filePath, contents, { directoryMode: 0o700, fileMode: 0o600 });
}

function codexProviderModelCatalog(provider) {
  const models = provider?.models || [...new Map(CURATED_CODEX_PROVIDERS
    .flatMap(entry => entry.models).map(model => [model.id, model])).values()];
  return nativeModelCatalog({ models });
}

/**
 * A store with no agent runtimes to stop: a Claude key change still runs its own steps before and after the stop.
 * @param {{ prepare?: () => Promise<unknown>, publish?: () => Promise<unknown> }} request
 */
async function changeKeyWithoutRuntimes({ prepare = doNothing, publish = doNothing }) {
  await prepare();
  await publish();
  return { ok: true };
}

/**
 * @param {object} options
 * @param {string} options.systemRoot
 * @param {(request: object) => Promise<{ ok?: boolean, failed?: Array<{ error?: string }> }>} [options.invalidateRuntimes]
 *   stops the agent runtimes that use a provider whose key changes
 * @param {typeof fetch} [options.fetchImpl]
 */
function createCodexProviderConnectionStore({
  systemRoot,
  invalidateRuntimes = changeKeyWithoutRuntimes,
  fetchImpl = fetch
}) {
  async function read(providerId, engineId = "codex") {
    const paths = codexProviderPaths(systemRoot, providerId, engineId);
    try {
      const value = JSON.parse(await readFile(paths.connectionPath, "utf8"));
      if (providerId === CUSTOM_AI_PROVIDER_ID) return validCustomConnection(value) ? value : null;
      return value && typeof value.apiKey === "string" && value.apiKey ? value : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  /**
   * One curated provider's connection as the AI Accounts list shows it.
   * @param {object} provider a curated provider
   */
  async function providerConnection(provider) {
    const states = {};
    const engines = curatedProviderEngines(provider.id);
    for (const engineId of engines) {
      const saved = await read(provider.id, engineId);
      const paths = codexProviderPaths(systemRoot, provider.id, engineId);
      const status = saved ? await readCodexAuthStatus(paths.systemRoot) : null;
      const marker = saved ? await readFile(codexAuthMarkerPath(paths.systemRoot), "utf8")
        .then(JSON.parse).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }) : null;
      states[engineId] = {
        configured: Boolean(saved),
        connected: Boolean(saved && !status),
        connectionIdentity: marker?.connected === true && typeof marker.generation === "string"
          ? `curated:${engineId}:${provider.id}:${marker.generation}` : "",
        status: status?.status || (saved ? "connected" : "not_connected"),
        // What the owner entered, never the key itself.
        ...(saved && provider.custom ? {
          endpoint: {
            baseUrl: saved.baseUrl,
            model: saved.model,
            contextWindow: saved.contextWindow,
            keySaved: saved.apiKey !== ""
          }
        } : {})
      };
    }
    return {
      id: provider.id,
      label: provider.label,
      connected: states.codex.connected,
      claudeReady: states.claude.connected,
      configuredEngines: engines.filter((id) => states[id].configured),
      connectionIdentity: states.codex.connectionIdentity,
      claudeConnectionIdentity: states.claude.connectionIdentity,
      status: states.codex.status,
      engineStates: states
    };
  }
  async function list() {
    return Promise.all(CURATED_CODEX_PROVIDERS.map(providerConnection));
  }
  /**
   * One curated provider's connection, as list() shows it, reading only that
   * provider's files; null for a provider that is not curated.
   * @param {string} providerId
   */
  async function connectionFor(providerId) {
    const provider = curatedCodexProvider(providerId);
    return provider ? providerConnection(provider) : null;
  }
  async function runtimeOptions(providerId) {
    const provider = curatedCodexProvider(providerId);
    const connection = await read(providerId, "codex");
    if (!connection) throw new Error(`Connect Codex - ${provider.label} in AI Accounts first.`);
    const paths = codexProviderPaths(systemRoot, providerId, "codex");
    const status = await readCodexAuthStatus(paths.systemRoot);
    if (status) throw new Error(`Reconnect Codex - ${provider.label} in AI Accounts before continuing.`);
    return {
      ...paths,
      modelProviderId: providerId,
      runtimeInstanceId: `provider:${providerId}`
    };
  }
  async function threadConfig(providerId) {
    const provider = curatedCodexProvider(providerId);
    if (!provider) return {};
    await runtimeOptions(providerId);
    const connection = await read(providerId, "codex");
    if (!connection) throw new Error(`Reconnect ${provider.label} before continuing.`);
    // Private control-plane data. Never return this configuration through an
    // Accounts response or put it into the model's shell environment.
    return codexProviderConfiguration(connectionProvider(providerId, "codex", connection), connection.apiKey);
  }
  async function claudeProviderSettings(providerId) {
    const provider = curatedCodexProvider(providerId);
    if (!provider) return null;
    const connection = await read(providerId, "claude");
    if (!connection) throw new Error(`Reconnect ${provider.label} before continuing.`);
    if (await readCodexAuthStatus(codexProviderPaths(systemRoot, providerId, "claude").systemRoot)) {
      throw new Error(`Reconnect ${provider.label} in AI Accounts before continuing.`);
    }
    const route = connectionProvider(providerId, "claude", connection);
    return {
      providerId,
      apiKey: connection.apiKey,
      baseUrl: route.claudeBaseUrl,
      ...(route.custom ? { provider: route } : {})
    };
  }
  /**
   * The custom endpoint OpenCode connects to, with its key, or null.
   */
  async function openCodeEndpoint() {
    const connection = await read(CUSTOM_AI_PROVIDER_ID, "opencode");
    if (!connection) return null;
    if (await readCodexAuthStatus(codexProviderPaths(systemRoot, CUSTOM_AI_PROVIDER_ID, "opencode").systemRoot)) return null;
    return { ...connection, provider: customEndpointProvider("opencode", connection) };
  }
  /**
   * Whether each engine's saved custom endpoint answers: one model-list read
   * each, never a model request. Health reads it; nothing polls.
   */
  async function customEndpointReachability() {
    const saved = await Promise.all(curatedProviderEngines(CUSTOM_AI_PROVIDER_ID).map(async (engineId) =>
      ({ engineId, connection: await read(CUSTOM_AI_PROVIDER_ID, engineId) })));
    return Promise.all(saved.filter(({ connection }) => connection).map(async ({ engineId, connection }) => ({
      engineId,
      baseUrl: connection.baseUrl,
      model: connection.model,
      answers: await probeCustomEndpoint({ engineId, baseUrl: connection.baseUrl, fetchImpl })
    })));
  }
  async function change(providerId, input = {}) {
    const engineId = input.engineId || "codex";
    const paths = codexProviderPaths(systemRoot, providerId, engineId);
    const custom = providerId === CUSTOM_AI_PROVIDER_ID;
    return serializeByKey(changes, paths.connectionPath, async () => {
      const previousConnection = await read(providerId, engineId);
      const removing = input.remove === true;
      const key = input.useSavedKey === true ? previousConnection?.apiKey || ""
        : typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      const endpoint = custom && !removing ? customEndpointInput(input) : null;
      const provider = endpoint ? customEndpointProvider(engineId, endpoint) : curatedCodexProvider(providerId);
      if (!removing) {
        // A custom endpoint may need no key.
        if ((!key && !custom) || invalidKey(key)) {
          throw vibe64Error("Enter a valid provider API key.", "vibe64_invalid_provider_api_key");
        }
        if (custom) {
          try {
            await checkCustomEndpoint({ engineId, ...endpoint, apiKey: key, fetchImpl });
          } catch (error) {
            if (!String(error?.code || "").startsWith("custom_endpoint_")) throw error;
            throw vibe64Error(error.message, `vibe64_${error.code}`);
          }
        } else {
          const checks = { codex: verifyCodexProviderKey, claude: verifyClaudeProviderKey };
          await checks[engineId](provider, key, fetchImpl);
        }
      }
      let published = false;
      const prepare = () => markCodexAuthReconnecting(paths.systemRoot, { reason: "provider-key-change" });
      const publish = async () => {
        if (removing) {
          await rm(paths.connectionPath, { force: true });
          await rm(path.join(paths.codexHome, "config.toml"), { force: true });
          // Its runtimes are stopped and it cannot launch again. Its diagnostic
          // logs and temporary files go; state that retained chats read stays.
          for (const entry of await codexHomeDisposablePaths(paths.codexHome, { retired: true })) {
            await rm(entry, { recursive: true, force: true });
          }
        } else {
          if (engineId === "codex") {
            const config = codexProviderFileConfiguration(provider, key, paths.codexHome);
            await privateFile(path.join(paths.codexHome, "models.json"), JSON.stringify(codexProviderModelCatalog(provider)));
            await privateFile(path.join(paths.codexHome, "config.toml"), config);
          } else {
            await rm(path.join(paths.codexHome, "config.toml"), { force: true });
          }
          await privateFile(paths.connectionPath, JSON.stringify(endpoint ? { ...endpoint, apiKey: key } : { apiKey: key }));
        }
        await privateFile(codexAuthMarkerPath(paths.systemRoot), JSON.stringify({
          connected: !removing,
          generation: randomUUID(),
          version: 1
        }));
        await clearCodexAuthStatus(paths.systemRoot);
        published = true;
        return list();
      };
      if (engineId === "codex") await prepare();
      const stopped = await invalidateRuntimes({
        provider: engineId,
        modelProviderId: providerId,
        includeOwned: true,
        reason: "provider-key-change",
        systemRoot: paths.systemRoot,
        toolHomeSource: paths.toolHomeSource,
        ...(engineId === "codex" ? {} : { prepare, publish })
      });
      if (stopped?.ok === false) {
        throw new Error(stopped.failed?.[0]?.error || "The previous connection could not be stopped. Retry before changing its key.");
      }
      if (engineId === "codex") return publish();
      if (!published) throw new Error(`${ENGINE_LABELS[engineId]} did not complete the connection change. Retry before changing its key.`);
      return list();
    });
  }
  return Object.freeze({
    change,
    connectionFor,
    customEndpointReachability,
    list,
    read,
    runtimeOptions,
    threadConfig,
    claudeProviderSettings,
    openCodeEndpoint
  });
}

export { CODEX_CUSTOM_HOME_ENV, codexProviderModelCatalog, codexProviderPaths, createCodexProviderConnectionStore };
