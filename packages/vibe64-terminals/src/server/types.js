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
/**
 * A host's production Env for the agent Env command (vibe64.terminals.production-environment).
 * @typedef {object} ProductionEnvironmentProvider
 * @property {(record: object | null) => boolean} isUserValueRecord
 * @property {(input: { projectSlug: string }) => Promise<object>} readRecords
 * @property {(input: { projectSlug: string }) => Promise<object>} readDeployment the project's deployment
 *   for its coding assistant, never a value: { ok, deployment: { state, addresses, release, latestDeploy,
 *   records, blockers, notes } } (agentDeploymentStatus.js)
 * @property {(input: { key: string, projectSlug: string }) => Promise<object>} removeVariable
 * @property {(input: { key: string, projectSlug: string, secret: boolean, value: string }) => Promise<object>} setVariable
 */
/**
 * A host's saved values the agent Env command lists, links and unlinks
 * (vibe64.terminals.saved-env-value-links), shown by its own label.
 * @typedef {object} SavedEnvValueLinks
 * @property {string} label
 * @property {(request: { actor: object | null, projectSlug: string, sessionId: string }) => Promise<object>} list
 * @property {(request: { actor: object | null, entryId: string, environment: string, fieldId: string, key: string, projectSlug: string, sessionId: string }) => Promise<object>} link
 * @property {(request: { actor: object | null, environment: string, key: string, projectSlug: string, sessionId: string }) => Promise<object>} unlink
 */
/** @typedef {ReturnType<typeof import("./agentSessionCommand.js").createAgentSessionCommandService>} AgentSessionCommandService */
/** @typedef {ReturnType<typeof import("./agentPreviewCommand.js").createAgentPreviewCommandService>} AgentPreviewCommandService */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/codex-turn").createCodexAppServerRunOwner>} CodexAppServerRunOwner */
/** @typedef {ReturnType<typeof import("./codexConversationPreparation.js").createCodexConversationPreparation>} CodexConversationPreparation */
/** @typedef {ReturnType<typeof import("./sessionTurnCheckpoint.js").createCodexSessionTurnCheckpoint>} CodexSessionTurnCheckpoint */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/opencode-process").createOpenCodeSharedRuntime>} OpenCodeSharedRuntime */
/** @typedef {ReturnType<typeof import("./openCodeHostPreparation.js").createOpenCodeHostPreparation>} OpenCodeHostPreparation */
/** @typedef {ReturnType<typeof import("./mainConversationMessages.js").createOpenCodeMainMessagePreparation>} OpenCodeMainMessagePreparation */
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
/** @typedef {ReturnType<typeof import("./events.js").createConversationTurnPublishers>} ConversationTurnPublishers */
/** @typedef {ReturnType<typeof import("./serviceSessionAccess.js").createServiceSessionAccess>} ServiceSessionAccess */
/** @typedef {ReturnType<typeof import("./serviceAssistantContext.js").createServiceAssistantContext>} ServiceAssistantContext */
/** @typedef {ReturnType<typeof import("./workspaceSetup.js").createWorkspaceSetupRunner>} WorkspaceSetupRunner */
/** @typedef {ReturnType<typeof import("./sessionConversations.js").createSessionConversations>} SessionConversations */
/**
 * The assistant runtime a composing host configures (configureAssistantRuntime); serviceState holds its defaults.
 * @typedef {object} AssistantRuntime
 * @property {(context?: object) => Promise<boolean>} claudeConnectionStatus
 * @property {(context?: object) => Promise<boolean>} codexConnectionStatus
 * @property {(request?: object) => Promise<object[]>} listConnections
 * @property {(context?: object) => Promise<{ ownerOnly: boolean }>} readAssistantAccess
 * @property {(user?: object | null) => Promise<object | null>} resolveAssistantUser
 * @property {(actor: object) => object} createActionContext
 * @property {(actor: object, projectSlug?: string) => Promise<object>} authorizeProjectMessage
 * @property {(selection?: object) => Promise<object | null>} resolveConnection
 * @property {((request: object) => Promise<object>) | null} updateModelAccess
 */
/** @typedef {AssistantRuntime["listConnections"]} ListAssistantConnections */
/** @typedef {AssistantRuntime["resolveConnection"]} ResolveAssistantConnection */
/** @typedef {AssistantRuntime["readAssistantAccess"]} ReadAssistantAccess */
/** @typedef {AssistantRuntime["resolveAssistantUser"]} ResolveAssistantUser */
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

/** @typedef {ReturnType<typeof import("./agent/providers/codexSessionAgentProvider.js").createCodexSessionAgentProvider>} CodexSessionAgentProvider */
/** @typedef {ReturnType<typeof import("./agent/providers/opencodeSessionAgentProvider.js").createOpenCodeSessionAgentProvider>} OpenCodeSessionAgentProvider */
/** @typedef {ReturnType<typeof import("./agent/providers/claudeConversationHost.js").createClaudeConversationHost>} ClaudeSessionAgentProvider */
/**
 * The session agent provider contract: one provider per engine.
 * @typedef {CodexSessionAgentProvider | OpenCodeSessionAgentProvider | ClaudeSessionAgentProvider} SessionAgentProvider
 */
/**
 * The provider methods the session agent manager dispatches by name.
 * @typedef {"closeProject" | "closeSession" | "closeTerminal" | "createConversation" | "deleteAttachment" | "deleteConversation"
 *   | "deleteDetachedChatThread" | "ensureSession" | "generateSessionRenewalHandover" | "hasActiveTemporaryConversation"
 *   | "inspectMessageAdmission" | "interruptDetachedChatTurn" | "interruptTurn" | "invalidateRuntimes" | "beginShutdown"
 *   | "listNativeConversationStorage" | "readConversation" | "readGoal" | "readTerminal" | "reconcileSessions"
 *   | "releaseRenewalPredecessorAttachments" | "releaseRenewalPredecessorProcessExitProof"
 *   | "releaseRenewalSuccessorProcessExitProof" | "resizeTerminal" | "resolveExecutionProfile" | "retireConversationHistory"
 *   | "runDetachedChatTurn" | "seedSessionRenewalHandover" | "sendMessage" | "sessionState" | "startConversationTurn"
 *   | "startTerminal" | "stopConversation" | "streamDetachedChatTurn" | "subscribeTerminal"
 *   | "updateGoal" | "updateSessionSettings" | "uploadAttachment" | "waitForConversationTurn" | "writeTerminal"} SessionAgentProviderMethod
 */
/** @typedef {ReturnType<typeof import("./openCodeLifecyclePreparation.js").createOpenCodeLifecyclePreparation>} OpenCodeLifecyclePreparation */
/** @typedef {typeof import("./sessionGitCommandActor.js").recordSessionGitCommandActor} RecordSessionGitCommandActor */
/** @typedef {typeof import("./opencodeServerProcess.js").createOpenCodeServerProcess} CreateOpenCodeServerProcess */
/** @typedef {ServiceSessionAccess["runMainAgentWrite"]} RunMainAgentWrite */
/** @typedef {ServiceAssistantPreparation["prepareAgentSkillsInsideAgentWrite"]} PrepareAgentSkills */
/** @typedef {SessionAgentManager["prepareSelection"]} PrepareAssistantSelection */
/** @typedef {ConversationRuntime["publishNative"]} PublishNativeConversation */
/** @typedef {(sessionId: string, options?: object) => Promise<object>} ReadSessionContext the session context the temporary chats read */

/** @typedef {ReturnType<typeof import("./serviceTurnPublication.js").createServiceTurnPublication>} ServiceTurnPublication */
/** @typedef {ServiceTurnPublication["publishAgentSessionChanged"]} PublishAgentSessionChanged */
/** @typedef {ReturnType<typeof import("./serviceCommandServices.js").createServiceCommandServices>} ServiceCommandServices */
/** @typedef {ReturnType<typeof import("./serviceMainConversationHost.js").createServiceMainConversationHost>} ServiceMainConversationHost */
/** @typedef {ReturnType<typeof import("./providerUsage.js").createProviderUsage>} ProviderUsage */
/** @typedef {ReturnType<typeof import("./previewDiagnostics.js").createPreviewDiagnosticRecorder>} PreviewDiagnosticRecorder */
/** @typedef {ReturnType<typeof import("./openCodeSessionRegistration.js").createOpenCodeSessionRegistration>} OpenCodeSessionRegistration */
/** @typedef {ReturnType<typeof import("@local/studio-terminal-core/server/codexRuntimeContext").codexRuntimeContext>["providerOptions"]} CodexAppServerProviderOptions */
/** @typedef {() => ReturnType<typeof import("@local/studio-terminal-core/server/claudeRuntime").readClaudeCodeAuthStatus>} ReadClaudeAccountStatus */
/** @typedef {ReturnType<typeof import("@local/vibe64-core/server/assistantRoutingStore").createAssistantRoutingStore>["read"]} ReadRoutingConfiguration */
/** @typedef {typeof import("@local/vibe64-genesis/server").inspectGenesisSkills} InspectAgentSkills */
/** @typedef {typeof import("@local/vibe64-execution/server").runVibe64Command} RunVibe64Command */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64Execution} StopVibe64Execution */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64OwnedExecutions} StopVibe64OwnedExecutions */
/** @typedef {typeof import("@local/vibe64-execution/server").stopVibe64RestoredService} StopVibe64RestoredService */
/** @typedef {typeof import("./agentCommandEnvironment.js").prepareAgentSessionCommandEnvironment} PrepareAgentSessionCommandEnvironment */
/** @typedef {typeof import("./opencodeServerProcess.js").createOpenCodeServerProcess} CreateOpenCodeServerProcess */
/** @typedef {typeof import("./sessionGitCommandActor.js").recordSessionGitCommandActor} RecordSessionGitCommandActor */
/** @typedef {ServiceGoals["continueGoalAfterAccountChange"]} ContinueGoalAfterAccountChange */

export {};
