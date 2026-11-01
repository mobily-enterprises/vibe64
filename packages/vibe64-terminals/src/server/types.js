// The type of the `vibe64.terminals` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} TerminalsService */

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManagerState.js").createSessionAgentManagerState>} SessionAgentManagerState */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentBindings.js").createSessionAgentBindings>} SessionAgentBindings */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentAccess.js").createSessionAgentAccess>} SessionAgentAccess */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentConversationOperations.js").createSessionAgentConversationOperations>} SessionAgentConversationOperations */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationRuntime>} ConversationRuntime */
/** @typedef {ReturnType<typeof import("./sessionAttachments.js").createSessionAttachments>} SessionAttachments */
/** @typedef {ReturnType<typeof import("./projectServices.js").createProjectServices>} ProjectServices */
/** @typedef {ReturnType<typeof import("./codexGitCommand.js").createCodexGitCommandService>} CodexGitCommandService */
/** @typedef {ReturnType<typeof import("./agentDatabaseCommand.js").createAgentDatabaseCommandService>} AgentDatabaseCommandService */
/** @typedef {ReturnType<typeof import("./agentEnvCommand.js").createAgentEnvCommandService>} AgentEnvCommandService */
/** @typedef {ReturnType<typeof import("./agentSessionCommand.js").createAgentSessionCommandService>} AgentSessionCommandService */
/** @typedef {ReturnType<typeof import("./agentPreviewCommand.js").createAgentPreviewCommandService>} AgentPreviewCommandService */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/codex-turn").createCodexAppServerRunOwner>} CodexAppServerRunOwner */
/** @typedef {ReturnType<typeof import("./codexConversationPreparation.js").createCodexConversationPreparation>} CodexConversationPreparation */
/** @typedef {ReturnType<typeof import("./sessionTurnCheckpoint.js").createCodexSessionTurnCheckpoint>} CodexSessionTurnCheckpoint */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/opencode-process").createOpenCodeSharedRuntime>} OpenCodeSharedRuntime */
/** @typedef {ReturnType<typeof import("./opencodeServerProcess.js").createOpenCodeHostPreparation>} OpenCodeHostPreparation */
/** @typedef {ReturnType<typeof import("./mainConversationBinding.js").createOpenCodeMainMessagePreparation>} OpenCodeMainMessagePreparation */
/** @typedef {ReturnType<typeof import("./agentPreviewCommandState.js").createAgentPreviewCommandState>} AgentPreviewCommandState */
/** @typedef {ReturnType<typeof import("./agentPreviewWorkerRegistry.js").createAgentPreviewWorkerRegistry>} AgentPreviewWorkerRegistry */
/** @typedef {ReturnType<typeof import("./outputTargetTerminal.js").createOutputTargetTerminalController>} OutputTargetTerminalController */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentManager.js").createSessionAgentManager>} SessionAgentManager */
/** @typedef {ReturnType<typeof import("./assistantRoutingState.js").createAssistantRoutingState>} AssistantRoutingState */
/** @typedef {ReturnType<typeof import("./assistantRoutingRecords.js").createAssistantRoutingRecords>} AssistantRoutingRecords */
/** @typedef {ReturnType<typeof import("./assistantRoutingDecisions.js").createAssistantRoutingDecisions>} AssistantRoutingDecisions */
/** @typedef {ReturnType<typeof import("./assistantRoutingDelivery.js").createAssistantRoutingDelivery>} AssistantRoutingDelivery */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/claude-turn").createClaudeConversationOwner>} ClaudeConversationOwner */
/** @typedef {ReturnType<typeof import("./codexRuntimeHost.js").createCodexRuntimeHost>} CodexRuntimeHost */
/** @typedef {ReturnType<typeof import("./codexRuntimeHost.js").createCodexSessionRuntimeHost>} CodexSessionRuntimeHost */
/** @typedef {ReturnType<typeof import("./codexAccountPreparation.js").createCodexAccountPreparation>} CodexAccountPreparation */
/** @typedef {ReturnType<typeof import("./codexSessionEnvironment.js").createCodexSessionEnvironment>} CodexSessionEnvironment */
/** @typedef {ReturnType<typeof import("./codexStartupHealth.js").createCodexStartupHealth>} CodexStartupHealth */
/** @typedef {ReturnType<typeof import("./codexStartupHealth.js").createCodexUnavailableWorktreeHandler>} CodexUnavailableWorktreeHandler */
/** @typedef {ReturnType<typeof import("./codexHelperPreparation.js").createCodexHelperPreparation>} CodexHelperPreparation */
/** @typedef {ReturnType<typeof import("./openCodeConversationEvents.js").createOpenCodeConversationEvents>} OpenCodeConversationEvents */
/** @typedef {ReturnType<typeof import("./openCodeConversationPresentation.js").createOpenCodeConversationPresentation>} OpenCodeConversationPresentation */
/** @typedef {OpenCodeMainMessagePreparation["contextFor"]} OpenCodeMainMessagePreparationContextFor */
/** @typedef {ReturnType<typeof import("./outputTargetTerminalState.js").createOutputTargetTerminalState>} OutputTargetTerminalState */
/** @typedef {ReturnType<typeof import("./outputTargetLaunchCoordination.js").createOutputTargetLaunchCoordination>} OutputTargetLaunchCoordination */
/** @typedef {ProjectServices["ensure"]} ProjectServicesEnsure */
/** @typedef {ReturnType<typeof import("./promptHintState.js").createPromptHintState>} PromptHintState */
/** @typedef {ReturnType<typeof import("./promptHintContext.js").createPromptHintContext>} PromptHintContext */
/** @typedef {ReturnType<typeof import("./serviceGoals.js").createServiceGoals>} ServiceGoals */
/** @typedef {ReturnType<typeof import("./serviceAssistant.js").createServiceAssistant>} ServiceAssistant */
/** @typedef {ReturnType<typeof import("./events.js").createProjectRuntimeChangedPublisher>} ProjectRuntimeChangedPublisher */
/** @typedef {ReturnType<typeof import("./events.js").createTerminalSessionChangedPublishers>} TerminalSessionChangedPublishers */
/** @typedef {ReturnType<typeof import("./serviceSessionAccess.js").createServiceSessionAccess>} ServiceSessionAccess */
/** @typedef {ReturnType<typeof import("./serviceAssistantContext.js").createServiceAssistantContext>} ServiceAssistantContext */
/** @typedef {ReturnType<typeof import("./workspaceSetup.js").createWorkspaceSetupRunner>} WorkspaceSetupRunner */
/** @typedef {ReturnType<typeof import("./sessionConversations.js").createSessionConversations>} SessionConversations */
/** @typedef {ReturnType<typeof import("./serviceState.js").createServiceState>} ServiceState */
/** @typedef {ReturnType<typeof import("./sessionNaming.js").createSessionNaming>} SessionNaming */
/** @typedef {ReturnType<typeof import("./sessionPromptHints.js").createSessionPromptHintsService>} SessionPromptHintsService */
/** @typedef {ReturnType<typeof import("./assistantRouting.js").createAssistantRouting>} AssistantRouting */
/** @typedef {ReturnType<typeof import("./serviceWorkspacePreparation.js").createServiceWorkspacePreparation>} ServiceWorkspacePreparation */
/** @typedef {ReturnType<typeof import("./serviceAssistantPreparation.js").createServiceAssistantPreparation>} ServiceAssistantPreparation */
/** @typedef {ReturnType<typeof import("./codexSessionRegistration.js").createCodexSessionRegistration>} CodexSessionRegistration */
/** @typedef {ReturnType<typeof import("./temporaryConversationRecords.js").createTemporaryConversationRecords>} TemporaryConversationRecords */
/** @typedef {ReturnType<typeof import("./temporaryConversationTurns.js").createTemporaryConversationTurns>} TemporaryConversationTurns */
/** @typedef {ReturnType<typeof import("./workspaceSetupRunnerState.js").createWorkspaceSetupRunnerState>} WorkspaceSetupRunnerState */
/** @typedef {ReturnType<typeof import("./workspaceSetupExecution.js").createWorkspaceSetupExecution>} WorkspaceSetupExecution */

export {};
