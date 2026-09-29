import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider } from "../shared/curatedCodexProviders.js";
import { codexAuthMarkerPath, clearCodexAuthStatus, markCodexAuthReconnecting, readCodexAuthStatus } from "./codexAuthState.js";

const changes = new Map();

function codexProviderPaths(systemRoot, providerId) {
  if (!path.isAbsolute(systemRoot || "") || !curatedCodexProvider(providerId)) {
    throw new Error("Choose a supported Codex provider.");
  }
  const root = path.join(systemRoot, "ai-connections", "codex", providerId);
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
  let models = provider?.models;
  if (!models) {
    const byId = new Map();
    for (const entry of CURATED_CODEX_PROVIDERS) {
      for (const model of entry.models) byId.set(model.id, model);
    }
    models = [...byId.values()];
  }
  return {
    models: models.map((model, priority) => ({
      slug: model.id,
      display_name: model.label,
      description: model.label,
      default_reasoning_level: model.defaultThinking,
      supported_reasoning_levels: model.variants.map((effort) => ({ effort, description: effort })),
      shell_type: "shell_command",
      visibility: "list",
      supported_in_api: true,
      priority,
      base_instructions: "You are a coding assistant. Complete the user's task in the workspace, use the available tools, preserve unrelated work, and verify your changes.",
      supports_reasoning_summaries: false,
      default_reasoning_summary: "none",
      support_verbosity: false,
      truncation_policy: { mode: "bytes", limit: 10000 },
      context_window: model.contextWindow,
      max_context_window: model.contextWindow,
      effective_context_window_percent: 95,
      supports_parallel_tool_calls: true,
      experimental_supported_tools: [],
      input_modalities: model.images ? ["text", "image"] : ["text"],
      prefer_websockets: false,
      ...(model.freeformPatch ? { apply_patch_tool_type: "freeform" } : {})
    }))
  };
}

async function verifyCodexProviderKey(provider, apiKey, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${provider.baseUrl.replace(/\/$/u, "")}/responses`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.models[0].id,
        input: "Reply with OK.",
        reasoning: { effort: "low" },
        max_output_tokens: 64,
        store: false
      })
    });
  } catch {
    throw new Error(`${provider.label} could not be reached. Your previous connection is unchanged; try again.`);
  }
  // Never expose a provider's raw response, which can contain request details.
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(response.status === 401 || response.status === 403
      ? `${provider.label} rejected this key. Check the key and the required account plan.`
      : `${provider.label} could not complete a test request (HTTP ${response.status}). Check your plan or API credit.`);
  }
  const result = await response.json().catch(() => null);
  if (!result?.id || result.error || !Array.isArray(result.output) ||
      !["completed", "incomplete"].includes(result.status)) {
    throw new Error(`${provider.label} did not return a usable Responses API result. The key was not saved.`);
  }
}

async function verifyClaudeProviderKey(provider, apiKey, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${provider.claudeBaseUrl}/v1/messages`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: provider.models[0].id, max_tokens: 64,
        messages: [{ role: "user", content: "Reply with OK." }] })
    });
  } catch {
    throw new Error(`${provider.label} could not be reached through Claude Code. Your previous connection is unchanged; try again.`);
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    throw new Error(response.status === 401 || response.status === 403
      ? `${provider.label} rejected this key. Check the key and the required account plan.`
      : `${provider.label} could not complete a Claude Code test request (HTTP ${response.status}). Check your plan or API credit.`);
  }
  const result = await response.json().catch(() => null);
  if (!result?.id || result.type !== "message" || result.error || !Array.isArray(result.content)) {
    throw new Error(`${provider.label} did not return a usable Messages API result. The key was not saved.`);
  }
}

function createCodexProviderConnectionStore({
  systemRoot,
  invalidateRuntimes = async () => ({ ok: true }),
  fetchImpl = fetch
} = {}) {
  async function read(providerId) {
    const paths = codexProviderPaths(systemRoot, providerId);
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
      const saved = await read(provider.id);
      const paths = codexProviderPaths(systemRoot, provider.id);
      const status = saved ? await readCodexAuthStatus(paths.systemRoot) : null;
      const marker = saved ? await readFile(codexAuthMarkerPath(paths.systemRoot), "utf8")
        .then(JSON.parse).catch((error) => { if (error.code === "ENOENT") return null; throw error; }) : null;
      return {
        id: provider.id,
        label: provider.label,
        connected: Boolean(saved && !saved.codexDisabled && !status),
        claudeReady: Boolean(saved?.claudeReady && !status),
        configuredEngines: [
          ...(saved && !saved.codexDisabled ? ["codex"] : []),
          ...(saved?.claudeReady ? ["claude"] : [])
        ],
        connectionIdentity: marker?.connected === true && typeof marker.generation === "string"
          ? `curated:${provider.id}:${marker.generation}` : "",
        status: status?.status || (saved ? "connected" : "not_connected")
      };
    }));
  }
  async function runtimeOptions(providerId) {
    const provider = curatedCodexProvider(providerId);
    const connection = await read(providerId);
    if (!connection) throw new Error(`Connect Codex - ${provider.label} in AI Accounts first.`);
    if (connection.codexDisabled) throw new Error(`Check the saved ${provider.label} key for Codex in AI Accounts first.`);
    const paths = codexProviderPaths(systemRoot, providerId);
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
    const connection = await read(providerId);
    if (!connection) throw new Error(`Reconnect ${provider.label} before continuing.`);
    // Private control-plane data. Never return this configuration through an
    // Accounts response or put it into the model's shell environment.
    return {
      model_reasoning_summary: "none",
      web_search: provider.webSearch ? "live" : "disabled",
      [`model_providers.${providerId}`]: {
        name: provider.label, base_url: provider.baseUrl, wire_api: "responses",
        requires_openai_auth: false, experimental_bearer_token: connection.apiKey
      }
    };
  }
  async function claudeProviderSettings(providerId) {
    const provider = curatedCodexProvider(providerId);
    if (!provider) return null;
    const connection = await read(providerId);
    if (!connection) throw new Error(`Reconnect ${provider.label} before continuing.`);
    if (await readCodexAuthStatus(codexProviderPaths(systemRoot, providerId).systemRoot)) {
      throw new Error(`Reconnect ${provider.label} in AI Accounts before continuing.`);
    }
    if (!connection.claudeReady) throw new Error(`Check and reconnect ${provider.label} in AI Accounts to verify its Claude Code connection.`);
    return { providerId, apiKey: connection.apiKey,
      baseUrl: provider.claudeBaseUrl };
  }
  async function change(providerId, input = {}) {
    const provider = curatedCodexProvider(providerId);
    const paths = codexProviderPaths(systemRoot, providerId);
    const previous = changes.get(paths.connectionPath) || Promise.resolve();
    const operation = previous.catch(() => null).then(async () => {
      const previousConnection = await read(providerId);
      const removing = input.remove === true;
      const engineId = input.engineId || "codex";
      if (!["codex", "claude"].includes(engineId)) throw new Error("Choose Codex or Claude Code.");
      const key = input.useSavedKey === true ? previousConnection?.apiKey || ""
        : typeof input.apiKey === "string" ? input.apiKey.trim() : "";
      const ready = { codex: false, claude: false };
      if (!removing) {
        if (!key || key.length > 16384 || /\s/u.test(key) ||
            [...key].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
          throw new Error("Enter a valid provider API key.");
        }
        const checks = { codex: verifyCodexProviderKey, claude: verifyClaudeProviderKey };
        await checks[engineId](provider, key, fetchImpl);
        ready[engineId] = true;
        const other = engineId === "claude" ? "codex" : "claude";
        try {
          await checks[other](provider, key, fetchImpl);
          ready[other] = true;
        } catch {
          // An optional check cannot block the verified orchestrator.
        }
      }
      await markCodexAuthReconnecting(paths.systemRoot, { reason: "provider-key-change" });
      const stopped = await invalidateRuntimes({
        provider: "codex",
        includeOwned: true,
        reason: "provider-key-change",
        systemRoot: paths.systemRoot,
        toolHomeSource: paths.toolHomeSource
      });
      if (stopped?.ok === false) throw new Error("The previous connection could not be stopped. Retry before changing its key.");
      if (previousConnection) {
        // Routed Codex threads share the native runtime. Stop that runtime on
        // rotation/revocation so no loaded thread retains the superseded key.
        const shared = await invalidateRuntimes({ provider: "codex", includeOwned: true,
          reason: "provider-key-change", systemRoot });
        const claude = await invalidateRuntimes({ provider: "claude", includeOwned: true,
          reason: "provider-key-change", modelProviderId: providerId });
        if (shared?.ok === false || claude?.ok === false) throw new Error("A routed conversation could not be stopped. Retry before changing its key.");
      }
      if (removing) {
        await rm(paths.connectionPath, { force: true });
        await rm(path.join(paths.codexHome, "config.toml"), { force: true });
      } else {
        if (ready.codex) {
          const config = [
            `model = ${JSON.stringify(provider.models[0].id)}`,
            `model_provider = ${JSON.stringify(provider.id)}`,
            `model_catalog_json = ${JSON.stringify(path.join(paths.codexHome, "models.json"))}`,
            `model_reasoning_effort = ${JSON.stringify(provider.models[0].defaultThinking)}`,
            'model_reasoning_summary = "none"',
            `web_search = "${provider.webSearch ? "live" : "disabled"}"`,
            `[model_providers.${provider.id}]`,
            `name = ${JSON.stringify(provider.label)}`,
            `base_url = ${JSON.stringify(provider.baseUrl)}`,
            'wire_api = "responses"',
            'requires_openai_auth = false',
            `experimental_bearer_token = ${JSON.stringify(key)}`,
            ""
          ].join("\n");
          await privateFile(path.join(paths.codexHome, "models.json"), JSON.stringify(codexProviderModelCatalog(provider)));
          await privateFile(path.join(paths.codexHome, "config.toml"), config);
        } else {
          await rm(path.join(paths.codexHome, "config.toml"), { force: true });
        }
        await privateFile(paths.connectionPath, JSON.stringify({ apiKey: key, codexDisabled: !ready.codex, claudeReady: ready.claude }));
      }
      await privateFile(codexAuthMarkerPath(paths.systemRoot), JSON.stringify({
        connected: !removing,
        generation: randomUUID(),
        version: 1
      }));
      await clearCodexAuthStatus(paths.systemRoot);
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
