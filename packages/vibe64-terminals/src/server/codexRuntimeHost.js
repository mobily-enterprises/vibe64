import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import path from "node:path";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";
import { codexAppServerRuntimeDir, codexAppServerRuntimeHost } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { VIBE64_ASSISTANT_ENGINE_IDS, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { stableHash } from "@local/vibe64-execution/server";
import { codexGitCommandShimDirs } from "./codexTerminalAccess.js";
import { executionEnvFingerprint, loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { terminalSessionSourceRoot, terminalWorktreePath } from "./terminalShared.js";
import { VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV, VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV } from "./agentEnvCommand.js";

const CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER = "\u001f";
const CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS = new Set([
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  "VIBE64_CODEX_GIT_COMMAND_SOCKET",
  "VIBE64_CODEX_GIT_COMMAND_TOKEN"
]);
function normalizeText(value) {
  return String(value || "").trim();
}

function codexAgentSettingsFromSession(session = {}) {
  const metadata = session.metadata || {};
  const selection = vibe64AssistantSelectionFromMetadata(metadata, {
    required: false
  });
  if (selection?.engineId === VIBE64_ASSISTANT_ENGINE_IDS.CODEX) {
    return {
      model: selection.modelId,
      modelProviderId: selection.modelProviderId,
      providerId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
      thinking: selection.variantId
    };
  }
  return {
    model: normalizeText(metadata.agent_settings_model),
    providerId: normalizeText(metadata.agent_settings_provider),
    thinking: normalizeText(metadata.agent_settings_thinking)
  };
}

function createCodexRuntimeHost({
  env,
  codexAppServerProviderOptions,
  codexToolHomeSource
}) {
  function resolvedCodexToolHomeSource() {
    return normalizeText(codexToolHomeSource || codexAppServerProviderOptions.toolHomeSource);
  }

  function codexRuntimeForTerminalEnv({
    terminalEnv = {},
    toolHomeSource = ""
  } = {}) {
    const selectedHome = normalizeText(toolHomeSource) || resolvedCodexToolHomeSource();
    const curated = CURATED_CODEX_PROVIDERS.find(({ id }) => codexAppServerProviderOptions.systemRoot &&
      codexProviderPaths(codexAppServerProviderOptions.systemRoot, id).toolHomeSource === selectedHome);
    const connectionOptions = curated ? {
      ...codexProviderPaths(codexAppServerProviderOptions.systemRoot, curated.id),
      modelProviderId: curated.id,
      runtimeInstanceId: `provider:${curated.id}`
    } : {};
    const runtimeContext = codexRuntimeContext({
      env,
      providerOptions: { ...codexAppServerProviderOptions, ...connectionOptions },
      shimDirs: codexGitCommandShimDirs({ terminalEnv }),
      terminalEnv,
      toolHomeSource: selectedHome
    });
    if (runtimeContext?.ok === false) {
      throw new Error(runtimeContext.error || "Codex runtime context could not be resolved.");
    }
    if (curated) {
      runtimeContext.env.CODEX_HOME = connectionOptions.codexHome;
      runtimeContext.terminalProcessEnv.CODEX_HOME = connectionOptions.codexHome;
    }
    return runtimeContext;
  }

  function codexAppServerProviderKey(sessionId = "", options = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Vibe64 session ID is required.");
    }
    const runtimeIdsHash = stableHash(JSON.stringify(Array.isArray(options.runtimes) ? options.runtimes : []));
    return [
      normalizedSessionId,
      normalizeText(options.threadExecutionRoot || options.executionRoot),
      normalizeText(options.runtimeInstanceId),
      runtimeIdsHash,
      executionEnvFingerprint(codexAppServerProviderIdentityEnv(
        options.threadEnv || options.terminalEnv
      )),
      normalizeText(options.toolHomeSource),
      normalizeText(options.threadWorkdir || options.workdir),
      normalizeText(options.executionMode)
    ].join(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
  }

  function codexAppServerProviderKeyFields(providerKey = "") {
    const [
      sessionId = "",
      executionRoot = "",
      runtimeInstanceId = "",
      runtimesHash = "",
      envHash = "",
      toolHomeSource = "",
      workdir = "",
      executionMode = ""
    ] = normalizeText(providerKey).split(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
    return {
      envHash: normalizeText(envHash),
      executionMode: normalizeText(executionMode),
      runtimeInstanceId: normalizeText(runtimeInstanceId),
      runtimesHash: normalizeText(runtimesHash),
      sessionId: normalizeText(sessionId),
      executionRoot: normalizeText(executionRoot),
      toolHomeSource: normalizeText(toolHomeSource),
      workdir: normalizeText(workdir)
    };
  }

  function codexAppServerProviderIdentityEnv(env = {}) {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
      return {};
    }
    return Object.fromEntries(Object.entries(env)
      .filter(([key]) => !CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS.has(String(key || "").trim())));
  }

  function codexAppServerRuntimeOptions({
    runtimeDir = "",
    session = {},
    executionRoot = "",
    terminalEnv = {},
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const runtimeContext = codexRuntimeForTerminalEnv({
      terminalEnv,
      toolHomeSource
    });
    const sharedRuntimeDir = normalizeText(runtimeDir) ||
      codexAppServerRuntimeDir(runtimeContext.providerOptions);
    const sessionId = normalizeText(session?.sessionId || session?.id);
    return {
      ...runtimeContext.providerOptions,
      helperWorkdir: path.join(
        sharedRuntimeDir,
        "helper-workspaces",
        stableHash(sessionId || normalizeText(workdir) || "unattributed")
      ),
      executionMode: "",
      executionRoot: "",
      project: {},
      runtimeDir: sharedRuntimeDir,
      runtimeInstanceId: runtimeContext.providerOptions.runtimeInstanceId || "",
      session: {},
      terminalEnv: {},
      threadEnv: runtimeContext.terminalProcessEnv,
      threadExecutionRoot: normalizeText(executionRoot),
      threadWorkdir: normalizeText(workdir),
      toolHomeSource: runtimeContext.toolHomeSource,
      userKey: "",
      workdir: ""
    };
  }

  function codexAppServerRuntimeOptionsFromSessionMetadata(session = {}, fallbackOptions = {}) {
    const metadata = session?.metadata || {};
    const runtimeDir = normalizeText(metadata.agent_transport_runtime_dir);
    if (!runtimeDir) {
      return null;
    }
    const metadataSourcePath = normalizeText(metadata.source_path);
    const metadataWorkdir = normalizeText(metadata.agent_identity_workdir) || metadataSourcePath ||
      normalizeText(fallbackOptions.workdir);
    const metadataExecutionRoot = normalizeText(fallbackOptions.executionRoot) ||
      terminalSessionSourceRoot(session) ||
      metadataSourcePath;
    const selection = vibe64AssistantSelectionFromMetadata(metadata, { required: false });
    const providerId = session?.metadata?.codex_routing_home_provider || selection?.modelProviderId || curatedCodexModel(session?.agentSettings?.model)?.modelProviderId;
    const providerHome = curatedCodexProvider(providerId) && codexAppServerProviderOptions.systemRoot
      ? codexProviderPaths(codexAppServerProviderOptions.systemRoot, providerId).toolHomeSource
      : "";
    return codexAppServerRuntimeOptions({
      ...fallbackOptions,
      ...(providerHome ? { toolHomeSource: providerHome } : {}),
      runtimeDir,
      executionRoot: metadataExecutionRoot,
      workdir: metadataWorkdir
    });
  }

  function codexAppServerPersistedRuntimeHost(session = {}, fallbackOptions = {}, {
    preserveProcessExitProof = false,
    verifyOwnerScope = false
  } = {}) {
    const runtimeOptions = codexAppServerRuntimeOptionsFromSessionMetadata(session, fallbackOptions);
    if (!runtimeOptions) return null;
    return {
      ...codexAppServerRuntimeHost({
        ...runtimeOptions,
        preserveProcessExitProof,
        verifyOwnerScope
      }),
      runtimeDir: runtimeOptions.runtimeDir
    };
  }

  return {
    resolvedCodexToolHomeSource,
    codexRuntimeForTerminalEnv,
    codexAppServerProviderKey,
    codexAppServerProviderKeyFields,
    codexAppServerRuntimeOptions,
    codexAppServerRuntimeOptionsFromSessionMetadata,
    codexAppServerPersistedRuntimeHost
  };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function createCodexSessionRuntimeHost({
  runtimeHost,
  accountPreparation,
  sessionEnvironment,
  projectService,
  runCommand
}) {
  const { codexRuntimeForTerminalEnv, codexAppServerRuntimeOptions } = runtimeHost;
  const { codexToolHomeResult } = accountPreparation;
  const { codexManagedCommandEnv } = sessionEnvironment;

  function createRuntimeForSession() {
    return projectService.createRuntime({
      inspectSource: false
    });
  }

  // Provider notifications are a high-frequency stream. Creating a session
  // runtime here hydrates the persisted conversation history even
  // with inspectSource disabled; during an active turn that previously caused
  // repeated multi-megabyte reads and hundreds of MB of churn. Event handlers
  // must use this bounded store and reserve full runtimes for mutations.
  // Do not mask a regression with throttles or caches: keep the hot path bounded.
  function createStoreForSession(sessionId = "") {
    return projectService.createSessionStore({
      sessionId
    });
  }

  function codexAppServerManagedThreadIdentity(session = {}, {
    executionRoot = "",
    workdir = ""
  } = {}) {
    return {
      get executionRoot() { return normalizeText(executionRoot) || terminalSessionSourceRoot(session); },
      get workdir() { return normalizeText(workdir) || terminalWorktreePath(session); }
    };
  }

  async function codexAppServerRuntimeOptionsForSession(session = {}, {
    runtime = null,
    runtimeDir = "",
    executionRoot = "",
    terminalEnv,
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const metadata = session.metadata || {};
    const effectiveExecutionRoot = normalizeText(executionRoot) || terminalSessionSourceRoot(session);
    const effectiveWorkdir = normalizeText(workdir) || terminalWorktreePath(session);
    const effectiveRuntime = runtime || await createRuntimeForSession();
    const suppliedTerminalEnv = isRecord(terminalEnv);
    const baseTerminalEnv = suppliedTerminalEnv
      ? terminalEnv
      : await loadProjectExecutionEnv({
          projectService,
          runCommand,
          runtime: effectiveRuntime,
          session,
          target: "codex"
        });
    const effectiveTerminalEnv = suppliedTerminalEnv
      ? baseTerminalEnv
      : {
        ...baseTerminalEnv,
        ...await codexManagedCommandEnv({
          runtime: effectiveRuntime,
          session,
          sessionId: normalizeText(session.sessionId || session.id)
        })
      };
    const selectedHome = await codexToolHomeResult(session);
    if (selectedHome.ok === false) throw new Error(selectedHome.error);
    toolHomeSource = selectedHome.toolHomeSource;
    const expectedRuntimeDir = codexAppServerRuntimeDir(codexRuntimeForTerminalEnv({ toolHomeSource }).providerOptions);
    const metadataRuntimeDir = normalizeText(metadata.agent_transport_runtime_dir);
    const reusableMetadataRuntimeDir = metadataRuntimeDir && expectedRuntimeDir &&
      path.resolve(metadataRuntimeDir) === path.resolve(expectedRuntimeDir)
      ? metadataRuntimeDir
      : "";
    return { ...codexAppServerRuntimeOptions({
      runtimeDir: normalizeText(runtimeDir) || reusableMetadataRuntimeDir || expectedRuntimeDir,
      session,
      executionRoot: effectiveExecutionRoot,
      terminalEnv: effectiveTerminalEnv,
      toolHomeSource,
      workdir: effectiveWorkdir
    }), routingModelProviderId: vibe64AssistantSelectionFromMetadata(session.metadata, { required: false })?.modelProviderId,
      ...(session.status === VIBE64_SESSION_STATUS.RENEWAL_PENDING && normalizeText(metadata.renewal_id)
        ? { renewalId: normalizeText(metadata.renewal_id) } : {}) };
  }

  async function codexAppServerHelperRuntimeOptionsForSession(session = {}, options = {}) {
    // Resolve without provisioning, retaining the shared provider identity used
    // by interactive chat and durable helper-thread cleanup.
    return codexAppServerRuntimeOptionsForSession(session, options);
  }

  function sessionHasCodexAppServerRuntime(session = {}) {
    const metadata = session.metadata || {};
    return Boolean(
      normalizeText(metadata.agent_transport_endpoint) ||
      normalizeText(metadata.agent_transport_runtime_dir) ||
      normalizeText(metadata.agent_transport_socket_path)
    );
  }

  function codexAppServerOutputContext({ runtime, session }) {
    if (!sessionHasCodexAppServerRuntime(session)) {
      return null;
    }
    return {
      managedIdentity: codexAppServerManagedThreadIdentity(session),
      providerOptions: () => codexAppServerRuntimeOptionsForSession(session, { runtime })
    };
  }

  return {
    createRuntimeForSession,
    createStoreForSession,
    codexAppServerManagedThreadIdentity,
    codexAppServerRuntimeOptionsForSession,
    codexAppServerHelperRuntimeOptionsForSession,
    sessionHasCodexAppServerRuntime,
    codexAppServerOutputContext
  };
}

export { createCodexRuntimeHost, createCodexSessionRuntimeHost, codexAgentSettingsFromSession };
