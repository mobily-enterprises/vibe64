import { sessionContextUsageFromMetadata } from "../../codexContextRenewalSignals.js";
import { renewalArchivedPredecessorContext, renewalSuccessorProcessExitProofReleaseContext } from "../../sessionRenewalHandover.js";
import { beginTerminalNamespaceOperation } from "@local/vibe64-execution/server/terminalSessions";
import {
  codexCatalogRows as nativeCodexCatalogRows,
  codexCatalogReasoningEfforts,
  codexCatalogModels,
  codexConfiguredModelCatalog,
  readCodexModelContextWindow
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { withCodexState } from "../../codexConversationStorage.js";
import { prepareCodexModelRouting } from "../../nativeConversationRetirement.js";
import { codexTerminalNamespace, vibe64Result } from "../../terminalShared.js";
import { CURATED_CODEX_PROVIDERS, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createHash } from "node:crypto";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  Vibe64AgentExecutionProfileError,
  defineVibe64HelperExecutionProfileResolution,
  emitVibe64AgentExecutionProfile,
  findVibe64AgentProvider,
  vibe64HelperExecutionProfileRequest
} from "@local/vibe64-runtime/shared";
import {
  codexAttachmentLimitResult,
  renewAcceptedCodexAttachments,
  validateCodexAttachmentsBeforeDelivery
} from "./codexAttachmentDelivery.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("../../types.js").CodexAppServerRunOwner} CodexAppServerRunOwner */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/codex-provider").createCodexAppServerProviderOwner>} CodexAppServerProviderOwner */
/** @typedef {import("../../types.js").CodexConversationPreparation} CodexConversationPreparation */
/** @typedef {ReturnType<typeof import("../../codexLifecyclePreparation.js").createCodexLifecyclePreparation>} CodexLifecyclePreparation */
/** @typedef {ReturnType<typeof import("../../sessionRenewalReceipts.js").createCodexSessionRenewalPreparation>} CodexSessionRenewalPreparation */
/** @typedef {ReturnType<typeof import("../../codexConversationStorage.js").createCodexConversationStorage>} CodexConversationStorage */
/** @typedef {ReturnType<typeof import("../../codexAssistantCatalog.js").createCodexAssistantCatalog>} CodexAssistantCatalog */
/** @typedef {ReturnType<typeof import("../../codexInteractiveTerminals.js").createCodexInteractiveTerminals>} CodexInteractiveTerminals */
/** @typedef {ReturnType<typeof import("../../sessionAttachments.js").createCodexSessionAttachmentRenewal>} CodexSessionAttachmentRenewal */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("../../types.js").CodexSessionTurnCheckpoint} CodexSessionTurnCheckpoint */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("../../types.js").ListAssistantConnections} ListAssistantConnections */

const CODEX_HELPER_PROFILE_REVISION = "codex-helper-selected-v4";
function codexAssistantSettings(context = {}, input = {}) {
  const requested = input.agentSettings && typeof input.agentSettings === "object"
    ? input.agentSettings
    : context.agentSettings && typeof context.agentSettings === "object"
      ? context.agentSettings
      : {};
  const selection = context.assistantSelection;
  return selection?.engineId === VIBE64_ASSISTANT_ENGINE_IDS.CODEX
    ? {
        ...requested,
        model: selection.modelId,
        modelProviderId: selection.modelProviderId,
        providerId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
        thinking: selection.variantId
      }
    : requested;
}

function codexAssistantCapabilities(connected = true, catalog = codexConfiguredModelCatalog(false), connections = []) {
  // The native process knows all routable models. Account choices still belong
  // to their own credential routes; knowing metadata does not grant access.
  const rows = codexCatalogRows(catalog).filter((model) => model.hidden !== true && !curatedCodexModel(model.model));
  const models = codexCatalogModels(rows);
  const defaultModel = rows.find((model) => model.model === VIBE64_CODEX_DEFAULT_MODEL) ||
    rows.find((model) => model.isDefault === true) || rows[0];
  const defaultThinking = codexCatalogReasoningEfforts(defaultModel).has(VIBE64_CODEX_DEFAULT_THINKING)
    ? VIBE64_CODEX_DEFAULT_THINKING
    : toText(defaultModel?.defaultReasoningEffort);
  const curated = CURATED_CODEX_PROVIDERS.map((provider) => {
    const connection = connections.find(({ id }) => id === provider.id);
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      connected: connection?.connected === true,
      apiKeyCompatible: true,
      defaultModelId: provider.models[0].id,
      models: provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        status: "available",
        capabilities: { images: model.images === true, defaultVariantId: model.defaultThinking },
        variants: model.variants.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))
      }))
    };
  });
  const defaultCuratedProvider = curated.find((provider) => provider.connected);
  const available = connected || Boolean(defaultCuratedProvider);
  const revision = `sha256:${createHash("sha256").update(JSON.stringify({
    connected,
    models,
    curated
  })).digest("hex")}`;
  return {
    agents: [{
      description: "OpenAI Codex coding agent",
      id: "codex",
      label: "Codex",
      mode: "primary"
    }],
    authentication: {
      management: "account-owner",
      modes: ["oauth", "api-key"]
    },
    defaults: {
      agentId: "codex",
      modelId: connected ? toText(defaultModel?.model) : defaultCuratedProvider?.defaultModelId || "",
      modelProviderId: connected ? "openai" : defaultCuratedProvider?.id || "openai",
      variantId: connected ? defaultThinking : ""
    },
    engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
    health: {
      message: available ? "" : "Connect a Codex provider in AI Accounts.",
      status: available ? "ready" : "unavailable"
    },
    label: "Codex",
    modelProviders: [{
      connected,
      description: "Codex models provided by OpenAI",
      id: "openai",
      // The owner's Codex sign-in, named as AI Accounts and a refused selection name it.
      label: findVibe64AgentProvider(VIBE64_ASSISTANT_ENGINE_IDS.CODEX).accountLabel,
      models
    }, ...curated],
    revision,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.CODEX_APP_SERVER
  };
}

function codexExecutionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function codexCatalogRows(value = null) {
  return nativeCodexCatalogRows(value, message => codexExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
    message
  ));
}

function resolveCodexHelperExecutionProfile(request = {}, catalog = null, modelId = "", thinking = "") {
  const { executionProfile, limits } = vibe64HelperExecutionProfileRequest(request, "Codex");
  const model = codexCatalogRows(catalog).find((row) => row?.hidden !== true && toText(row?.model) === modelId);
  if (!model) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "The selected Codex helper model is unavailable. Choose another in Models.",
      { model: modelId }
    );
  }
  if (thinking && !codexCatalogReasoningEfforts(model).has(thinking)) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.REASONING_UNSUPPORTED,
      `The selected Codex helper model does not support ${thinking} thinking.`,
      { model: modelId, thinking }
    );
  }
  return defineVibe64HelperExecutionProfileResolution({
    executionProfile,
    limits,
    model: modelId,
    providerId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
    revision: CODEX_HELPER_PROFILE_REVISION,
    thinking
  });
}

function normalizeCodexTurn(result) {
  const turn = result?.codexAgentTurn || {};
  const id = toText(turn?.turnId || result?.turnId);
  const active = Boolean(id) && (turn?.active === true || result?.active === true);
  if (!id && !active) {
    return null;
  }
  return {
    active,
    error: toText(turn?.error),
    id,
    phase: active ? toText(turn?.phase) : "",
    runState: toText(turn?.runState),
    startedAt: toText(turn?.startedAt),
    state: toText(turn?.state),
    status: toText(turn?.status || turn?.state),
    threadId: toText(turn?.threadId || result?.codexThreadId || result?.threadId),
    updatedAt: toText(turn?.updatedAt)
  };
}

function normalizeCodexSessionResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const turn = normalizeCodexTurn(source);
  return {
    ...(toText(source.code) ? { code: toText(source.code) } : {}),
    ...(toText(source.error) ? { error: toText(source.error) } : {}),
    ...(toText(source.deliveryMode) ? { deliveryMode: toText(source.deliveryMode) } : {}),
    delivered: source.delivered === true,
    ...(toText(source.operationOutcome) ? { operationOutcome: toText(source.operationOutcome) } : {}),
    ...(toText(source.reason) ? { reason: toText(source.reason) } : {}),
    connectionReused: typeof source.connectionReused === "boolean" ? source.connectionReused : null,
    identity: source.agentIdentity || null,
    ...(typeof source.interrupted === "boolean" ? { interrupted: source.interrupted } : {}),
    newTurnRequired: source.newTurnRequired === true,
    ok: source.ok !== false,
    refreshRecommended: source.refreshRecommended === true,
    retryable: typeof source.retryable === "boolean" ? source.retryable : null,
    sessionUpdated: source.sessionUpdated === true,
    terminal: source.codexTerminal || null,
    thread: {
      id: toText(source.codexThreadId || source.threadId || turn?.threadId)
    },
    turn,
    workdir: toText(source.codexWorkdir)
  };
}

/**
 * @param {object} dependencies
 * @param {(context: object) => Promise<boolean>} [dependencies.connectionStatus]
 * @param {(request: object) => Promise<unknown>} dependencies.runNativeDetachedConversation
 * @param {ListAssistantConnections} dependencies.listConnections
 * @param {CodexAppServerRunOwner} dependencies.runOwner
 * @param {CodexAppServerProviderOwner} dependencies.providerOwner
 * @param {CodexConversationPreparation} dependencies.conversationPreparation
 * @param {CodexLifecyclePreparation} dependencies.lifecyclePreparation
 * @param {CodexSessionRenewalPreparation} [dependencies.renewalPreparation]
 * @param {CodexConversationStorage} dependencies.storage
 * @param {CodexAssistantCatalog} dependencies.catalog
 * @param {CodexInteractiveTerminals} dependencies.terminals
 * @param {CodexSessionAttachmentRenewal} dependencies.attachments
 * @param {RuntimeEnv} [dependencies.env]
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {CodexSessionTurnCheckpoint} dependencies.checkpoint
 */
function createCodexSessionAgentProvider({
  connectionStatus = async () => true,
  runNativeDetachedConversation,
  listConnections,
  runOwner: codexAppServerRunOwner,
  providerOwner: codexAppServerProviderOwner,
  conversationPreparation: codexConversationPreparation,
  lifecyclePreparation: codexLifecyclePreparation,
  renewalPreparation = {},
  storage: codexConversationStorage,
  catalog: codexAssistantCatalog,
  terminals,
  attachments,
  env = process.env,
  publishSessionChanged,
  checkpoint: checkpointCodexAppServerTurn
}) {
  if (!codexAssistantCatalog) {
    throw new TypeError("Codex session agent provider requires its catalogue facility.");
  }
  const { prepareCodexRenewalHandover, prepareCodexRenewalSeed, prepareRenewalProcessExitProof } = renewalPreparation;
  const {
    prepareNativeStorageProvider,
    prepareCodexAppServerThreadUnsubscription,
    codexAppServerReconciliationPreparation,
    prepareCodexSessionCleanup,
    prepareCodexProjectCleanup
  } = codexLifecyclePreparation;
  const nativeSessionResult = result => Object.hasOwn(result, "session")
    ? withCodexState(result.value, result.session) : result.value;

  /**
   * A streamed turn always carries its onEvent option; a plain run carries it only when the caller subscribed.
   */
  async function runDetachedTurn(context, input, eventOptions) {
    const executionProfile = emitVibe64AgentExecutionProfile(context, input.executionProfile);
    const result = await runNativeDetachedConversation({
      id: context.sessionId,
      context,
      input: { ...input, vibe64User: input.vibe64User || context.vibe64User || null },
      options: { ...eventOptions, runtime: context.runtime, session: context.session }
    });
    return executionProfile ? { ...result, executionProfile } : result;
  }

  function prepareConversationHost(sessionId, context = {}, mode = "main") {
    if (mode === "activity" || mode === "settings") return { native: { runOwner: codexAppServerRunOwner } };
    if (mode === "renewalProof") {
      return {
        native: {
          providerOwner: codexAppServerProviderOwner,
          preparation: {
            predecessor(options) {
              return prepareRenewalProcessExitProof(renewalArchivedPredecessorContext(sessionId, options).session);
            },
            successor(options) {
              return prepareRenewalProcessExitProof(renewalSuccessorProcessExitProofReleaseContext(sessionId, options).session);
            }
          }
        }
      };
    }
    if (mode === "renewal") {
      return {
        native: {
          runOwner: codexAppServerRunOwner,
          preparation: {
            handover: (input, current) => prepareCodexRenewalHandover(sessionId, input, current),
            seed: (input, current) => prepareCodexRenewalSeed(sessionId, input, current)
          }
        }
      };
    }
    if (mode === "reconciliation") {
      return {
        native: { runOwner: codexAppServerRunOwner, preparation: codexAppServerReconciliationPreparation() }
      };
    }
    if (mode === "unsubscription") {
      return {
        native: {
          runOwner: codexAppServerRunOwner,
          preparation: {
            enabled: true, // JSKIT's native lifecycle still reads this; Codex control is always on.
            session: prepareCodexAppServerThreadUnsubscription,
            failureMessage: "Vibe64 Codex app-server thread unsubscribe failed.",
            cleanupFailureMessage: "Vibe64 Codex app-server provider cleanup failed."
          }
        }
      };
    }
    if (mode === "invalidation") {
      return {
        native: {
          runOwner: codexAppServerRunOwner,
          preparation: {
            enabled: true // JSKIT's native lifecycle still reads this; Codex control is always on.
          }
        }
      };
    }
    if (mode === "detached" || mode === "detachedCleanup") return { native: { runOwner: codexAppServerRunOwner } };
    if (mode === "storage") {
      return {
        native: {
          providerOwner: codexAppServerProviderOwner,
          errorPrefix: "vibe64_",
          preparation: { storage: prepareNativeStorageProvider }
        }
      };
    }
    if (mode === "projectCleanup") {
      return {
        native: { runOwner: codexAppServerRunOwner, preparation: { projectCleanup: prepareCodexProjectCleanup } }
      };
    }
    return (async () => {
      if (mode === "readiness") {
        return {
          native: { runOwner: codexAppServerRunOwner, preparation: { readiness: () => codexConversationPreparation.readiness(sessionId) } }
        };
      }
      if (mode === "scoped" || mode === "create" || mode === "dispose") {
        return {
          ...(mode === "dispose" ? {
            cleanupOptions: {
              ...(context.assistantScope ? { assistantScope: context.assistantScope } : {}),
              changeover: context.changeover === true,
              preserveProcessExitProof: context.preserveProcessExitProof === true,
              renewalCleanup: context.renewalCleanup,
              runtime: context.runtime,
              session: context.session
            }
          } : {}),
          namespace: codexTerminalNamespace(sessionId),
          native: {
            runOwner: codexAppServerRunOwner,
            providerOwner: codexAppServerProviderOwner,
            namespace: codexTerminalNamespace(sessionId),
            preparation: { cleanup: options => prepareCodexSessionCleanup(sessionId, options) }
          }
        };
      }
      const { runtime } = context;
      const session = context.session || await codexConversationStorage.readSession(sessionId);
      const messagePreparation = codexConversationPreparation.message(sessionId);
      return {
        context: { runtime, session },
        namespace: codexTerminalNamespace(sessionId),
        messageEnvironment: env,
        publish: publishSessionChanged,
        checkpoint: checkpointCodexAppServerTurn,
        state: codexConversationStorage.state(sessionId),
        async readContextUsage({ input, signal }) {
          signal?.throwIfAborted();
          const ready = await codexConversationPreparation.threadReadiness(sessionId, codexAppServerRunOwner.ensureThreadReady, {
            agentSettings: input.agentSettings,
            recordBriefing: false
          });
          if (ready.ok === false) throw new Error(ready.error || "Codex context could not be prepared.");
          signal?.throwIfAborted();
          const current = await codexAppServerRunOwner.conversationContext(sessionId, input, {});
          if (current.ok === false) throw new Error(current.error || "Codex context is unavailable.");
          const target = codexConversationPreparation.goalContext(sessionId, current);
          const model = input.agentSettings?.model || target.resumeOptions.model;
          const limit = await readCodexModelContextWindow({ runtimeDir: (await current.provider.currentRuntimeInfo()).runtimeDir, model });
          const usage = sessionContextUsageFromMetadata(current.session.metadata, { expectedThreadId: target.threadId });
          if (usage?.providerId === "codex") {
            return {
              model,
              usedTokens: usage.usedTokens,
              windowTokens: Math.min(limit.effectiveWindowTokens, usage.windowTokens)
            };
          }
          // Missing usage is zero only for a natively verified empty thread.
          // An existing thread without its receipt must never get a full budget.
          const turns = await current.provider.listThreadTurns(
            target.threadId,
            { limit: 1, sortDirection: "desc", itemsView: "summary" }
          );
          signal?.throwIfAborted();
          if (!Array.isArray(turns.data) || turns.data.length || turns.nextCursor) {
            throw new Error("Codex's current context usage is unavailable. Restore its usage before transferring more history.");
          }
          return { model, usedTokens: 0, windowTokens: limit.effectiveWindowTokens };
        },
        native: {
          runOwner: codexAppServerRunOwner,
          providerOwner: codexAppServerProviderOwner,
          admission: () => beginTerminalNamespaceOperation(codexTerminalNamespace(sessionId)),
          messagePreparation,
          controlPreparation: (options, input) => codexConversationPreparation.control(sessionId, options, input),
          readGoalContext: options => codexConversationPreparation.readGoal(sessionId, options),
          goalPreparation: {
            readiness: operation => codexConversationPreparation.threadReadiness(sessionId, operation, {}),
            project: (goalRequest, options) => codexConversationPreparation.goalContext(sessionId, goalRequest, options)
          },
          inspectionPreparation: (input, options) => codexConversationPreparation.inspection(sessionId, input, options),
          namespace: codexTerminalNamespace(sessionId),
          preparation: { cleanup: options => prepareCodexSessionCleanup(sessionId, { ...options, runtime }) }
        }
      };
    })();
  }

  function prepareConversationRequest(method, context, input = {}) {
    if (method === "releaseRenewalPredecessorProcessExitProof") {
      return {
        context: {
          renewalId: input.renewalId,
          runtime: context.runtime,
          session: context.session
        }
      };
    }
    if (method === "releaseRenewalSuccessorProcessExitProof") {
      return {
        context: {
          authorization: input.authorization,
          renewalId: input.renewalId,
          runtime: context.runtime,
          session: context.session
        }
      };
    }
    if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") {
      return {
        input: {
          ...input,
          agentSettings: codexAssistantSettings(context, input),
          vibe64User: input.vibe64User || context.vibe64User || null
        },
        context: { runtime: context.runtime, session: context.session }
      };
    }
    if (method === "interruptDetachedChatTurn" || method === "deleteDetachedChatThread") {
      return {
        input,
        context: { runtime: context.runtime, session: context.session }
      };
    }
    if (method === "ensureSession") return { context: {} };
    if (method === "createConversation") {
      return {
        input: { ...input, agentSettings: codexAssistantSettings(context, input) },
        context: { assistantScope: context.assistantScope, runtime: context.runtime, session: context.session }
      };
    }
    if (method === "closeSession") {
      return {
        namespace: codexTerminalNamespace(context.sessionId),
        sessionId: context.sessionId,
        context,
        options: {
          changeover: context.changeover === true,
          forgetConversationBinding: context.forgetConversationBinding === true,
          preserveProcessExitProof: context.preserveProcessExitProof === true,
          renewalCleanup: context.renewalCleanup,
          session: context.session
        }
      };
    }
    if (["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"].includes(
      method
    )) {
      const message = method === "startConversationTurn" ? {
        ...input,
        agentSettings: codexAssistantSettings(context, input),
        vibe64User: input.vibe64User || context.vibe64User || null
      } : null;
      return {
        scopedConversationId: toText(input.conversationId) ? input.conversationId : undefined,
        get input() {
          return message || { ...input, agentSettings: codexAssistantSettings(context, input) };
        }
      };
    }
    if (method === "sessionState" || method === "readGoal") return {};
    if (method !== "sendMessage") return { input };
    const message = input && typeof input === "object" && !Array.isArray(input)
      ? {
          ...input,
          agentSettings: codexAssistantSettings(context, input),
          vibe64User: input.vibe64User || context.vibe64User || null
        }
      : {
          agentSettings: codexAssistantSettings(context),
          message: input,
          vibe64User: context.vibe64User || null
        };
    return {
      input: message,
      async prepareInput(changes) {
        const prepared = { ...message, ...changes };
        return context.prepareMessage ? context.prepareMessage(prepared) : prepared;
      }
    };
  }

  async function projectConversationResult(method, perform) {
    if (method === "hasActiveTemporaryConversation") return { active: await perform(), ok: true };
    if (method === "invalidateRuntimes") {
      const operation = perform();
      return vibe64Result(() => operation);
    }
    if (method === "readGoal" || method === "updateGoal") return perform();
    if (["inspectMessageAdmission", "closeProject", "reconcileSessions", "unsubscribeSessions",
      "generateSessionRenewalHandover", "seedSessionRenewalHandover"].includes(method)) return vibe64Result(perform);
    return normalizeCodexSessionResult(await vibe64Result(async () => {
      const result = await perform();
      return method === "sendMessage" || method === "interruptTurn" ? nativeSessionResult(result) : result;
    }));
  }

  function runDetachedChatTurn(context, input = {}) {
    return runDetachedTurn(context, input, context.onEvent ? { onEvent: context.onEvent } : {});
  }

  function streamDetachedChatTurn(context, input = {}) {
    return runDetachedTurn(context, input, { onEvent: context.onEvent });
  }

  async function capabilities(context = {}, input = {}) {
    const connected = (await connectionStatus(context)) !== false;
    const configuredOnly = toText(input.configuredOnly).toLowerCase() === "true";
    // A provider filter must not change the catalogue revision used by Apply.
    const catalog = connected && !configuredOnly
      ? await codexAssistantCatalog.modelCatalog({ signal: context.signal })
      : codexConfiguredModelCatalog(connected, VIBE64_CODEX_DEFAULT_MODEL, VIBE64_CODEX_DEFAULT_THINKING);
    return codexAssistantCapabilities(connected, catalog, await listConnections());
  }

  async function releaseRenewalPredecessorAttachments(context, input = {}) {
    return codexLifecyclePreparation.releaseRenewalPredecessorAttachments(context.sessionId, {
      renewalId: input.renewalId,
      runtime: context.runtime,
      session: context.session
    });
  }

  async function closeTerminal(context, input = {}) {
    return terminals.closeTerminal(context.sessionId, input.terminalSessionId);
  }

  async function describeProvider(context) {
    return codexAssistantCatalog.describeProvider(context.sessionId, {
      runtime: context.runtime,
      session: context.session
    });
  }

  function readPlanUsage(context) {
    return codexAssistantCatalog.readPlanUsage(context.sessionId, { runtime: context.runtime, session: context.session });
  }

  async function resolveExecutionProfile(context, input = {}) {
    const {
      executionProfile,
      limits
    } = vibe64HelperExecutionProfileRequest(input, "Codex");
    const helperModelId = context.assistantSelection?.modelId;
    return resolveCodexHelperExecutionProfile(
      executionProfile,
      await codexAssistantCatalog.executionProfileModelCatalog(context.sessionId, {
        ...(context.assistantScope ? {
          assistantScope: context.assistantScope,
          agentSettings: codexAssistantSettings(context)
        } : {}),
        runtime: context.runtime,
        session: context.session,
        signal: context.signal,
        timeoutMs: limits.timeoutMs
      }),
      helperModelId,
      context.assistantSelection?.variantId || ""
    );
  }

  async function readTerminal(context, input = {}) {
    return terminals.readTerminal(context.sessionId, input.terminalSessionId);
  }

  async function resizeTerminal(context, input = {}) {
    return terminals.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
  }

  async function startTerminal(context, input = {}) {
    return vibe64Result(async () => {
      return terminals.startTerminal(context.sessionId, input);
    });
  }

  async function subscribeTerminal(context, input = {}) {
    return terminals.subscribeTerminal(context.sessionId, input.terminalSessionId, input.subscriber);
  }

  async function writeTerminal(context, input = {}) {
    const terminalInput = {
      ...input.input,
      vibe64User: input.input?.vibe64User || context.vibe64User || null
    };
    const attachmentLimit = codexAttachmentLimitResult(terminalInput);
    if (attachmentLimit) {
      return attachmentLimit;
    }
    const attachmentValidation = await validateCodexAttachmentsBeforeDelivery(
      attachments,
      context.sessionId,
      terminalInput
    );
    if (attachmentValidation) {
      return attachmentValidation;
    }
    const result = await terminals.writeTerminal(
      context.sessionId,
      input.terminalSessionId,
      input.data,
      terminalInput
    );
    await renewAcceptedCodexAttachments(
      attachments,
      context.sessionId,
      terminalInput,
      result?.ok === true
    );
    return result;
  }

  return Object.freeze({
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER
    ]),
    id: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.CODEX_APP_SERVER,
    prepareSelection: prepareCodexModelRouting,
    prepareConversationHost,
    conversationOperations: Object.freeze([
      "createConversation",
      "ensureSession",
      "updateSessionSettings",
      "sendMessage",
      "sessionState",
      "inspectMessageAdmission",
      "interruptTurn",
      "readGoal",
      "updateGoal",
      "readConversation",
      "startConversationTurn",
      "waitForConversationTurn",
      "stopConversation",
      "deleteConversation",
      "closeSession",
      "closeProject",
      "invalidateRuntimes",
      "reconcileSessions",
      "unsubscribeSessions",
      "generateSessionRenewalHandover",
      "seedSessionRenewalHandover",
      "releaseRenewalPredecessorProcessExitProof",
      "releaseRenewalSuccessorProcessExitProof",
      "interruptDetachedChatTurn",
      "deleteDetachedChatThread",
      "listNativeConversationStorage",
      "retireConversationHistory",
      "hasActiveTemporaryConversation"
    ]),
    prepareConversationRequest,
    projectConversationResult,
    runDetachedChatTurn,
    streamDetachedChatTurn,
    capabilities,
    releaseRenewalPredecessorAttachments,
    closeTerminal,
    describeProvider,
    readPlanUsage,
    resolveExecutionProfile,
    readTerminal,
    resizeTerminal,
    startTerminal,
    subscribeTerminal,
    writeTerminal
  });
}

const __testables = Object.freeze({ CODEX_HELPER_PROFILE_REVISION, resolveCodexHelperExecutionProfile });

export {
  createCodexSessionAgentProvider,
  __testables
};
