import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
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

// Interactive Claude asks first-run setup (including a login choice) and
// whether to trust the folder until its settings record both. Headless chat
// never records them, so a signed-in session would otherwise open the terminal
// at those prompts instead of the conversation. Vibe64 already admitted the
// session's folder, so the terminal records the same decisions.
async function markClaudeTerminalReady(env, credentialHome, workdir) {
  const file = env?.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, ".claude.json")
    : path.join(credentialHome.home, ".claude.json");
  let settings = {};
  try {
    settings = JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    if (cause.code !== "ENOENT") throw cause;
  }
  const folders = [...new Set([path.resolve(workdir), await realpath(workdir).catch(() => path.resolve(workdir))])];
  const projects = settings.projects || {};
  if (settings.hasCompletedOnboarding === true &&
      folders.every(folder => projects[folder]?.hasTrustDialogAccepted === true)) return;
  for (const folder of folders) projects[folder] = { ...projects[folder], hasTrustDialogAccepted: true };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.vibe64-${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ ...settings, hasCompletedOnboarding: true, projects }, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

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
      ...(env?.VIBE64_HOST_AGENT_GUIDANCE ? { hostGuidance: env.VIBE64_HOST_AGENT_GUIDANCE } : {}),
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
    // Goal Set/Resume can prepare the native process before an authored turn.
    // Retain the same discovery protocol; execution still requires that turn's
    // admitted native tool identity and freshly authorized action catalogue.
    const schemas = entry.command?.tools?.schemas || (entry.main && !profile && !entry.context.assistantScope
      ? entry.context.applicationTools?.schemas : undefined);
    const applicationTools = Boolean(schemas);
    if (applicationTools) entry.toolSchemas = schemas;
    const identity = JSON.stringify(applicationTools
      ? [selection, profile, input.outputSchema, entry.accountIdentity, entry.toolSchemas]
      : [selection, profile, input.outputSchema, entry.accountIdentity]);
    // A source-less learning root has no project guidance to read.
    const learningRoot = await learningSessionExecutionRoot(entry.context.runtime, entry.context.sessionId);
    let systemPrompt = entry.context.assistantScope?.stableContext || (profile
      ? "Complete only the supplied task."
      : learningRoot ? ""
      : await vibe64ConversationInstructions({ workdir: entry.context.workdir, promptContext: sessionGuidance(entry) }));
    if (applicationTools && entry.main && !entry.context.runtime.learningScope && !profile && !entry.context.assistantScope) {
      systemPrompt += "\n\nYou cannot create a goal through Claude's application tools. When the human asks you to create or set a goal, explain that they need to use the chat UI: choose Set goal, enter the objective, then choose Start goal. Offer a concise objective they can paste. If an unfinished goal already exists, explain Resume goal for continuing it or Cancel goal before setting a different one. Do not claim that stating an objective creates a goal.";
      systemPrompt += "\n\nWhen the human explicitly asks to pause the goal, finish any requested checkpoint and drain delegated work, then use the application action vibe64.terminals.main-goal.pause through the application tools. Saying paused does not pause the goal. Do not invoke Pause merely because work is unfinished, delegated work is running, or prerequisites are missing. When a concrete external prerequisite prevents all useful work, use vibe64.terminals.main-goal.block with a short reason explaining what must change before Resume. Do not mark a goal blocked while delegated/background agents or checks are still working; wait for their results. Do not repeatedly answer that you are waiting for missing human input.";
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
      // The terminal opens in Vibe64's bypass mode; skip Claude's warning for it.
      get settings() { return { ...claudeFlagSettings(), skipDangerousModePermissionPrompt: true }; },
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
        await markClaudeTerminalReady(env, credentialHome, ctx.workdir);
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
