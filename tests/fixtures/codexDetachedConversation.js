import { createSessionConversationBinding } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import { codexAppServerReadOnlyThreadSettings } from "@jskit-ai/assistant-core/server/codex-configuration";
import { beginTerminalNamespaceOperation } from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import { codexTerminalNamespace, vibe64Result } from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import { assertCodexAppServerHelperOutputWithinLimit, codexAppServerHelperIsolation,
  codexAppServerThreadSettings, codexAppServerTurnSettings,
  codexAppServerHelperThreadResumePreparation, codexAppServerHelperThreadStartPreparation,
  prepareCodexAppServerHelperTurn } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import { effectiveVibe64AgentExecutionSettings } from "../../packages/vibe64-runtime/src/shared/index.js";

// Historical native-behavior fixture. The obsolete application entrypoint is
// retained here only to exercise its original Helper assertions against the
// actual shared native owners. Current application dispatch is tested elsewhere.
const CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS = 180_000;
function normalizeText(value) {
  return String(value || "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function errorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

function codexAppServerPromptDeliveryEnabledByDefault({
  env = process.env
} = {}) {
  const configured = normalizeText(env.VIBE64_CODEX_APP_SERVER_PROMPTS).toLowerCase();
  if (["0", "false", "no", "off"].includes(configured)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(configured)) {
    return true;
  }
  return true;
}

function codexDetachedChatTurnError(error, {
  agentSettings = {},
  executionProfile = null,
  status = ""
} = {}) {
  const profile = isRecord(executionProfile) ? executionProfile : null;
  const settings = profile || effectiveVibe64AgentExecutionSettings(agentSettings);
  const terminalStatus = ["failed", "interrupted"].includes(normalizeText(status))
    ? normalizeText(status)
    : "";
  const requestDetails = [
    settings.model ? `model ${settings.model}` : "",
    settings.request?.reasoning !== false && settings.thinking
      ? `reasoning effort ${settings.thinking}`
      : "",
    terminalStatus ? `turn status ${terminalStatus}` : ""
  ].filter(Boolean);
  const message = errorMessage(error, "Codex app-server turn failed.");
  const contextualMessage = requestDetails.length && !message.includes("Request details:")
    ? `${message}\n\nRequest details: ${requestDetails.join("; ")}.`
    : message;
  const contextualError = new Error(contextualMessage);
  contextualError.code = error?.code;
  contextualError.statusCode = error?.statusCode;
  return contextualError;
}
const CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED = codexAppServerPromptDeliveryEnabledByDefault();

export function createCodexDetachedConversationView({ provider: hostProvider, options, nativeTestContext }) {
  const { agentDatabaseCommand = null, agentEnvCommand = null, agentPreviewCommand = null,
    codexGitCommand = null,
    codexAppServerPromptDeliveryEnabled = CODEX_APP_SERVER_PROMPT_DELIVERY_ENABLED } = options;
  function vibe64SessionContextInput(conversationKind = "main") {
    return {
      scope: "session",
      conversationKind,
      session: {
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedGit: Boolean(codexGitCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  function codexAppServerControlDisabledResult() {
    return {
      ok: false,
      error: "Codex app-server control is disabled. Session Codex control has no terminal fallback."
    };
  }

  function codexAppServerConversationThreadPreparation(context = {}) {
    if (context.assistantScope) {
      return { settings: () => codexAppServerReadOnlyThreadSettings(
        codexAppServerThreadSettings({
          agentSettings: context.agentSettings,
          config: context.isolationConfig,
          cwd: context.workdir,
          systemPrompt: context.assistantScope.stableContext
        })
      ) };
    }
    return {
      workdir: context.workdir,
      projectHooks: true,
      settings: config => codexAppServerThreadSettings({
        agentSettings: context.agentSettings,
        config,
        cwd: context.workdir,
        hostContext: vibe64SessionContextInput("temporary")
      })
    };
  }

  async function runDetachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input, options);
  }

  async function streamDetachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    return detachedCodexAppServerChatTurn(sessionId, input, options);
  }

  async function detachedCodexAppServerChatTurn(sessionId, input = {}, options = {}) {
    const admission = beginTerminalNamespaceOperation(codexTerminalNamespace(sessionId));
    if (admission.ok === false) {
      return admission;
    }
    try {
      return await admittedDetachedCodexAppServerChatTurn(sessionId, input, options);
    } finally {
      admission.release();
    }
  }

  async function admittedDetachedCodexAppServerChatTurn(sessionId, input = {}, {
    onEvent = null,
    runtime: resolvedRuntime = null,
    session: resolvedSession = null
  } = {}) {
    const emitDetachedEvent = (event = {}) => {
      if (typeof onEvent === "function") {
        onEvent(event);
      }
    };
    return vibe64Result(async () => {
      if (!codexAppServerPromptDeliveryEnabled) {
        return codexAppServerControlDisabledResult();
      }
      const prompt = normalizeText(input.prompt || input.message);
      if (!prompt) {
        return {
          code: "vibe64_codex_detached_prompt_empty",
          error: "Codex prompt is empty.",
          ok: false
        };
      }
      // The fixture supplies these genuine objects; obtaining the existing owner
      // adds no session read and the owner's context acquisition still runs below.
      if (!nativeTestContext?.runtime || nativeTestContext.session?.sessionId !== sessionId) {
        throw new TypeError("Detached native tests require their genuine runtime and session.");
      }
      const { native: { runOwner: codexAppServerRunOwner } } = await createSessionConversationBinding(
        hostProvider, sessionId, nativeTestContext
      );
      const { assertAccountIdentity: assertCodexAppServerHelperAccountIdentity,
        helperThreads: { threadForOperation: knownCodexAppServerHelperThread } } = codexAppServerRunOwner;
      const context = await codexAppServerRunOwner.conversationContext(sessionId, input, {
        runtime: resolvedRuntime,
        session: resolvedSession
      });
      if (context.ok === false) {
        return context;
      }
      const {
        agentSettings,
        provider,
        runtime,
        workdir
      } = context;
      const projectRuntimeRoot = normalizeText(runtime?.stateRoot);
      const executionProfile = isRecord(input.executionProfile) ? input.executionProfile : null;
      const helperTurn = Boolean(executionProfile);
      const onRetired = ({ threadId }) => emitDetachedEvent({ threadId, type: "thread-retired" });
      if (helperTurn) {
        await assertCodexAppServerHelperAccountIdentity(
          provider,
          input.expectedAccountIdentitySignature
        );
      }
      const threadSettings = helperTurn
        ? null
        : await codexAppServerRunOwner.prepareConversationThread(context.provider, codexAppServerConversationThreadPreparation(context));
      const requestedThreadId = normalizeText(input.threadId || input.codexSessionId);
      let thread = null;
      let helper = null;
      if (helperTurn) {
        const record = requestedThreadId ? knownCodexAppServerHelperThread({
          executionProfile, projectRuntimeRoot, provider, sessionId,
          threadId: requestedThreadId, workdir
        }) : null;
        helper = await codexAppServerRunOwner.helperThreads.prepareDetached({
          record, executionProfile, onRetired, projectRuntimeRoot, provider,
          sessionId, requestedThreadId, workdir,
          get projectContextRoot() { return context.runtime?.projectContextRoot; }
        }, {
          isolation: codexAppServerHelperIsolation,
          start: () => codexAppServerHelperThreadStartPreparation({ executionProfile }),
          resume: () => codexAppServerHelperThreadResumePreparation({ executionProfile }),
          turn: threadId => prepareCodexAppServerHelperTurn({
            executionProfile, outputSchema: input.outputSchema, prompt, provider, threadId
          })
        });
        thread = helper.thread;
      } else {
        thread = await codexAppServerRunOwner.acquireDetachedThread(
          provider, requestedThreadId, threadSettings, input
        );
      }
      const threadId = codexAppServerRunOwner.detachedThreadId(thread, requestedThreadId);
      const discardHelperThread = async () => {
        if (!helper) {
          return;
        }
        await helper.discard();
      };
      emitDetachedEvent({
        threadId,
        type: "thread"
      });
      const requestedTimeoutMs = Number(input.timeoutMs || 0);
      const profileTimeoutMs = Number(executionProfile?.limits?.timeoutMs || 0);
      let delivery = null;
      let turnId = "";
      let status = "";
      const result = await codexAppServerRunOwner.runDetachedTurn({
        provider,
        threadId,
        timeoutMs: helperTurn
          ? Math.min(
              requestedTimeoutMs > 0 ? requestedTimeoutMs : profileTimeoutMs,
              profileTimeoutMs
            )
          : requestedTimeoutMs > 0
            ? requestedTimeoutMs
            : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS,
        onEvent: emitDetachedEvent,
        onFailure: async (error, status) => {
          await discardHelperThread();
          return codexDetachedChatTurnError(error, {
            agentSettings,
            executionProfile,
            status
          });
        }
      }, async (failDispatch) => {
        if (helperTurn) {
          ({ delivery, status, turnId } = await helper.dispatch(threadId, failDispatch));
        } else {
          try {
            ({ delivery, status, turnId } = await codexAppServerRunOwner.dispatchDetachedTurn({
              prompt, provider, threadId
            }, {
              get turnSettings() { return codexAppServerTurnSettings({ agentSettings, cwd: workdir }); }
            }));
          } catch (error) {
            await failDispatch(error);
          }
        }
        return { delivery, status, turnId };
      });
      if (helperTurn) {
        try {
          await assertCodexAppServerHelperAccountIdentity(
            provider,
            input.expectedAccountIdentitySignature
          );
        } catch (error) {
          await discardHelperThread();
          throw error;
        }
      }
      try {
        if (helperTurn) {
          assertCodexAppServerHelperOutputWithinLimit({
            executionProfile,
            rawOutput: result.text
          });
        }
      } catch (error) {
        await discardHelperThread();
        throw error;
      }
      if (helperTurn) {
        await helper.complete();
      }
      emitDetachedEvent({
        status: result.status || "completed",
        text: result.text,
        threadId,
        turnId: result.turnId || turnId,
        type: "completed"
      });
      return {
        ok: true,
        text: result.text,
        threadId,
        turnId: result.turnId || turnId,
        ...(helperTurn
          ? {
              inputCharacters: prompt.length,
              outputCharacters: result.text.length,
              usage: result.usage || null
            }
          : {})
      };
    });
  }

  return {
    runDetachedChatTurn(sessionId, input = {}, options = {}) {
      return runDetachedCodexAppServerChatTurn(sessionId, input, options);
    },
    streamDetachedChatTurn(sessionId, input = {}, options = {}) {
      return streamDetachedCodexAppServerChatTurn(sessionId, input, options);
    }
  };
}
