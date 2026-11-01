// Prepares the OpenCode host for a session: its saved connection, private configuration and seeded state.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { genesisCommandShimDirectory, vibe64HostContextResolverPath } from "@local/vibe64-genesis/server";
import { codexAppServerRuntimeBaseDir } from "@local/vibe64-runtime/server";
import { VIBE64_ASSISTANT_ENGINE_IDS } from "@local/vibe64-runtime/shared";
import { requireCompletedNativeConversationReplacement } from "./assistantChangeover.js";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";
import { prepareOpenCodeSessionCommandEnvironment } from "./agentCommandEnvironment.js";
import { openCodeFingerprint, recordOpenCodeSessionIdentity } from "./openCodeConversationStorage.js";
import { openCodeError, throwVibe64OpenCodeError } from "./terminalShared.js";
import { openCodeModel } from "@jskit-ai/assistant-core/server/opencode-process";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").OpenCodeSharedRuntime} OpenCodeSharedRuntime */
/** @typedef {import("./types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("./types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("./types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("./types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("./types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {import("./types.js").CreateOpenCodeServerProcess} CreateOpenCodeServerProcess */
/** @typedef {typeof import("./agentCommandEnvironment.js").prepareAgentSessionCommandEnvironment} PrepareAgentSessionCommandEnvironment */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */

function connectionIdentity(connection = {}, apiKey = "") {
  const value = toText(connection.fingerprint);
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${openCodeFingerprint(apiKey)}`;
}

function requireOpenCodeConnection(value = null, modelProviderId = "") {
  const connection = normalizeObject(value);
  const apiKey = String(connection.apiKey || connection.key || "");
  const actualProviderId = toText(
    connection.modelProviderId || connection.providerId || connection.id || modelProviderId
  );
  if (!apiKey || actualProviderId !== toText(modelProviderId)) {
    throw openCodeError(
      "vibe64_assistant_connection_required",
      `Connect ${toText(modelProviderId) || "this provider"} with an API key before using OpenCode.`,
      { modelProviderId: toText(modelProviderId) }
    );
  }
  const canonicalUrl = toText(connection.canonicalUrl);
  const endpointCode = toText(connection.endpointCode);
  if (
    endpointCode &&
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(endpointCode)
  ) {
    throw openCodeError(
      "vibe64_assistant_connection_route_invalid",
      "The selected OpenCode connection has an invalid billing endpoint.",
      { modelProviderId: actualProviderId }
    );
  }
  return {
    apiKey,
    canonicalUrl,
    defaultModelId: toText(connection.defaultModelId),
    endpointCode,
    fingerprint: connectionIdentity(connection, apiKey),
    modelProviderId: actualProviderId
  };
}

/**
 * @param {object} dependencies
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {string} dependencies.command
 * @param {CreateOpenCodeServerProcess} dependencies.createServerProcess
 * @param {RuntimeEnv} dependencies.env
 * @param {() => SessionAgentManager} dependencies.getAssistantManager
 * @param {(request: object) => Promise<object[]>} dependencies.listConnections
 * @param {PrepareAgentSessionCommandEnvironment} dependencies.prepareCommandEnvironment
 * @param {ProjectService} dependencies.project
 * @param {(selection: object) => Promise<object | null>} dependencies.resolveConnection
 * @param {OpenCodeSharedRuntime} dependencies.sharedRuntime
 */
function createOpenCodeHostPreparation({
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand,
  codexGitCommand,
  command,
  createServerProcess,
  env,
  getAssistantManager,
  listConnections,
  prepareCommandEnvironment,
  project,
  resolveConnection,
  sharedRuntime
}) {
  const { processes, temporaryConversations } = sharedRuntime;
  const sessionEnvironments = new Map();

  function promptContext(conversationKind = "main", assistantScope = null) {
    if (assistantScope) {
      return {
        scope: "ephemeral",
        stableContext: assistantScope.stableContext
      };
    }
    return {
      conversationKind,
      scope: "session",
      ...(env?.VIBE64_HOST_AGENT_GUIDANCE ? { hostGuidance: env.VIBE64_HOST_AGENT_GUIDANCE } : {}),
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  function storedUpstreamSessionId(context) {
    return toText(context.session?.metadata?.opencode_conversation_id) ||
      toText(processes.get(context.key)?.upstreamSessionId);
  }

  function sharedRoots() {
    const root = path.join(codexAppServerRuntimeBaseDir({ env }), "opencode");
    const serviceDataRoot = toText(project.currentServiceDataRoot());
    if (!serviceDataRoot) {
      throw new TypeError("OpenCode requires a persistent service data root.");
    }
    return {
      cacheRoot: path.join(root, "cache"),
      dbPath: path.join(serviceDataRoot, "opencode", "opencode.db"),
      registryPath: path.join(root, "session-environments.json"),
      root,
      workdir: path.join(root, "workspace")
    };
  }

  async function writeSessionEnvironmentRegistry() {
    const { registryPath } = sharedRoots();
    const temporaryEnvironments = [...temporaryConversations.values()]
      .filter((entry) => entry.promptContext && toText(entry.conversationId))
      .map((entry) => {
        const environment = sessionEnvironments.get(entry.target?.key);
        return environment
          ? {
              ...environment,
              promptContext: entry.promptContext,
              upstreamSessionId: entry.conversationId
            }
          : null;
      })
      .filter(Boolean);
    await sharedRuntime.writeBindings(registryPath, sessionEnvironments, [
      ...sessionEnvironments.values(),
      ...temporaryEnvironments
    ]);
  }

  async function configuredConnections(context = {}, options = {}, selected = null) {
    const listed = await listConnections({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      vibe64User: options.vibe64User || null
    });
    const providerIds = new Set((Array.isArray(listed) ? listed : [])
      .map((connection) => toText(connection?.modelProviderId || connection?.id))
      .filter(Boolean));
    if (selected?.modelProviderId) {
      providerIds.add(selected.modelProviderId);
    }
    const resolved = await Promise.all([...providerIds].map(async (modelProviderId) => {
      try {
        return requireOpenCodeConnection(await resolveConnection({
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          modelProviderId,
          sessionId: context.sessionId,
          vibe64User: options.vibe64User || null
        }), modelProviderId);
      } catch (error) {
        if (modelProviderId === selected?.modelProviderId) {
          throw error;
        }
        return null;
      }
    }));
    return resolved.filter(Boolean);
  }

  async function prepareSharedProcess(context = {}, options = {}, selected = null, shimDirs = [genesisCommandShimDirectory()]) {
    const connections = await configuredConnections(context, options, selected);
    const roots = sharedRoots();
    await writeSessionEnvironmentRegistry();
    return {
      connections,
      create: createServerProcess,
      options: {
        cacheRoot: roots.cacheRoot,
        command,
        dbPath: roots.dbPath,
        env,
        execution: {
          label: "OpenCode assistant",
          operationId: "opencode-server",
          ownerId: "opencode"
        },
        privateRoot: path.join(roots.root, `private-${randomUUID()}`),
        hostContextResolver: vibe64HostContextResolverPath(),
        providerConnections: connections,
        sessionEnvironmentRegistry: roots.registryPath,
        shimDirs,
        workdir: roots.workdir
      }
    };
  }

  async function conversationHost({ connection }, options = {}) {
    if (sharedRuntime.closed) throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    const selected = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: connection.providerId,
      vibe64User: options.vibe64User || null
    }), connection.providerId);
    if (selected.apiKey !== connection.apiKey || (selected.canonicalUrl || "") !== (connection.baseURL || "")) {
      throw new Error("The selected OpenCode connection changed. Resolve the current authorized connection before continuing.");
    }
    const roots = sharedRoots();
    return {
      runtime: sharedRuntime,
      runtimeDirectory: roots.root,
      registryPath: roots.registryPath,
      allowCredentialRefresh: true,
      databasePath: roots.dbPath,
      selected,
      prepareServer: () => prepareSharedProcess({}, options, selected, [genesisCommandShimDirectory()])
    };
  }

  async function prepareProcess(context = {}, options = {}) {
    requireCompletedNativeConversationReplacement(context.session);
    if (sharedRuntime.closed) {
      throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    }
    const connection = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: context.selection.modelProviderId,
      sessionId: context.sessionId,
      vibe64User: options.vibe64User || null
    }), context.selection.modelProviderId);
    const learningRoot = await learningSessionExecutionRoot(context.runtime, context.sessionId);
    const projectContextRoot = learningRoot || path.resolve(context.runtime.projectContextRoot);
    return {
      key: context.key,
      connection,
      failure: throwVibe64OpenCodeError,
      async configure() {
        let helperModelId = "";
        if (!context.assistantScope && getAssistantManager()) {
          const helper = await getAssistantManager().resolveAssistantPurpose({ purpose: "quick_helper" }, {
            ...context,
            vibe64User: options.vibe64User || null
          }).catch(() => null);
          if (helper?.available && helper.effectiveSelection.engineId === VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE &&
              helper.effectiveSelection.modelProviderId === context.selection.modelProviderId) {
            helperModelId = helper.effectiveSelection.modelId;
          }
        }
        const commands = await prepareOpenCodeSessionCommandEnvironment(context, {
          agentDatabaseCommand,
          agentEnvCommand,
          agentPreviewCommand,
          agentSessionCommand,
          codexGitCommand,
          env,
          prepareCommandEnvironment,
          project
        });
        sessionEnvironments.set(context.key, {
          helperModelId,
          modelProviderId: context.selection.modelProviderId,
          env: commands.env,
          pathEntries: commands.shimDirs,
          projectContextRoot,
          promptContext: promptContext("main", context.assistantScope),
          sessionId: context.sessionId,
          upstreamSessionId: storedUpstreamSessionId(context),
          workdir: context.workdir
        });
        await writeSessionEnvironmentRegistry();
        const shimDirs = [genesisCommandShimDirectory()];
        return {
          prepareServer: () => prepareSharedProcess(context, options, connection, shimDirs),
          target: {
            connection,
            helperModelId,
            projectContextRoot,
            get selection() { return context.selection; },
            get sessionId() { return context.sessionId; },
            get upstreamSessionId() { return storedUpstreamSessionId(context); },
            get workdir() { return context.workdir; }
          }
        };
      },
      async onFailure() {
        sessionEnvironments.delete(context.key);
        await writeSessionEnvironmentRegistry().catch(() => null);
      }
    };
  }

  function upstreamSessionOptions(context) {
    return {
      selection: context.selection,
      model: openCodeModel(context.selection),
      workdir: context.workdir,
      invalidIdentity: () => openCodeError("vibe64_opencode_session_id_invalid", "OpenCode did not return a native conversation ID."),
      identity: {
        write(nativeId) {
          return recordOpenCodeSessionIdentity(context, nativeId);
        },
        async publish(nativeId) {
          sessionEnvironments.get(context.key).upstreamSessionId = nativeId;
          await writeSessionEnvironmentRegistry();
        }
      }
    };
  }

  return Object.freeze({
    configuredConnections,
    conversationHost,
    prepareProcess,
    prepareSharedProcess,
    promptContext,
    sessionEnvironments,
    sharedRoots,
    storedUpstreamSessionId,
    upstreamSessionOptions,
    writeSessionEnvironmentRegistry
  });
}

export {
  createOpenCodeHostPreparation,
  requireOpenCodeConnection
};
