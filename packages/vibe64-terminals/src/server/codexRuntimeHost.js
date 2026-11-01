import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import path from "node:path";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { CURATED_CODEX_PROVIDERS, curatedCodexProvider, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";
import { currentCodexLoginGeneration } from "@local/vibe64-core/server/codexAuthState";
import { codexAppServerRuntimeDir, codexAppServerRuntimeHost } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { VIBE64_ASSISTANT_ENGINE_IDS, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { stableHash } from "@local/vibe64-execution/server";
import { codexGitCommandShimDirs } from "./codexTerminalAccess.js";
import { executionEnvFingerprint, loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";
import { VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV, VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV } from "./agentEnvCommand.js";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { trimmedText } from "./trimmedText.js";
import { isRecord } from "./isRecord.js";

/** @typedef {import("./types.js").CodexRuntimeHost} CodexRuntimeHost */
/** @typedef {import("./types.js").CodexAccountPreparation} CodexAccountPreparation */
/** @typedef {import("./types.js").CodexSessionEnvironment} CodexSessionEnvironment */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */

const CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER = "\u001f";
const CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS = new Set([
  VIBE64_AGENT_ENV_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_ENV_COMMAND_TOKEN_ENV,
  "VIBE64_CODEX_GIT_COMMAND_SOCKET",
  "VIBE64_CODEX_GIT_COMMAND_TOKEN"
]);

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
    model: trimmedText(metadata.agent_settings_model),
    providerId: trimmedText(metadata.agent_settings_provider),
    thinking: trimmedText(metadata.agent_settings_thinking)
  };
}

// The session's selection names its model provider. Model ids are not unique
// across providers (both Z.AI connections offer GLM 5.3), so the model id alone
// chooses one only for settings saved without a provider.
function codexSelectedModelProviderId(session) {
  const selection = vibe64AssistantSelectionFromMetadata(session?.metadata || {}, { required: false });
  return trimmedText(session?.metadata?.codex_routing_home_provider) || trimmedText(selection?.modelProviderId) ||
    trimmedText(session?.agentSettings?.modelProviderId) ||
    curatedCodexModel(session?.agentSettings?.model)?.modelProviderId || "";
}

// A thread starts on the provider its parameters or its runtime's routing name.
function codexThreadModelProvider(params = {}, routingModelProviderId = "") {
  return trimmedText(params.modelProvider) || trimmedText(routingModelProviderId) ||
    curatedCodexModel(params.model)?.modelProviderId || "openai";
}

function createCodexRuntimeHost({
  env,
  codexAppServerProviderOptions,
  codexToolHomeSource
}) {
  function resolvedCodexToolHomeSource() {
    return trimmedText(codexToolHomeSource || codexAppServerProviderOptions.toolHomeSource);
  }

  function codexRuntimeForTerminalEnv({
    terminalEnv = {},
    toolHomeSource = ""
  } = {}) {
    const selectedHome = trimmedText(toolHomeSource) || resolvedCodexToolHomeSource();
    const curated = CURATED_CODEX_PROVIDERS.find(({ id }) => codexAppServerProviderOptions.systemRoot &&
      codexProviderPaths(codexAppServerProviderOptions.systemRoot, id).toolHomeSource === selectedHome);
    // The OpenAI home's runtime belongs to one sign-in (its login generation).
    const connectionOptions = curated ? {
      ...codexProviderPaths(codexAppServerProviderOptions.systemRoot, curated.id),
      modelProviderId: curated.id,
      runtimeInstanceId: `provider:${curated.id}`
    } : codexAppServerProviderOptions.systemRoot ? {
      codexLoginGeneration: currentCodexLoginGeneration(codexAppServerProviderOptions.systemRoot)
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
    const normalizedSessionId = trimmedText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Vibe64 session ID is required.");
    }
    const runtimeIdsHash = stableHash(JSON.stringify(Array.isArray(options.runtimes) ? options.runtimes : []));
    return [
      normalizedSessionId,
      trimmedText(options.threadExecutionRoot || options.executionRoot),
      trimmedText(options.runtimeInstanceId),
      runtimeIdsHash,
      executionEnvFingerprint(codexAppServerProviderIdentityEnv(
        options.threadEnv || options.terminalEnv
      )),
      trimmedText(options.toolHomeSource),
      trimmedText(options.threadWorkdir || options.workdir),
      trimmedText(options.executionMode),
      trimmedText(options.codexLoginGeneration)
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
      executionMode = "",
      loginGeneration = ""
    ] = trimmedText(providerKey).split(CODEX_APP_SERVER_PROVIDER_KEY_DELIMITER);
    return {
      envHash: trimmedText(envHash),
      executionMode: trimmedText(executionMode),
      loginGeneration: trimmedText(loginGeneration),
      runtimeInstanceId: trimmedText(runtimeInstanceId),
      runtimesHash: trimmedText(runtimesHash),
      sessionId: trimmedText(sessionId),
      executionRoot: trimmedText(executionRoot),
      toolHomeSource: trimmedText(toolHomeSource),
      workdir: trimmedText(workdir)
    };
  }

  function codexAppServerProviderIdentityEnv(providerEnv = {}) {
    if (!providerEnv || typeof providerEnv !== "object" || Array.isArray(providerEnv)) {
      return {};
    }
    return Object.fromEntries(Object.entries(providerEnv)
      .filter(([key]) => !CODEX_APP_SERVER_PROVIDER_TRANSIENT_ENV_KEYS.has(String(key || "").trim())));
  }

  function codexAppServerRuntimeOptions({
    runtimeDir = "",
    session,
    executionRoot = "",
    terminalEnv = {},
    toolHomeSource = "",
    workdir = ""
  } = {}) {
    const runtimeContext = codexRuntimeForTerminalEnv({
      terminalEnv,
      toolHomeSource
    });
    const sharedRuntimeDir = trimmedText(runtimeDir) ||
      codexAppServerRuntimeDir(runtimeContext.providerOptions);
    const sessionId = trimmedText(session?.sessionId);
    return {
      ...runtimeContext.providerOptions,
      helperWorkdir: path.join(
        sharedRuntimeDir,
        "helper-workspaces",
        stableHash(sessionId || trimmedText(workdir) || "unattributed")
      ),
      executionMode: "",
      executionRoot: "",
      project: {},
      runtimeDir: sharedRuntimeDir,
      runtimeInstanceId: runtimeContext.providerOptions.runtimeInstanceId || "",
      session: {},
      terminalEnv: {},
      threadEnv: runtimeContext.terminalProcessEnv,
      threadExecutionRoot: trimmedText(executionRoot),
      threadWorkdir: trimmedText(workdir),
      toolHomeSource: runtimeContext.toolHomeSource,
      userKey: "",
      workdir: ""
    };
  }

  function codexAppServerRuntimeOptionsFromSessionMetadata(session, fallbackOptions = {}) {
    const metadata = session?.metadata || {};
    const runtimeDir = trimmedText(metadata.agent_transport_runtime_dir);
    if (!runtimeDir) {
      return null;
    }
    const metadataSourcePath = trimmedText(metadata.source_path);
    const metadataWorkdir = trimmedText(metadata.agent_identity_workdir) || metadataSourcePath ||
      trimmedText(fallbackOptions.workdir);
    const metadataExecutionRoot = trimmedText(fallbackOptions.executionRoot) ||
      sessionSourcePath(session) ||
      metadataSourcePath;
    const providerId = codexSelectedModelProviderId(session);
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

  return Object.freeze({
    resolvedCodexToolHomeSource,
    codexRuntimeForTerminalEnv,
    codexAppServerProviderKey,
    codexAppServerProviderKeyFields,
    codexAppServerRuntimeOptions,
    codexAppServerRuntimeOptionsFromSessionMetadata,
    codexAppServerPersistedRuntimeHost
  });
}

/**
 * @param {object} dependencies
 * @param {CodexRuntimeHost} dependencies.runtimeHost
 * @param {CodexAccountPreparation} dependencies.accountPreparation
 * @param {CodexSessionEnvironment} dependencies.sessionEnvironment
 * @param {ProjectService} dependencies.projectService
 * @param {RunVibe64Command} dependencies.runCommand
 */
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
      get executionRoot() { return trimmedText(executionRoot) || sessionSourcePath(session); },
      get workdir() { return trimmedText(workdir) || sessionSourcePath(session); }
    };
  }

  async function prepareSessionRuntimeOptions(session = {}, {
    runtime = null,
    runtimeDir = "",
    executionRoot = "",
    terminalEnv,
    toolHomeSource = "",
    workdir = ""
  } = {}, nativeContext = "execution") {
    const metadata = session.metadata || {};
    const effectiveRuntime = runtime || await createRuntimeForSession();
    const sessionId = trimmedText(session.sessionId);
    const learningRoot = effectiveRuntime.learningScope && nativeContext === "storage"
      ? (await effectiveRuntime.store.readSessionNativeDescriptor(sessionId)).nativeExecutionRoot
      : await learningSessionExecutionRoot(effectiveRuntime, sessionId, { allowClosing: nativeContext === "control" });
    if (learningRoot && (trimmedText(executionRoot) && path.resolve(executionRoot) !== learningRoot ||
        trimmedText(workdir) && path.resolve(workdir) !== learningRoot)) {
      throw new Error("Learning native execution must use its exact private session root.");
    }
    const effectiveExecutionRoot = learningRoot || trimmedText(executionRoot) || sessionSourcePath(session);
    const effectiveWorkdir = learningRoot || trimmedText(workdir) || sessionSourcePath(session);
    const suppliedTerminalEnv = isRecord(terminalEnv);
    const baseTerminalEnv = suppliedTerminalEnv
      ? terminalEnv
      : learningRoot ? {} : await loadProjectExecutionEnv({
          projectService,
          runCommand,
          runtime: effectiveRuntime,
          session,
          target: "codex"
        });
    const effectiveTerminalEnv = suppliedTerminalEnv || learningRoot
      ? baseTerminalEnv
      : {
        ...baseTerminalEnv,
        ...await codexManagedCommandEnv({
          runtime: effectiveRuntime,
          session,
          sessionId: trimmedText(session.sessionId)
        })
      };
    const selectedHome = await codexToolHomeResult(session);
    if (selectedHome.ok === false) throw new Error(selectedHome.error);
    toolHomeSource = selectedHome.toolHomeSource;
    const expectedRuntimeDir = codexAppServerRuntimeDir(codexRuntimeForTerminalEnv({ toolHomeSource }).providerOptions);
    const metadataRuntimeDir = trimmedText(metadata.agent_transport_runtime_dir);
    const reusableMetadataRuntimeDir = metadataRuntimeDir && expectedRuntimeDir &&
      path.resolve(metadataRuntimeDir) === path.resolve(expectedRuntimeDir)
      ? metadataRuntimeDir
      : "";
    return { ...codexAppServerRuntimeOptions({
      runtimeDir: trimmedText(runtimeDir) || reusableMetadataRuntimeDir || expectedRuntimeDir,
      session,
      executionRoot: effectiveExecutionRoot,
      terminalEnv: effectiveTerminalEnv,
      toolHomeSource,
      workdir: effectiveWorkdir
    }), ...(effectiveRuntime.learningScope ? { learningRuntime: effectiveRuntime } : {}),
      routingModelProviderId: vibe64AssistantSelectionFromMetadata(session.metadata, { required: false })?.modelProviderId,
      ...(session.status === VIBE64_SESSION_STATUS.RENEWAL_PENDING && trimmedText(metadata.renewal_id)
        ? { renewalId: trimmedText(metadata.renewal_id) } : {}) };
  }

  function codexAppServerRuntimeOptionsForSession(session, options) {
    return prepareSessionRuntimeOptions(session, options);
  }

  // These original owners control retained threads; neither admits new work.
  function codexAppServerControlRuntimeOptionsForSession(session, options) {
    return prepareSessionRuntimeOptions(session, options, "control");
  }

  function codexAppServerStorageRuntimeOptionsForSession(session, options) {
    return prepareSessionRuntimeOptions(session, options, "storage");
  }

  async function codexAppServerHelperRuntimeOptionsForSession(session = {}, options = {}) {
    // Resolve without provisioning, retaining the shared provider identity used
    // by interactive chat and durable helper-thread cleanup.
    return codexAppServerRuntimeOptionsForSession(session, options);
  }

  function sessionHasCodexAppServerRuntime(session = {}) {
    const metadata = session.metadata || {};
    return Boolean(
      trimmedText(metadata.agent_transport_endpoint) ||
      trimmedText(metadata.agent_transport_runtime_dir) ||
      trimmedText(metadata.agent_transport_socket_path)
    );
  }

  function codexAppServerOutputContext({ runtime, session }) {
    if (!sessionHasCodexAppServerRuntime(session)) {
      return null;
    }
    const prepared = roots => ({
      managedIdentity: codexAppServerManagedThreadIdentity(session, roots),
      providerOptions: () => codexAppServerRuntimeOptionsForSession(session, { runtime })
    });
    if (runtime?.learningScope) {
      return learningSessionExecutionRoot(runtime, session.sessionId, { allowClosing: true }).then(root => ({
        managedIdentity: codexAppServerManagedThreadIdentity(session, { executionRoot: root, workdir: root }),
        providerOptions: () => codexAppServerControlRuntimeOptionsForSession(session, { runtime })
      }));
    }
    return prepared();
  }

  return Object.freeze({
    createRuntimeForSession,
    createStoreForSession,
    codexAppServerManagedThreadIdentity,
    codexAppServerRuntimeOptionsForSession,
    codexAppServerControlRuntimeOptionsForSession,
    codexAppServerStorageRuntimeOptionsForSession,
    codexAppServerHelperRuntimeOptionsForSession,
    sessionHasCodexAppServerRuntime,
    codexAppServerOutputContext
  });
}

export { createCodexRuntimeHost, createCodexSessionRuntimeHost, codexAgentSettingsFromSession, codexSelectedModelProviderId,
  codexThreadModelProvider };
