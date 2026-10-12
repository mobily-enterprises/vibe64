import {
  codexProviderModelCatalog as nativeModelCatalog,
  codexProviderConfiguration,
  codexProviderFileConfiguration,
  verifyCodexProviderKey
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { verifyClaudeProviderKey } from "@jskit-ai/assistant-core/server/claude-process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "../shared/curatedCodexProviders.js";
import { codexAuthMarkerPath, clearCodexAuthStatus, markCodexAuthReconnecting, readCodexAuthStatus } from "./codexAuthState.js";

const changes = new Map();

function codexProviderPaths(systemRoot, providerId, engineId = "codex") {
  if (!path.isAbsolute(systemRoot || "") || !curatedCodexProvider(providerId) || !["codex", "claude"].includes(engineId)) {
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

async function privateFile(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

function codexProviderModelCatalog(provider) {
  const models = provider?.models || [...new Map(CURATED_CODEX_PROVIDERS
    .flatMap(entry => entry.models).map(model => [model.id, model])).values()];
  return nativeModelCatalog({ models });
}

function createCodexProviderConnectionStore({
  systemRoot,
  invalidateRuntimes = async input => {
    await input.prepare?.();
    await input.publish?.();
    return { ok: true };
  },
  fetchImpl = fetch
} = {}) {
  async function read(providerId, engineId = "codex") {
    const paths = codexProviderPaths(systemRoot, providerId, engineId);
    try {
      const value = JSON.parse(await readFile(paths.connectionPath, "utf8"));
      return value && typeof value.apiKey === "string" && value.apiKey ? value : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async function list() {
    return Promise.all(CURATED_CODEX_PROVIDERS.map(async (provider) => {
      const states = {};
      for (const engineId of ["codex", "claude"]) {
        const saved = await read(provider.id, engineId);
        const paths = codexProviderPaths(systemRoot, provider.id, engineId);
        const status = saved ? await readCodexAuthStatus(paths.systemRoot) : null;
        const marker = saved ? await readFile(codexAuthMarkerPath(paths.systemRoot), "utf8")
          .then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; }) : null;
        states[engineId] = {
          configured: Boolean(saved), connected: Boolean(saved && !status),
          connectionIdentity: marker?.connected === true && typeof marker.generation === "string"
            ? `curated:${engineId}:${provider.id}:${marker.generation}` : "",
          status: status?.status || (saved ? "connected" : "not_connected")
        };
      }
      return {
        id: provider.id, label: provider.label,
        connected: states.codex.connected, claudeReady: states.claude.connected,
        configuredEngines: ["codex", "claude"].filter((id) => states[id].configured),
        connectionIdentity: states.codex.connectionIdentity,
        claudeConnectionIdentity: states.claude.connectionIdentity,
        status: states.codex.status,
        engineStates: states
      };
    }));
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
    return codexProviderConfiguration(provider, connection.apiKey);
  }
  async function claudeProviderSettings(providerId) {
    const provider = curatedCodexProvider(providerId);
    if (!provider) return null;
    const connection = await read(providerId, "claude");
    if (!connection) throw new Error(`Reconnect ${provider.label} before continuing.`);
    if (await readCodexAuthStatus(codexProviderPaths(systemRoot, providerId, "claude").systemRoot)) {
      throw new Error(`Reconnect ${provider.label} in AI Accounts before continuing.`);
    }
    return { providerId, apiKey: connection.apiKey,
      baseUrl: provider.claudeBaseUrl };
  }
  async function change(providerId, input = {}) {
    const provider = curatedCodexProvider(providerId);
    const engineId = input.engineId || "codex";
    const paths = codexProviderPaths(systemRoot, providerId, engineId);
    const previous = changes.get(paths.connectionPath) || Promise.resolve();
    const operation = previous.catch(() => null).then(async () => {
      const previousConnection = await read(providerId, engineId);
      const removing = input.remove === true;
      if (!["codex", "claude"].includes(engineId)) throw new Error("Choose Codex or Claude Code.");
      const key = input.useSavedKey === true ? previousConnection?.apiKey || ""
        : typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      if (!removing) {
        if (!key || key.length > 16384 || /\s/u.test(key) ||
            [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
          throw new Error("Enter a valid provider API key.");
        }
        const checks = { codex: verifyCodexProviderKey, claude: verifyClaudeProviderKey };
        await checks[engineId](provider, key, fetchImpl);
      }
      let published = false;
      const prepare = () => markCodexAuthReconnecting(paths.systemRoot, { reason: "provider-key-change" });
      const publish = async () => {
        if (removing) {
          await rm(paths.connectionPath, { force: true });
          await rm(path.join(paths.codexHome, "config.toml"), { force: true });
        } else {
          if (engineId === "codex") {
            const config = codexProviderFileConfiguration(provider, key, paths.codexHome);
            await privateFile(path.join(paths.codexHome, "models.json"), JSON.stringify(codexProviderModelCatalog(provider)));
            await privateFile(path.join(paths.codexHome, "config.toml"), config);
          } else {
            await rm(path.join(paths.codexHome, "config.toml"), { force: true });
          }
          await privateFile(paths.connectionPath, JSON.stringify({ apiKey: key }));
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
        ...(engineId === "claude" ? { prepare, publish } : {})
      });
      if (stopped?.ok === false) throw new Error(stopped.failed?.[0]?.error || "The previous connection could not be stopped. Retry before changing its key.");
      if (engineId === "codex") return publish();
      if (!published) throw new Error("Claude Code did not complete the connection change. Retry before changing its key.");
      return list();
    });
    changes.set(paths.connectionPath, operation);
    try {
      return await operation;
    } finally {
      if (changes.get(paths.connectionPath) === operation) changes.delete(paths.connectionPath);
    }
  }
  return { change, list, read, runtimeOptions, threadConfig, claudeProviderSettings };
}

export { codexProviderModelCatalog, codexProviderPaths, createCodexProviderConnectionStore };
