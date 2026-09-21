import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { VIBE64_AGENT_RUN_STATE as RUN } from "@local/vibe64-runtime/server";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS, defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot, vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import { composeVibe64SessionContext } from "@local/vibe64-genesis/server";
import { appCredentialContext, runVibe64Command, stopVibe64Execution } from "@local/vibe64-execution/server";
import {
  closeTerminalSession, closeTerminalSessionsForNamespace, listTerminalSessions, readTerminalSession,
  resizeTerminalSession, subscribeTerminalSession, writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { createNativeHelperModelStore, CLAUDE_RECOMMENDED_HELPER_MODEL } from "@local/vibe64-core/server/nativeHelperModel";
import { resolveVibe64SystemRoot } from "@local/vibe64-core/server/studioRoots";
import { STUDIO_MANAGED_CLAUDE_COMMAND } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { CLAUDE_CODE_VERSION, claudeCodeArguments, createClaudeCodeProcess } from "../../claudeCodeProcess.js";
import { claudeHistoryPath, claudeMessageBlocks, readClaudeHistory, requireClaudeSessionId } from "../../claudeConversationHistory.js";
import { prepareAgentSessionCommandEnvironment } from "../../agentCommandEnvironment.js";
import { recordSessionGitCommandActor } from "../../sessionGitCommandActor.js";
import { conversationActorMetadata } from "../../conversationActor.js";
import {
  defineSessionRenewalOperationId, defineSessionRenewalApprovedHandover,
  sessionRenewalClientMessageId, sessionRenewalHandoverPrompt, sessionRenewalSeedPrompt,
  sessionRenewalAcknowledgementOutputSchema, parseSessionRenewalHandoverOutput,
  parseSessionRenewalAcknowledgement
} from "../../sessionRenewalHandover.js";
import { claudeTerminalNamespace, terminalSessionSourceRoot } from "../../terminalShared.js";

const ENGINE = "claude";
const TRANSPORT = "claude_stream_json";
const text = (value) => String(value ?? "").trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
function error(message, code = "vibe64_claude_operation_failed") {
  return Object.assign(new Error(message), { code, statusCode: 409 });
}
function nativeMessageId(id) {
  const value = hash(String(id));
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function claudePlanUsage(value) {
  const windows = Object.entries(value.rate_limits || {}).flatMap(([id, window]) => {
    if (!window || !Number.isFinite(window.utilization) || !/^(five_hour|seven_day(?:_.*)?)$/u.test(id)) return [];
    const reset = window.resets_at ? Date.parse(window.resets_at) / 1000 : null;
    if (reset !== null && (!Number.isFinite(reset) || reset * 1000 <= Date.now())) return [];
    return [{ id, remainingPercent: Math.max(0, Math.min(100, 100 - window.utilization)),
      windowDurationMins: id === "five_hour" ? 300 : 10080, resetsAt: reset }];
  });
  return { status: !value.rate_limits_available ? "unsupported" : windows.length ? "available" : "unavailable",
    windows, checkedAt: Date.now() };
}
function claudeCapabilities(initialization, connected) {
  const models = (initialization.models || []).map((model) => ({
    id: model.value, label: model.displayName || model.value, description: model.description || "",
    status: "available", variants: (model.supportedEffortLevels || []).map((id) => ({
      id, label: id[0].toUpperCase() + id.slice(1)
    }))
  }));
  const selected = models.find((model) => model.id === "default") || models[0];
  return {
    engineId: ENGINE, transportId: TRANSPORT, label: "Claude Code",
    agents: [{ id: ENGINE, label: "Claude Code", mode: "primary", description: "Anthropic's native coding agent" }],
    authentication: { management: "account-owner", modes: ["oauth"] },
    defaults: { agentId: ENGINE, modelId: selected?.id || "", modelProviderId: "anthropic",
      variantId: selected?.variants.some((variant) => variant.id === "high") ? "high" : "" },
    health: { status: connected ? "ready" : "unavailable", message: connected ? "" : "Connect Claude Code to use your Claude plan." },
    modelProviders: [{ id: "anthropic", label: "Anthropic", connected, models }],
    revision: `sha256:${hash(JSON.stringify({ models, connected }))}`
  };
}

function createClaudeSessionAgentProvider({
  env = process.env, projectService, publishSessionChanged = async () => {},
  command = env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND,
  credentialHome = appCredentialContext(), createProcess = createClaudeCodeProcess,
  commandRunner = runVibe64Command, stopExecution = stopVibe64Execution,
  connectionStatus = async () => false,
  systemRoot = resolveVibe64SystemRoot({ env }),
  accountStatus = () => readClaudeCodeAuthStatus({ env, credentialHome, commandRunner }),
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  composeSessionContext = composeVibe64SessionContext,
  recordGitActor = recordSessionGitCommandActor,
  codexGitCommand, agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand
} = {}) {
  const entries = new Map();
  const starts = new Map();
  const accountProcessStops = new Set();
  let catalog;
  let catalogStart;
  let planUsage;
  let planUsagePending;
  let closing = false;
  const closingSessions = new Set();
  const configRoot = env.CLAUDE_CONFIG_DIR || path.join(credentialHome.home, ".claude");

  async function contextFor(context) {
    const sessionId = text(context.sessionId);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) throw new TypeError("Claude requires a valid session id.");
    const scope = context.assistantScope;
    if (scope && scope.id !== sessionId) throw error("Claude conversation scope does not match.");
    const runtime = context.runtime || (scope ? { stateRoot: scope.runtimeRoot } : await projectService.createRuntime({ inspectSource: false }));
    const session = scope ? null : context.session || await runtime.getSession(sessionId, { inspectSource: false });
    if (!scope && !session) throw error("This session is unavailable.");
    const selection = context.assistantSelection || vibe64AssistantSelectionFromMetadata(session?.metadata);
    if (selection?.engineId !== ENGINE) throw error("This session does not have a Claude Code selection.");
    const workdir = scope?.workdir || terminalSessionSourceRoot(session);
    if (!path.isAbsolute(workdir || "") || !runtime.stateRoot) throw error("Claude requires a prepared session workspace.");
    return { ...context, runtime, session, selection, sessionId, workdir,
      key: `${path.resolve(runtime.stateRoot)}\0${sessionId}` };
  }

  async function metadata(context, values) {
    if (context.assistantScope) return;
    const store = context.runtime.store;
    const renewal = Boolean(context.session?.metadata?.renewed_from);
    const write = renewal ? store.writeMetadataValueForRenewal.bind(store) : store.writeMetadataValue.bind(store);
    const mutate = renewal ? store.mutateSessionForRenewal.bind(store) : store.mutateSession.bind(store);
    await mutate(context.sessionId, async () => {
      for (const [name, value] of Object.entries(values)) await write(context.sessionId, name, String(value));
    });
    context.session.metadata ||= {};
    Object.assign(context.session.metadata, values);
  }

  function snapshot(entry) {
    return entry?.turn ? { ...entry.turn, threadId: entry.id } : null;
  }
  async function save(entry) {
    await metadata(entry.context, { [`claude_conversation_${entry.id}`]: JSON.stringify({
      executionId: entry.process?.executionId || entry.executionId || "",
      accountIdentity: entry.accountIdentity, sent: entry.sent, state: entry.turn?.state || "ready", turnId: entry.turn?.id || "",
      lastMessageId: entry.lastMessageId || "", main: entry.main, nativeWorkdir: entry.nativeWorkdir || entry.context.workdir
    }) });
  }

  async function publishRun(entry, state, message = "") {
    if (!entry.turn) return;
    const active = [RUN.STARTING, RUN.ACTIVE, RUN.FINALIZING].includes(state);
    Object.assign(entry.turn, { active, state, error: message, updatedAt: now() });
    await save(entry);
    if (!entry.main || entry.renewal) return;
    const { runtime, sessionId, selection } = entry.context;
    const run = await runtime.store.writeAgentRunEvent(sessionId, TRANSPORT, {
      event: { kind: `claude-${state}`, state, message },
      patch: { engineId: ENGINE, state, error: message, observationError: entry.observationError || "",
        model: selection.modelId, modelProviderId: "anthropic", threadId: entry.id,
        turnId: entry.turn.id, startedAt: entry.turn.startedAt, finishedAt: active ? "" : now(), updatedAt: now() }
    });
    await publishSessionChanged(sessionId, {
      reason: active ? "claude-stream-turn-active" : "claude-stream-turn-idle",
      payload: {
        ...(!active ? { conversationStream: runtime.store.clearConversationStream(sessionId) } : {}),
        agentRun: { ...run, active, provider: ENGINE, providerInterface: TRANSPORT,
          providerThreadId: entry.id, providerTurnId: entry.turn.id },
        agentSession: { providerId: ENGINE, transportId: TRANSPORT, thread: { id: entry.id },
          turn: { ...snapshot(entry), runState: state, state: active ? "active" : "idle" } }
      }
    });
  }

  async function publishMessage(entry, message) {
    entry.messages.set(message.id, message);
    if (!entry.main || entry.renewal) return;
    const { runtime, sessionId } = entry.context;
    if (!message.complete) {
      if (message.role !== "assistant") return;
      const conversationStream = runtime.store.updateConversationStream(sessionId, {
        turnId: entry.turn?.id, messageId: message.id, text: message.text
      });
      await publishSessionChanged(sessionId, { reason: "assistant-stream", payload: { conversationStream } });
      return;
    }
    if (!text(message.text)) return;
    const writer = message.role === "thinking" ? "writeConversationThinkingMessage"
      : message.role === "commentary" ? "writeConversationCommentaryMessage" : "writeConversationAssistantMessage";
    const turn = await runtime.store[writer](sessionId, { messageId: message.id, text: message.text });
    runtime.store.completeConversationStreamMessage(sessionId, message.id);
    await publishSessionChanged(sessionId, { reason: "claude-stream-message", payload: {
      conversationLogPatch: { type: "upsert-turn", turn },
      conversationStream: runtime.store.readConversationStream(sessionId)
    } });
  }

  async function stopEntry(entry, reason = "") {
    entry.stopping = true;
    let proof = { scopeEmpty: true };
    if (entry.process) {
      proof = await entry.process.stop();
    } else if (entry.executionId) {
      proof = await stopExecution(entry.executionId, {
        allowMissingRecordScopeRecovery: true,
        reason: "claude-code-stop"
      });
    }
    if (proof.scopeEmpty !== true && proof.exited !== true) {
      entry.observationError = reason || "Claude process exit has not been confirmed. Try Stop again.";
      await save(entry);
      throw error(entry.observationError, "vibe64_claude_stop_unconfirmed");
    }
    entry.process = null;
    entry.executionId = "";
    entry.exitProof = { ...proof, exited: true };
    for (const pending of entry.admissions.values()) pending.reject(error(reason || "Claude stopped before acknowledging the prompt."));
    entry.admissions.clear();
    entry.inFlight.clear();
    entry.tasks.clear();
    if (entry.turn?.active) await publishRun(entry, RUN.INTERRUPTED, reason);
    else await save(entry);
    entry.completion?.resolve(resultFor(entry));
    return entry.exitProof;
  }

  function resultFor(entry) {
    const failed = entry.turn?.state === RUN.FAILED;
    let status = "completed";
    if (entry.turn?.active) status = "inProgress";
    else if (failed) status = "failed";
    else if (entry.turn?.state === RUN.INTERRUPTED) status = "interrupted";
    return { ok: !failed, conversationId: entry.id, threadId: entry.id,
      runId: entry.turn?.id || "", turnId: entry.turn?.id || "", text: entry.result || "",
      messages: [...entry.messages.values()], error: entry.turn?.error || "", status };
  }

  function checkOutputLimit(entry, value) {
    const limit = entry.profile?.limits.maxOutputCharacters || 4 * 1024 * 1024;
    if (value.length > limit) throw error("Claude output exceeded its size limit.");
  }

  async function receive(entry, frame) {
    if (entry.stopping) return;
    if (frame.session_id && frame.session_id !== entry.id) throw error("Claude returned a different conversation id.");
    if (frame.parent_tool_use_id) return; // Nested agents do not replace the main reply.
    await entry.onEvent?.({ type: "provider-event", providerId: ENGINE, event: frame, threadId: entry.id, turnId: entry.turn?.id || "" });
    if (entry.main && ["active_goal", "rate_limit_event"].includes(frame.type)) {
      if (frame.type === "rate_limit_event") planUsage = null;
      await publishSessionChanged(entry.context.sessionId, {
        reason: frame.type === "active_goal" ? "claude-goal" : "claude-plan-usage"
      });
    }
    if (frame.type === "command_lifecycle" || frame.type === "user") {
      const uuid = frame.type === "user" ? frame.uuid : frame.command_uuid;
      if (frame.type === "user" && !entry.inFlight.has(uuid) && !entry.admissions.has(uuid)) return;
      if (frame.type === "user") entry.sent = true;
      if (frame.state === "started" || frame.type === "user") entry.currentCommandId = uuid;
      if (frame.state === "cancelled" && entry.steerBarrier) {
        entry.inFlight.delete(uuid);
        entry.steerBarrier.resolve();
      }
      if (frame.state === "queued" || frame.type === "user") {
        const pending = entry.admissions.get(uuid);
        if (pending) {
          await pending.accept();
          entry.admissions.delete(uuid);
          pending.resolve();
        }
        await save(entry);
        if (entry.main && frame.type === "user") await publishSessionChanged(entry.context.sessionId, { reason: "claude-goal" });
      }
    } else if (frame.type === "system") {
      if (frame.subtype === "local_command_output" && frame.content) {
        await publishMessage(entry, { id: `claude_${frame.uuid}`, role: "commentary", text: frame.content, complete: true });
      }
      if (frame.subtype === "task_started" && ["local_agent", "local_workflow"].includes(frame.task_type)) entry.tasks.add(frame.task_id);
      if (["task_notification", "task_updated"].includes(frame.subtype) &&
          ["completed", "failed", "stopped", "killed"].includes(frame.status || frame.patch?.status)) entry.tasks.delete(frame.task_id);
    } else if (frame.type === "stream_event") {
      const event = frame.event || {};
      if (event.type === "message_start") entry.messageId = event.message?.id || frame.uuid;
      const id = `claude_${entry.messageId}_${event.index}`;
      if (event.type === "content_block_start" && ["text", "thinking"].includes(event.content_block?.type)) {
        entry.messages.set(id, { id, complete: false, role: event.content_block.type === "thinking" ? "thinking" : "assistant",
          text: event.content_block.text || event.content_block.thinking || "" });
      } else if (event.type === "content_block_delta") {
        const block = entry.messages.get(id);
        const delta = event.delta?.text ?? event.delta?.thinking;
        if (block && typeof delta === "string") {
          block.text += delta;
          checkOutputLimit(entry, block.text);
          await publishMessage(entry, block);
          await entry.onEvent?.({ type: block.role === "thinking" ? "thinking" : "text", text: delta, threadId: entry.id });
        }
      } else if (event.type === "content_block_stop") {
        entry.messages.delete(id);
        if (entry.main && !entry.renewal) {
          entry.context.runtime.store.completeConversationStreamMessage(entry.context.sessionId, id);
        }
      }
    } else if (frame.type === "assistant") {
      for (const block of claudeMessageBlocks(frame)) {
        checkOutputLimit(entry, block.text);
        await publishMessage(entry, block);
      }
    } else if (frame.type === "result") {
      entry.result = typeof frame.structured_output === "object" ? JSON.stringify(frame.structured_output) : String(frame.result || "");
      checkOutputLimit(entry, entry.result);
      const failure = frame.is_error || frame.subtype !== "success";
      const message = failure ? (frame.errors || []).join("; ") || entry.result || frame.subtype : "";
      if (entry.result && ![...entry.messages.values()].some((block) => block.complete && block.role === "assistant" && block.text === entry.result)) {
        await publishMessage(entry, { id: `claude_${frame.uuid || entry.turn.id}_result`, role: "assistant", text: entry.result, complete: true });
      }
      entry.inFlight.delete(entry.currentCommandId);
      if (entry.steerBarrier) {
        entry.steerBarrier.resolve();
        return;
      }
      if (entry.interruptRequested) return;
      const interrupted = ["aborted_streaming", "aborted_tools"].includes(frame.terminal_reason);
      entry.outcome = { state: interrupted ? RUN.INTERRUPTED : failure ? RUN.FAILED : RUN.COMPLETED, message };
    }
    if ((frame.type === "system" || frame.type === "result") &&
        entry.outcome && entry.inFlight.size === 0 && entry.tasks.size === 0) {
      await publishRun(entry, entry.outcome.state, entry.outcome.message);
      if (frame.type === "result" && entry.main) {
        await publishSessionChanged(entry.context.sessionId, { reason: "claude-goal" });
      }
      entry.completion?.resolve(resultFor(entry));
    }
  }

  async function entryFor(context, conversationId = "", { create = false } = {}) {
    const ctx = await contextFor(context);
    const main = !conversationId || conversationId === ctx.session?.metadata?.claude_conversation_id;
    const id = conversationId || text(ctx.session?.metadata?.claude_conversation_id) ||
      [...entries.values()].find((entry) => entry.main && entry.context.key === ctx.key)?.id || randomUUID();
    requireClaudeSessionId(id);
    const key = `${ctx.key}\0${id}`;
    if (entries.has(key)) {
      const entry = entries.get(key);
      entry.context = ctx;
      return entry;
    }
    const saved = ctx.session?.metadata?.[`claude_conversation_${id}`];
    if (!main && !saved && !create) throw error("This Claude conversation is unavailable.");
    const state = saved ? JSON.parse(saved) : {};
    const entry = { id, key, main, context: ctx, process: null, executionId: state.executionId || "",
      accountIdentity: state.accountIdentity || "", sent: state.sent === true, nativeWorkdir: state.nativeWorkdir || ctx.workdir,
      messages: new Map(), admissions: new Map(), inFlight: new Set(), tasks: new Set(), result: "",
      lastMessageId: state.lastMessageId || "", turn: state.turnId ? {
        id: state.turnId, active: [RUN.STARTING, RUN.ACTIVE, RUN.FINALIZING].includes(state.state),
        state: state.state, startedAt: now(), updatedAt: now()
      } : null };
    entries.set(key, entry);
    if (main) await metadata(ctx, { claude_conversation_id: id, agent_identity_conversation_id: id,
      agent_identity_provider: ENGINE, agent_identity_resume_strategy: "provider-native",
      agent_identity_status: "ready", agent_identity_workdir: ctx.workdir,
      agent_transport_id: TRANSPORT, agent_transport_kind: "stream-json" });
    await save(entry);
    return entry;
  }

  function readHistory(entry) {
    return readClaudeHistory({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
  }

  async function sessionInstructions(workdir, conversationKind) {
    const { output } = await composeSessionContext({
      projectRoot: workdir,
      conversationKind,
      session: {
        managedGit: Boolean(codexGitCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    });
    return output;
  }

  async function prepareSessionEnvironment(context) {
    const prepared = await prepareCommandEnvironment({
      env, gitCommand: codexGitCommand,
      agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
      project: await projectService.readCurrentProject(), runtime: context.runtime,
      sessionId: context.sessionId, worktreePath: context.workdir
    });
    if (prepared.ok !== true) throw error("Claude's session command environment could not be prepared.");
    return prepared;
  }

  async function accountIdentity(context) {
    const account = await accountStatus(context);
    const email = text(account.email).toLowerCase();
    if (!account.loggedIn || !email) {
      throw error("Sign in to Claude Code with your Claude account before continuing.", "vibe64_claude_account_required");
    }
    return `sha256:${hash(JSON.stringify([configRoot, account.authMethod, email]))}`;
  }

  async function stopAccountProcess(native) {
    accountProcessStops.add(native);
    if (!(await native.stop()).scopeEmpty) throw error("Claude account query process cleanup could not be confirmed.");
    accountProcessStops.delete(native);
  }

  async function readAccountProcess(identity, read) {
    if (closing) throw error("Claude is reconnecting.");
    for (const native of accountProcessStops) await stopAccountProcess(native);
    const owned = [...entries.values()].find((entry) =>
      entry.process && !entry.stopping && entry.accountIdentity === identity);
    if (owned) return read(owned.process);
    const native = await createProcess({ command, commandRunner, stopExecution, credentialHome, env,
      workdir: credentialHome.home, toolFree: true, onEvent: async () => {} });
    try {
      return await read(native);
    } finally {
      await stopAccountProcess(native);
    }
  }

  async function bindAccount(entry) {
    const identity = await accountIdentity(entry.context);
    if (entry.accountIdentity && entry.accountIdentity !== identity) {
      await stopEntry(entry, "The signed-in Claude account changed.");
      throw error("This conversation belongs to another Claude account. Reconnect that account or start a new session.", "vibe64_claude_account_changed");
    }
    if (!entry.accountIdentity) {
      entry.accountIdentity = identity;
      await save(entry);
    }
  }

  async function ensureProcess(entry, input = {}) {
    if (listTerminalSessions({ namespace: claudeTerminalNamespace(entry.context.sessionId), runningOnly: true }).length) {
      throw error("Close the Claude Code terminal before sending in chat.", "vibe64_claude_terminal_active");
    }
    if (closing || closingSessions.has(entry.context.key) || sessionIsClosing(entry.context.session)) throw error("This session is closing.");
    await bindAccount(entry);
    const selection = entry.context.selection;
    const profile = input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
    const identity = JSON.stringify([selection, profile, input.outputSchema]);
    if (entry.process && !entry.stopping && entry.identity === identity) return entry.process;
    if (entry.process && !entry.stopping && entry.turn?.active) throw error("Stop the current Claude turn before changing its settings.");
    if (starts.has(entry.key)) return starts.get(entry.key);
    const start = (async () => {
      if (entry.process && !entry.stopping && !profile && !entry.profile &&
          entry.outputSchemaIdentity === JSON.stringify(input.outputSchema)) {
        try {
          await entry.process.client.request({ subtype: "set_model", model: selection.modelId });
          await entry.process.client.request({ subtype: "apply_flag_settings", settings: {
            effortLevel: selection.variantId || null
          } });
          entry.identity = identity;
          return entry.process;
        } catch (failure) {
          await stopEntry(entry, failure.message);
          throw failure;
        }
      }
      if (entry.process || entry.executionId) await stopEntry(entry, "Claude's previous process was stopped before reconnecting.");
      const ctx = entry.context;
      let prepared = { env: ctx.assistantScope?.environment || {}, shimDirs: [] };
      if (!ctx.assistantScope && !profile && codexGitCommand) {
        prepared = await prepareSessionEnvironment(ctx);
      }
      entry.nativeWorkdir = profile || ctx.assistantScope ? credentialHome.home : ctx.workdir;
      const history = await readHistory(entry);
      entry.sent ||= history.exists;
      entry.stopping = false;
      entry.profile = profile;
      entry.identity = identity;
      entry.outputSchemaIdentity = JSON.stringify(input.outputSchema);
      entry.process = await createProcess({ command, commandRunner, stopExecution, credentialHome,
        env: { ...env, ...prepared.env }, shimDirs: prepared.shimDirs, workdir: entry.nativeWorkdir,
        sessionId: entry.id, resume: entry.sent, model: profile?.model || selection.modelId,
        effort: profile ? profile.thinking : selection.variantId,
        toolFree: Boolean(profile || ctx.assistantScope), outputSchema: input.outputSchema,
        systemPrompt: ctx.assistantScope?.stableContext,
        appendSystemPrompt: !profile && !ctx.assistantScope
          ? await sessionInstructions(ctx.workdir, entry.main ? "main" : "temporary") : undefined,
        execution: { ownerId: entry.id, sessionId: ctx.sessionId },
        onStarted: async (executionId) => {
          entry.executionId = executionId;
          await save(entry);
        },
        onEvent: (frame) => receive(entry, frame),
        onFailure: async (failure) => {
          entry.observationError = failure.message;
          await stopEntry(entry, failure.message);
        }
      });
      await save(entry);
      return entry.process;
    })().finally(() => starts.delete(entry.key));
    starts.set(entry.key, start);
    return start;
  }

  async function send(entry, input = {}, { renewal = false } = {}) {
    const message = text(input.message || input.prompt);
    if (!message) throw error("Enter a message for Claude.");
    const ctx = entry.context;
    const messageId = text(input.messageId) || randomUUID();
    const uuid = nativeMessageId(messageId);
    if (entry.main && await ctx.runtime.store.conversationMessageIdExists(ctx.sessionId, messageId)) {
      return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
    }
    if (entry.turn?.active && ctx.turnOwnership?.reusable === false) throw error("This turn belongs to another user.", "vibe64_agent_turn_owner_conflict");
    const history = await readHistory(entry);
    if (history.userIds.includes(uuid)) {
      return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
    }
    const native = await ensureProcess(entry, input);
    const steering = Boolean(entry.turn?.active);
    if (steering) {
      // Streaming user input otherwise queues behind the entire running turn.
      // Claude's supported steering path interrupts generation, then continues
      // the same native history with the new instruction.
      entry.steerBarrier = Promise.withResolvers();
      let timer;
      try {
        await Promise.all([native.client.interrupt(), Promise.race([
          entry.steerBarrier.promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(error("Claude did not confirm the interrupted generation.")), 30_000);
          })
        ])]);
      } catch (failure) {
        await stopEntry(entry, failure.message);
        throw failure;
      } finally {
        clearTimeout(timer);
        entry.steerBarrier = null;
      }
    }
    if (entry.profile && message.length > entry.profile.limits.maxInputCharacters) throw error("Claude helper input exceeded its limit.");
    if (!ctx.assistantScope && !entry.profile) {
      const actor = await recordGitActor({ env, overwrite: !steering, reason: "agent-message", runtime: ctx.runtime,
        session: ctx.session, sourceRoot: ctx.workdir, threadId: entry.id, vibe64User: ctx.vibe64User, workdir: ctx.workdir });
      if (actor?.ok === false) throw error(actor.error, actor.code);
    }
    let prompt = message;
    if (!renewal && entry.main && !/^\/goal(?:\s|$)/u.test(message) && ((!steering && !entry.sent) || input.genesisTask)) {
      prompt = (await ctx.runtime.renderPrompt(ctx.sessionId, { input, request: message, task: input.genesisTask || "start" }))?.prompt || message;
    }
    // The attachment owner already added validated paths to the prompt.
    if (input.attachments?.length && (entry.profile || ctx.assistantScope)) {
      throw error("These attachments cannot be passed to Claude.");
    }
    if (!steering) {
      entry.renewal = renewal;
      entry.outcome = null;
      entry.messages.clear();
      entry.result = "";
      entry.interruptRequested = false;
      entry.observationError = "";
      entry.turn = { id: uuid, active: true, state: RUN.STARTING, startedAt: now(), updatedAt: now(), error: "" };
      entry.completion = Promise.withResolvers();
      await publishRun(entry, RUN.STARTING);
    }
    entry.onEvent = ctx.onEvent;
    entry.lastMessageId = uuid;
    entry.inFlight.add(uuid);
    const actorMetadata = await conversationActorMetadata({ vibe64User: ctx.vibe64User });
    const admitted = Promise.withResolvers();
    void admitted.promise.catch(() => {});
    let conversationTurn;
    entry.admissions.set(uuid, { ...admitted, async accept() {
      if (entry.main && !renewal) {
        conversationTurn = await ctx.runtime.store.writeConversationUserMessage(ctx.sessionId, {
          messageId, text: text(input.displayMessage) || message, attachments: input.displayAttachments,
          turnMetadata: { ...actorMetadata, assistantSelection: ctx.selection, engineId: ENGINE, upstreamMessageId: uuid }
        });
        await publishSessionChanged(ctx.sessionId, { reason: "claude-stream-message-delivered", payload: {
          conversationLogPatch: { type: "upsert-turn", turn: conversationTurn }
        } });
      }
      await publishRun(entry, RUN.ACTIVE);
    } });
    const timer = setTimeout(() => admitted.reject(error("Claude has not acknowledged this prompt. Its delivery is uncertain.", "vibe64_claude_admission_unknown")), 30_000);
    try {
      await input.onPromptSending?.({ threadId: entry.id, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata });
      await Promise.all([native.client.send(prompt, { messageId: uuid, sessionId: entry.id }), admitted.promise]);
    } catch (failure) {
      await stopEntry(entry, failure.message);
      throw failure;
    } finally {
      clearTimeout(timer);
    }
    return { ok: true, delivered: true, deliveryMode: steering ? "steer" : "new_turn",
      thread: { id: entry.id }, turn: snapshot(entry), workdir: ctx.workdir, conversationTurn };
  }

  async function interrupt(entry) {
    if (!entry.turn?.active) return { ok: true, interrupted: false, turn: snapshot(entry) };
    entry.interruptRequested = true;
    try {
      if (entry.process) await entry.process.client.interrupt();
    } catch {
      // A verified managed-scope stop also handles an unresponsive control pipe.
    } finally {
      // A control acknowledgement is not a process-exit proof. Draining also
      // cancels queued steering prompts and native background tools.
      await stopEntry(entry);
    }
    return { ok: true, interrupted: true, thread: { id: entry.id }, turn: snapshot(entry) };
  }

  async function goalFor(entry) {
    const { goal = null } = await readHistory(entry);
    return goal ? { ...goal, status: goal.status === "complete" ? "complete" :
      entry.process && entry.turn?.active ? "active" : "paused" } : null;
  }

  async function readConversation(context, input = {}) {
    const entry = await entryFor(context, input.conversationId || input.threadId);
    if (entry.executionId && !entry.process) await stopEntry(entry, "Claude was interrupted when Vibe64 disconnected.");
    const history = await readHistory(entry);
    const messages = new Map(history.messages.map((message) => [message.id, message]));
    for (const [id, message] of entry.messages) messages.set(id, message);
    return { ...resultFor(entry), ok: true, messages: [...messages.values()], text: entry.result || history.text,
      admitted: history.userIds.includes(nativeMessageId(input.messageId || "")) };
  }

  async function startConversationTurn(context, input = {}) {
    const entry = await entryFor(context, input.conversationId || input.threadId);
    if (entry.turn?.active && entry.process) throw error("This conversation is still working.");
    await send(entry, input);
    return { ...resultFor(entry), ok: true, started: true };
  }
  async function waitForConversationTurn(context, input = {}) {
    const entry = await entryFor(context, input.conversationId || input.threadId);
    if (entry.executionId && !entry.process) await stopEntry(entry, "Claude was interrupted when Vibe64 disconnected.");
    if (!entry.turn?.active) return readConversation(context, input);
    const timeoutMs = Math.min(Number(input.timeoutMs) || 180_000, entry.profile?.limits.timeoutMs || Infinity);
    let timer;
    const abort = () => { void interrupt(entry).catch(() => {}); };
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
    try {
      return await Promise.race([entry.completion.promise, new Promise((_, reject) => {
        timer = setTimeout(() => {
          void interrupt(entry).then(() => reject(error("Claude did not finish within the time limit.")), reject);
        }, timeoutMs);
      })]);
    } finally {
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    }
  }
  async function runDetachedChatTurn(context, input = {}) {
    const conversationId = input.conversationId || input.threadId || randomUUID();
    await entryFor(context, conversationId, { create: !input.conversationId && !input.threadId });
    const executionProfile = input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
    if (executionProfile) await context.onEvent?.({ type: "execution-profile", executionProfile });
    await startConversationTurn(context, { ...input, conversationId });
    const result = await waitForConversationTurn(context, { ...input, conversationId });
    return executionProfile ? { ...result, executionProfile } : result;
  }

  async function restoreSessionEntries(ctx) {
    for (const [key, value] of Object.entries(ctx.session?.metadata || {})) {
      if (key.startsWith("claude_conversation_") && key !== "claude_conversation_id" && value) {
        await entryFor(ctx, key.slice("claude_conversation_".length));
      }
    }
    return [...entries.values()].filter((entry) => entry.context.key === ctx.key);
  }

  async function renewalTurn(context, input, kind, prompt, outputSchema) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const clientMessageId = sessionRenewalClientMessageId(kind, operationId);
    const uuid = nativeMessageId(clientMessageId);
    const entry = await entryFor(context);
    if ((input.expectedThreadId && input.expectedThreadId !== entry.id) ||
        (kind === "seed" && (input.forbiddenThreadId || input.oldThreadId) === entry.id)) {
      throw error("The Claude renewal conversation does not match the expected native history.");
    }
    const history = await readHistory(entry);
    if (kind === "seed" && history.userIds.some((id) => id !== uuid)) throw error("The successor Claude conversation already contains unrelated messages.");
    const accepted = history.userIds.includes(uuid);
    let result;
    try {
      if (accepted) {
        result = { text: history.messages.filter((message) => message.userId === uuid && message.role === "assistant").map((message) => message.text).join("\n"),
          threadId: entry.id, turnId: uuid, reconciled: true };
        if (!result.text) throw error("The accepted Claude renewal turn has no readable result; it will not be submitted again.", "vibe64_session_renewal_turn_unreadable");
      } else {
        if (entry.turn?.active && entry.process) throw error("Stop the current turn before renewing this conversation.");
        await send(entry, { message: prompt, messageId: clientMessageId, outputSchema }, { renewal: true });
        result = await waitForConversationTurn(context, { conversationId: entry.id, timeoutMs: 180_000 });
        if (result.status !== "completed") throw error(result.error || "Claude did not complete the renewal turn.", "vibe64_session_renewal_turn_failed");
      }
      return { ...result, clientMessageId, operationId, source: input.source,
        freshThread: history.userIds.length === 0, processExitProof: await stopEntry(entry) };
    } catch (failure) {
      failure.details = { ...failure.details, clientMessageId, handoverPromptAccepted: accepted || entry.lastMessageId === uuid,
        threadId: entry.id, turnId: entry.turn?.id || uuid };
      await stopEntry(entry, failure.message);
      throw failure;
    }
  }

  const provider = {
    id: ENGINE, transportId: TRANSPORT, executionProfiles: ["economy"],
    async capabilities(context) {
      const connected = await connectionStatus(context);
      if (!connected) return claudeCapabilities({}, false);
      if (closing) throw error("Claude is reconnecting.");
      const identity = await accountIdentity(context);
      if (!catalog || catalog.identity !== identity || Date.now() - catalog.at > 600_000) {
        catalogStart ||= (async () => {
          const value = await readAccountProcess(identity, (native) => native.initialization);
          if (identity !== await accountIdentity(context)) throw error("The signed-in Claude account changed. Refresh the model list.");
          catalog = { at: Date.now(), identity, value };
        })().finally(() => { catalogStart = null; });
        await catalogStart;
      }
      return claudeCapabilities(catalog.value, true);
    },
    async describeProvider(context) {
      return {
        providerId: ENGINE,
        transportId: TRANSPORT,
        accountIdentitySignature: await accountIdentity(context)
      };
    },
    async ensureSession(context) {
      const entry = await entryFor(context);
      await ensureProcess(entry);
      return { ok: true, thread: { id: entry.id }, turn: snapshot(entry), workdir: entry.context.workdir };
    },
    async sessionState(context) {
      const entry = await entryFor(context);
      return { ok: true, thread: { id: entry.id }, turn: snapshot(entry), workdir: entry.context.workdir,
        terminal: listTerminalSessions({ namespace: claudeTerminalNamespace(context.sessionId), runningOnly: true })[0] || null };
    },
    async sendMessage(context, input) { return send(await entryFor(context), input); },
    async readPlanUsage(context) {
      const identity = await accountIdentity(context);
      if (planUsage?.identity === identity && Date.now() - planUsage.checkedAt < 60_000) return planUsage;
      if (planUsagePending) return planUsagePending;
      planUsagePending = (async () => {
        const value = await readAccountProcess(identity, (native) => native.client.request(
          { subtype: "get_usage", skip_behaviors: true }));
        if (identity !== await accountIdentity(context)) return { status: "unavailable", windows: [] };
        planUsage = { ...claudePlanUsage(value), identity };
        return planUsage;
      })().finally(() => { planUsagePending = null; });
      return planUsagePending;
    },
    async readGoal(context) {
      const entry = await entryFor(context);
      await bindAccount(entry);
      return { status: "available", threadId: entry.id, goal: await goalFor(entry) };
    },
    async updateGoal(context, input = {}) {
      const entry = await entryFor(context);
      await bindAccount(entry);
      const goal = await goalFor(entry);
      const action = input.action;
      if (action !== "set" && (!goal || input.threadId !== entry.id ||
          input.createdAt !== goal.createdAt || input.objective !== goal.objective)) {
        throw error("The Claude goal changed. Refresh before trying again.");
      }
      if (input.tokenBudget != null) throw error("Claude goals do not support a token budget.");
      if (action === "pause") {
        await interrupt(entry);
      } else if (action === "cancel") {
        await interrupt(entry);
        await send(entry, { message: "/goal clear" });
      } else if (action === "set" || action === "resume") {
        const objective = text(action === "set" ? input.objective : goal.objective);
        if (!objective || objective.length > 4000 || /^(clear|stop|off|reset|none|cancel)$/iu.test(objective)) {
          throw error("Enter a goal condition of up to 4,000 characters.");
        }
        if (entry.turn?.active || (action === "set" && goal && goal.status !== "complete")) {
          throw error("Stop the current turn and cancel the existing goal before setting another.");
        }
        await send(entry, { message: `/goal ${objective}` });
      } else throw error("Unknown Claude goal action.");
      await publishSessionChanged(entry.context.sessionId, { reason: "claude-goal" });
      return { ok: true, status: "available", threadId: entry.id, goal: await goalFor(entry) };
    },
    async generateSessionRenewalHandover(context, input = {}) {
      const result = await renewalTurn(context, input, "handover", sessionRenewalHandoverPrompt(input));
      const parsed = parseSessionRenewalHandoverOutput(result.text, { source: input.source });
      await metadata(await contextFor(context), {
        agent_renewal_handover_hash: parsed.handoverHash, agent_renewal_handover_operation_id: result.operationId,
        agent_renewal_handover_thread_id: result.threadId, agent_renewal_handover_turn_id: result.turnId
      });
      return { ...result, ...parsed, ok: true };
    },
    async seedSessionRenewalHandover(context, input = {}) {
      const approved = defineSessionRenewalApprovedHandover(input);
      const result = await renewalTurn(context, input, "seed", sessionRenewalSeedPrompt(approved), sessionRenewalAcknowledgementOutputSchema(approved));
      let acknowledgement;
      try { acknowledgement = parseSessionRenewalAcknowledgement(result.text, approved); }
      catch (failure) {
        failure.details = { ...failure.details, clientMessageId: result.clientMessageId, handoverPromptAccepted: true,
          threadId: result.threadId, turnId: result.turnId };
        throw failure;
      }
      const acknowledgedAt = now();
      await metadata(await contextFor(context), {
        agent_briefing_delivered: "yes", agent_briefing_delivered_at: acknowledgedAt, agent_briefing_transport: TRANSPORT,
        agent_renewal_seed_acknowledged_at: acknowledgedAt, agent_renewal_seed_handover_hash: approved.handoverHash,
        agent_renewal_seed_operation_id: result.operationId, agent_renewal_seed_thread_id: result.threadId,
        agent_renewal_seed_turn_id: result.turnId
      });
      return { ...result, acknowledgement, acknowledgedAt, handoverHash: approved.handoverHash, ok: true, subscriptionDeferred: true };
    },
    async inspectMessageAdmission(context, input) {
      const entry = await entryFor(context);
      if (input.threadId && input.threadId !== entry.id) return { ok: true, admission: "unknown", messageId: input.messageId, threadId: entry.id };
      const history = await readHistory(entry);
      return { ok: true, admission: history.userIds.includes(nativeMessageId(input.messageId)) ? "accepted" : "unknown", messageId: input.messageId, threadId: entry.id };
    },
    async interruptTurn(context) { return interrupt(await entryFor(context)); },
    async rewindConversation(context, input = {}) {
      const entry = await entryFor(context);
      await bindAccount(entry);
      if (entry.turn?.active || entry.inFlight.size || entry.tasks.size || (await goalFor(entry))?.status === "active") {
        throw error("Stop Claude and pause its goal before undoing a turn.");
      }
      const history = await readHistory(entry);
      const checkpoint = input.checkpoint || {
        threadId: entry.id, messageId: nativeMessageId(input.messageId),
        previousMessageId: nativeMessageId(input.previousMessageId)
      };
      if (checkpoint.threadId !== entry.id) throw error("The Claude conversation changed. Refresh before undoing.");
      const alreadyRewound = !history.userIds.includes(checkpoint.messageId) &&
        history.userIds.at(-1) === checkpoint.previousMessageId;
      if (!alreadyRewound && (history.userIds.at(-1) !== checkpoint.messageId ||
          history.userIds.at(-2) !== checkpoint.previousMessageId)) {
        throw error("Claude's last turn no longer matches this conversation. Refresh before undoing.");
      }
      if (!input.checkpoint) return { ok: true, checkpoint };
      entry.outcome = null;
      if (!alreadyRewound) {
        const native = await ensureProcess(entry);
        const response = await native.client.request({ subtype: "rewind_conversation", target_message_uuid: checkpoint.messageId });
        if (!response.rewound || response.targetMessageUuid !== checkpoint.messageId) {
          throw error("Claude did not confirm the rewind. Retry Undo last turn to check it.");
        }
      }
      entry.messages.clear();
      entry.result = "";
      entry.turn = { id: checkpoint.previousMessageId, state: RUN.COMPLETED, active: false, updatedAt: now() };
      entry.lastMessageId = "";
      await save(entry);
      await entry.context.runtime.store.writeAgentRunEvent(entry.context.sessionId, TRANSPORT, {
        event: { kind: "conversation-rewound", state: RUN.COMPLETED },
        patch: { state: RUN.COMPLETED, error: "", observationError: "", turnId: checkpoint.previousMessageId }
      });
      return { ok: true };
    },
    async createConversation(context, input = {}) {
      const entry = await entryFor(context, randomUUID(), { create: true });
      return { ok: true, conversationId: entry.id, ephemeral: input.ephemeral === true, status: "ready" };
    },
    readConversation, startConversationTurn, waitForConversationTurn, runDetachedChatTurn,
    streamDetachedChatTurn: runDetachedChatTurn,
    async stopConversation(context, input) {
      const entry = await entryFor(context, input.conversationId || input.threadId);
      await stopEntry(entry);
      return { ok: true, stopped: true, conversationId: entry.id };
    },
    async interruptDetachedChatTurn(context, input) { return provider.stopConversation(context, input); },
    async deleteConversation(context, input) {
      const entry = await entryFor(context, input.conversationId || input.threadId);
      if (entry.main) throw error("The main Claude conversation cannot be deleted as a temporary chat.");
      await stopEntry(entry);
      const file = await claudeHistoryPath({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
      if (file) await rm(file.path, { force: true });
      await metadata(entry.context, { [`claude_conversation_${entry.id}`]: "" });
      entries.delete(entry.key);
      return { ok: true, deleted: true, conversationId: entry.id };
    },
    async deleteDetachedChatThread(context, input) { return provider.deleteConversation(context, input); },
    async hasActiveTemporaryConversation(context) {
      const ctx = await contextFor(context);
      await restoreSessionEntries(ctx);
      return { ok: true, active: [...entries.values()].some((entry) => entry.context.key === ctx.key && !entry.main && entry.turn?.active) };
    },
    async resolveExecutionProfile(context, request) {
      const limits = VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS[request.workloadId];
      if (request.profileId !== "economy" || !limits) throw error("Unsupported Claude helper execution profile.");
      const modelId = await createNativeHelperModelStore({ systemRoot, providerId: ENGINE }).read() || CLAUDE_RECOMMENDED_HELPER_MODEL;
      const catalog = await provider.capabilities(context);
      const model = catalog.modelProviders.flatMap((provider) => provider.models).find((model) => model.id === modelId);
      if (!model || (model.variants.length && !model.variants.some((variant) => variant.id === "low"))) {
        throw error("The selected Claude helper model is unavailable. Choose another in AI Accounts.");
      }
      const thinking = model.variants.length ? "low" : "";
      return defineVibe64AgentExecutionProfileResolution({
        ...request,
        limits,
        model: modelId,
        thinking,
        providerId: ENGINE,
        revision: `claude-${CLAUDE_CODE_VERSION}-${modelId}-tool-free-v1`,
        policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
        request: { allowProviderModelFallback: false, reasoning: Boolean(thinking), summary: false }
      });
    },
    async closeSession(context) {
      const ctx = await contextFor(context);
      closingSessions.add(ctx.key);
      try {
        await restoreSessionEntries(ctx);
        await Promise.all([...starts].filter(([key]) => key.startsWith(`${ctx.key}\0`)).map(([, start]) => start.catch(() => {})));
        const proofs = [];
        for (const entry of entries.values()) if (entry.context.key === ctx.key) proofs.push(await stopEntry(entry));
        const terminal = await closeTerminalSessionsForNamespace(claudeTerminalNamespace(ctx.sessionId));
        return { ok: terminal?.ok !== false, closed: proofs.length + Number(terminal?.closed || 0),
          processExitProof: proofs.at(-1) || { exited: true, scopeEmpty: true }, processExitProofs: proofs };
      } finally {
        closingSessions.delete(ctx.key);
      }
    },
    async closeProject(_context, input = {}) {
      const root = text(input.projectContextRoot);
      const contexts = new Map([...entries.values()]
        .filter((entry) => !root || path.resolve(entry.context.runtime.projectContextRoot || entry.context.workdir) === path.resolve(root))
        .map((entry) => [entry.context.key, entry.context]));
      let closed = 0;
      let ok = true;
      for (const ctx of contexts.values()) {
        const result = await provider.closeSession(ctx);
        closed += result.closed;
        ok &&= result.ok;
      }
      return { ok, closed };
    },
    async invalidateRuntimes(_context, input = {}) {
      if (input.provider && input.provider !== ENGINE) return { ok: true, closed: 0 };
      closing = true;
      try {
        await Promise.allSettled([catalogStart, planUsagePending]);
        catalog = null;
        planUsage = null;
        for (const native of accountProcessStops) await stopAccountProcess(native);
        return await provider.closeProject();
      } finally {
        closing = input.reason === "server-shutdown";
      }
    },
    async reconcileSessions(_context, sessions, options = {}) {
      const results = [];
      for (const session of sessions) {
        const ctx = await contextFor({ ...options, session, sessionId: session.sessionId });
        for (const entry of await restoreSessionEntries(ctx)) {
          if (!entry.process && (entry.executionId || entry.turn?.active)) await stopEntry(entry, "Claude was interrupted when Vibe64 disconnected.");
        }
        results.push({ ok: true, sessionId: session.sessionId, resumed: false });
      }
      return { ok: true, results, failed: [], sessionCount: results.length };
    },
    async startTerminal(context, input = {}) {
      const entry = await entryFor(context);
      if (entry.turn?.active) throw error("Stop the current turn before opening the Claude Code terminal.");
      if (closing || closingSessions.has(entry.context.key) || sessionIsClosing(entry.context.session)) throw error("This session is closing.");
      await bindAccount(entry);
      await stopEntry(entry);
      const ctx = entry.context;
      let prepared = { env: {}, shimDirs: [] };
      if (codexGitCommand) {
        prepared = await prepareSessionEnvironment(ctx);
      }
      const actor = await recordGitActor({ env, overwrite: true, reason: "agent-terminal", runtime: ctx.runtime,
        session: ctx.session, sourceRoot: ctx.workdir, threadId: entry.id, vibe64User: ctx.vibe64User, workdir: ctx.workdir });
      if (actor?.ok === false) throw error(actor.error, actor.code);
      const history = await readClaudeHistory({ configRoot, workdir: ctx.workdir, conversationId: entry.id });
      entry.sent ||= history.exists;
      return commandRunner({ actor: "app", command,
        args: claudeCodeArguments({ terminal: true, sessionId: entry.id, resume: entry.sent,
          model: ctx.selection.modelId, effort: ctx.selection.variantId,
          appendSystemPrompt: await sessionInstructions(ctx.workdir, "main") }),
        baseEnv: { ...env, ...prepared.env, DISABLE_AUTOUPDATER: "1" }, credentialHome, inheritProcessEnv: false, cwd: ctx.workdir,
        allowedRoots: [ctx.workdir], envPolicy: "auth", purpose: "assistant", mode: "pty",
        shimDirs: prepared.shimDirs, runtimes: ["operator-clis", "node26"], session: ctx.session,
        terminal: { namespace: claudeTerminalNamespace(ctx.sessionId), maxRunning: 1, reuseRunning: true,
          commandPreview: "claude", metadata: { engineId: ENGINE, sessionId: ctx.sessionId }, ...input.size } });
    },
    readTerminal(context, input) { return readTerminalSession(input.terminalSessionId, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    closeTerminal(context, input) { return closeTerminalSession(input.terminalSessionId, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    resizeTerminal(context, input) { return resizeTerminalSession(input.terminalSessionId, input.size, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    subscribeTerminal(context, input) { return subscribeTerminalSession(input.terminalSessionId, input.subscriber, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    writeTerminal(context, input) { return writeTerminalSessionText(input.terminalSessionId, input.data, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    async unsubscribeSessions() { return { ok: true }; },
    async releaseRenewalPredecessorAttachments() { return { ok: true, released: 0 }; },
    async releaseRenewalPredecessorProcessExitProof(context) { return provider.closeSession(context); },
    async releaseRenewalSuccessorProcessExitProof(context) { return provider.closeSession(context); }
  };
  return Object.freeze(provider);
}

export { claudeCapabilities, claudePlanUsage, createClaudeSessionAgentProvider, nativeMessageId };
