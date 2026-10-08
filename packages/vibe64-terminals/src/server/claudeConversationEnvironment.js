import { claudeModelConfiguration } from "@jskit-ai/assistant-core/server/claude-process";
import { codexAppServerRuntimeBaseDir } from "@local/vibe64-runtime/server/codexAppServerProvider";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { vibe64ConversationInstructions, vibe64HostContextEnvironment, vibe64HostContextRegistry, withGenesisCommandShim } from "@local/vibe64-genesis/server";
import { claudeFlagSettings } from "./claudeCodeProcess.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { claudeConversationError as error, claudeTerminalNamespace } from "./terminalShared.js";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { learningSessionExecutionRoot } from "./mainConversationBinding.js";
import {
  closeTerminalSession, readTerminalSession, resizeTerminalSession,
  subscribeTerminalSession, writeTerminalSessionText
} from "@local/vibe64-execution/server/terminalSessions";

const ENGINE = "claude";

// Vibe64's selected settings, managed command environment and Genesis host facts.
function createClaudeConversationEnvironment({
  env, projectService, command, credentialHome, commandRunner, stopExecution,
  providerConnections, prepareCommandEnvironment, codexGitCommand, agentDatabaseCommand,
  agentEnvCommand, agentPreviewCommand, agentSessionCommand
}) {
  function sessionGuidance(entry) {
    return {
      scope: "session",
      conversationKind: entry.main ? "main" : "temporary",
      session: {
        managedGit: Boolean(codexGitCommand),
        managedEnvironment: Boolean(agentEnvCommand),
        managedDatabaseRefresh: Boolean(agentDatabaseCommand),
        managedPreview: Boolean(agentPreviewCommand)
      }
    };
  }

  async function sessionGuidanceEnvironment(entry) {
    if (await learningSessionExecutionRoot(entry.context.runtime, entry.context.sessionId)) return {};
    const runtimeRoot = codexAppServerRuntimeBaseDir({ env });
    const registry = await vibe64HostContextRegistry(runtimeRoot);
    await registry.register(entry.id, sessionGuidance(entry), entry.context.workdir);
    return vibe64HostContextEnvironment(runtimeRoot);
  }

  async function prepareSessionEnvironment(context) {
    if (await learningSessionExecutionRoot(context.runtime, context.sessionId)) {
      return { env: {}, shimDirs: [] };
    }
    const prepared = await prepareCommandEnvironment({
      env, gitCommand: codexGitCommand,
      agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand,
      project: await projectService.readCurrentProject(), runtime: context.runtime,
      sessionId: context.sessionId, worktreePath: context.workdir
    });
    if (prepared.ok !== true) throw error("Claude's session command environment could not be prepared.");
    return {
      ...prepared,
      env: {
        ...await loadProjectExecutionEnv({ projectService, session: context.session, target: "claude" }),
        ...prepared.env
      }
    };
  }

  async function prepareConfiguration(entry, input = {}) {
    const selection = entry.context.selection;
    const profile = input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
    const external = await providerConnections.claudeProviderSettings(selection.modelProviderId);
    const configuration = claudeModelConfiguration({ providerId: selection.modelProviderId, model: profile?.model || selection.modelId }, external);
    const flagSettings = claudeFlagSettings({ toolFree: Boolean(profile || entry.context.assistantScope),
      effort: profile ? profile.thinking : selection.variantId, providerEnv: configuration.env });
    const applicationTools = Boolean(entry.command?.tools);
    const identity = JSON.stringify(applicationTools
      ? [selection, profile, input.outputSchema, entry.accountIdentity, entry.toolSchemas]
      : [selection, profile, input.outputSchema, entry.accountIdentity]);
    const learningRoot = await learningSessionExecutionRoot(entry.context.runtime, entry.context.sessionId);
    let systemPrompt = entry.context.assistantScope?.stableContext || (profile
      ? "Complete only the supplied task."
      : learningRoot ? await entry.context.runtime.getLearningInstructions(entry.context.sessionId)
      : await vibe64ConversationInstructions({ workdir: entry.context.workdir, promptContext: sessionGuidance(entry) }));
    if (!profile && !entry.context.assistantScope && entry.context.runtime.learningScope?.noExercise === false) {
      systemPrompt += `\n\n${await entry.context.runtime.getLearningInstructions(entry.context.sessionId)}`;
    }
    return {
      systemPrompt, contextIdentity: identity, settings: flagSettings, model: configuration.model,
      instructionMode: entry.context.assistantScope || profile ? "replace" : "append",
      liveUpdateIdentity: profile ? undefined : JSON.stringify(applicationTools
        ? [input.outputSchema ?? null, entry.toolSchemas] : input.outputSchema ?? null),
      profile, external, outputSchema: input.outputSchema, selection, ...(applicationTools ? { applicationTools: true } : {})
    };
  }

  async function prepareProcess(_entry, { profile }, ctx) {
    let prepared = { env: ctx.assistantScope?.environment || {}, shimDirs: [] };
    if (!ctx.assistantScope && !profile && codexGitCommand) {
      prepared = await prepareSessionEnvironment(ctx);
    }
    return { ...prepared, workdir: profile || ctx.assistantScope ? credentialHome.home : ctx.workdir };
  }

  async function configureProcess(entry, { instructionArguments, model, profile, external, outputSchema, selection, applicationTools }, { context: ctx, prepared }) {
    const guidanceEnvironment = !profile && !ctx.assistantScope ? await sessionGuidanceEnvironment(entry) : {};
    return { command, commandRunner, stopExecution, credentialHome,
      env: { ...env, ...prepared.env, ...guidanceEnvironment },
      shimDirs: !profile && !ctx.assistantScope && ctx.runtime?.learningScope?.noExercise !== true ? withGenesisCommandShim(prepared.shimDirs) : prepared.shimDirs,
      model: external ? "" : model,
      effort: profile ? profile.thinking : selection.variantId,
      toolFree: Boolean(profile || ctx.assistantScope), outputSchema, ...(applicationTools ? { applicationTools: true } : {}),
      instructionArguments,
      execution: { ownerId: entry.id, sessionId: ctx.sessionId }
    };
  }

  async function configureTerminal(entry, ctx) {
    const guidanceEnvironment = await sessionGuidanceEnvironment(entry);
    const external = await providerConnections.claudeProviderSettings(ctx.selection.modelProviderId);
    const configuration = claudeModelConfiguration({ providerId: ctx.selection.modelProviderId, model: ctx.selection.modelId }, external);
    return {
      get systemPrompt() { return vibe64ConversationInstructions({ workdir: ctx.workdir, promptContext: sessionGuidance(entry) }); },
      get model() { return configuration.model; },
      get effort() { return ctx.selection.variantId; },
      get settings() { return claudeFlagSettings(); },
      permissionMode: "bypassPermissions",
      get env() { return { ...guidanceEnvironment, ...configuration.env }; }
    };
  }

  function createTerminalAccess(conversations, recordGitActor) {
    return Object.freeze({
      async startTerminal(context, input = {}) {
        const entry = await conversations.acquire(context);
        await conversations.stopForTerminal(entry, {
          get sessionClosing() { return sessionIsClosing(entry.context.session); }
        });
        const ctx = entry.context;
        let prepared = { env: {}, shimDirs: [] };
        if (codexGitCommand) {
          prepared = await prepareSessionEnvironment(ctx);
        }
        const actor = await recordGitActor({ env, overwrite: true, reason: "agent-terminal", runtime: ctx.runtime,
          session: ctx.session, sourceRoot: ctx.workdir, threadId: entry.id, vibe64User: ctx.vibe64User, workdir: ctx.workdir });
        if (actor?.ok === false) throw error(actor.error, actor.code);
        const terminal = await conversations.prepareTerminal(entry, ctx);
        return commandRunner({ actor: "app", command,
          args: terminal.args,
          baseEnv: { ...env, ...prepared.env, ...terminal.env }, credentialHome, inheritProcessEnv: false, cwd: ctx.workdir,
          allowedRoots: [ctx.workdir], envPolicy: "auth", purpose: "assistant", mode: "pty",
          shimDirs: withGenesisCommandShim(prepared.shimDirs), runtimes: ["operator-clis", "node26"], session: ctx.session,
          terminal: { namespace: claudeTerminalNamespace(ctx.sessionId), maxRunning: 1, reuseRunning: true,
            commandPreview: "claude", metadata: { engineId: ENGINE, sessionId: ctx.sessionId }, ...input.size } });
      },
      readTerminal(context, input) { return readTerminalSession(input.terminalSessionId, { namespace: claudeTerminalNamespace(context.sessionId) }); },
      closeTerminal(context, input) { return closeTerminalSession(input.terminalSessionId, { namespace: claudeTerminalNamespace(context.sessionId) }); },
      resizeTerminal(context, input) { return resizeTerminalSession(input.terminalSessionId, input.size, { namespace: claudeTerminalNamespace(context.sessionId) }); },
      subscribeTerminal(context, input) { return subscribeTerminalSession(input.terminalSessionId, input.subscriber, { namespace: claudeTerminalNamespace(context.sessionId) }); },
      writeTerminal(context, input) { return writeTerminalSessionText(input.terminalSessionId, input.data, { namespace: claudeTerminalNamespace(context.sessionId) }); },
    });
  }

  return { prepareConfiguration, prepareProcess, configureProcess, configureTerminal, createTerminalAccess };
}

export { createClaudeConversationEnvironment };
