// The type of the `vibe64.terminals` capability, for features that require it,
// and the types several of the package's files share.

/** @typedef {ReturnType<typeof import("./service.js").createService>} TerminalsService */

/** @typedef {ReturnType<typeof import("./agent/sessionAgentManagerState.js").createSessionAgentManagerState>} SessionAgentManagerState */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentBindings.js").createSessionAgentBindings>} SessionAgentBindings */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentAccess.js").createSessionAgentAccess>} SessionAgentAccess */
/** @typedef {ReturnType<typeof import("./agent/sessionAgentConversationOperations.js").createSessionAgentConversationOperations>} SessionAgentConversationOperations */
/** @typedef {ReturnType<typeof import("@jskit-ai/assistant-core/server/conversation").createConversationRuntime>} ConversationRuntime */
/** @typedef {ReturnType<typeof import("./sessionAttachments.js").createSessionAttachments>} SessionAttachments */
/** @typedef {ReturnType<typeof import("./serviceSessionWork.js").createServiceSessionWork>} ServiceSessionWork */
/** @typedef {ReturnType<typeof import("./projectServices.js").createProjectServices>} ProjectServices */
/** @typedef {ReturnType<typeof import("./codexGitCommand.js").createCodexGitCommandService>} CodexGitCommandService */
/** @typedef {ReturnType<typeof import("./agentDatabaseCommand.js").createAgentDatabaseCommandService>} AgentDatabaseCommandService */
/** @typedef {ReturnType<typeof import("./agentEnvCommand.js").createAgentEnvCommandService>} AgentEnvCommandService */
/** @typedef {ReturnType<typeof import("./agentPagesCommand.js").createAgentPagesCommandService>} AgentPagesCommandService */
/**
 * A host's staging Env for the agent Env command (vibe64.terminals.staging-environment).
 * @typedef {object} StagingEnvironmentProvider
 * @property {(record: object | null) => boolean} isUserValueRecord
 * @property {(input: { projectSlug: string }) => Promise<object>} readRecords
 * @property {(input: { actor: object | null, projectSlug: string }) => Promise<object>} readStagingStatus the
 *   project's Staging status for its coding assistant, never a value: { ok, staging: { state, addresses, release,
 *   latestStagingPublish, records, blockers, notes, aiAccess: { enabled, reason } } } (agentStagingStatus.js), where
 *   aiAccess says whether the actor's session may use staging itself
 * @property {(input: StagingAccess & { keys: string[] }) => Promise<object>} readStagingValues the Env the
 *   staging release runs with, secrets included, when the host allows the session: { ok, releaseId, variables:
 *   [{ key, value }] }, only the named keys when keys is not empty; otherwise { ok: false, code, error }
 * @property {(input: StagingAccess & { command: string }) => Promise<object>} openStagingSsh the ssh
 *   configuration file whose `Host staging` logs in to the staging release, when the host allows the session:
 *   { ok, configPath }; command is the ssh, scp or sftp command line, for the host's record
 * @property {(input: { actor: object | null, key: string, projectSlug: string }) => Promise<object>} removeVariable
 * @property {(input: { actor: object | null, key: string, projectSlug: string, secret: boolean, value: string }) => Promise<object>} setVariable
 */
/**
 * A host's Production Env for the agent Env command (vibe64.terminals.production-environment): the settings its Deploy
 * to production gives the project's app. The command writes it and lists it by name; no value ever comes back, and a
 * change reaches Production only when the person deploys. The host refuses a change from a person who may not deploy.
 * @typedef {object} ProductionEnvironmentProvider
 * @property {(input: { actor: object | null, projectSlug: string }) => Promise<object>} readRecords { ok, records:
 *   [{ key, secret, services, valuePresent, change, editable, owner, source }] }, never a value
 * @property {(input: { actor: object | null, key: string, projectSlug: string, sessionId: string }) => Promise<object>} removeVariable
 * @property {(input: { actor: object | null, key: string, projectSlug: string, secret: boolean, services: string[] | null,
 *   sessionId: string, value: string }) => Promise<object>} setVariable services null keeps an entry's own, or gives a new
 *   one to the public service
 */
/**
 * Who asks a host for its staging: the person whose request prepared the session's agent, the project the
 * session is bound to, and the session.
 * @typedef {{ actor: object | null, projectSlug: string, sessionId: string }} StagingAccess
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
/**
 * What a call of the host's service control names: the session's own project and session (never ones its caller
 * chose), the session's source, the person whose request the AI works on, that request's turn while it works, whether
 * it is for the project's development or its Staging, and a signal that aborts when the caller goes away.
 * @typedef {{ projectSlug: string, sessionId: string, sourceRoot: string, actor: object | null, turnId: string,
 *   target: "development" | "staging", signal: AbortSignal }} ServiceControlRequest
 */
/**
 * One server the host runs for the project: its id (what the commands name), what it is, its state, whether every
 * project on the workspace shares it (a database server), and a short note.
 * @typedef {{ id: string, label: string, state: string, shared?: boolean, detail?: string }} ServiceControlService
 */
/**
 * A connection on one of the session's databases: its id, database, user, how long it has been in its state, that state
 * with what it waits on, and the start of its statement.
 * @typedef {{ id: number, database: string, user: string, seconds: number, state: string, query: string }} ServiceControlConnection
 */
/**
 * A composed host's control of the servers it runs for a project (vibe64.terminals.service-control,
 * serviceControl.js), which vibe64-helper services calls for the session's AI. Each acts only on a service or database
 * of the request's project, throws an Error whose message the AI reads when it refuses, never returns a password, and
 * records each restart, stop, start and ended connection with the session, the service and the time where the host's
 * people see it.
 * @typedef {object} ServiceControl
 * @property {(request: ServiceControlRequest) => Promise<{ services: ServiceControlService[], note?: string }>} listServices
 * @property {(request: ServiceControlRequest & { serviceId: string, lines: number }) =>
 *   Promise<{ service: ServiceControlService, state: string, source?: string, lines: string[] }>} readServiceLogs
 *   the service's last `lines` log lines, newest first, and where they come from
 * @property {(request: ServiceControlRequest & { serviceId: string, action: "restart" | "stop" | "start",
 *   needHelp?: { raised: boolean, id?: string } }) =>
 *   Promise<{ service: ServiceControlService, outcome: string, message: string, ok?: boolean }>} controlService
 *   `ok: false` when the service was left as it was, with why in `message`; a shared server's restart or stop is
 *   refused unless `needHelp.raised`
 * @property {(request: ServiceControlRequest & { serviceId?: string }) => Promise<{ service: ServiceControlService,
 *   running: boolean, connections: ServiceControlConnection[] }>} listDatabaseSessions the connections on the session's
 *   databases on its database server (`serviceId`, or its only one); none, `running: false`, when it is not running
 * @property {(request: ServiceControlRequest & { serviceId?: string }) => Promise<{ service: ServiceControlService,
 *   running: boolean, waits: { waiting: ServiceControlConnection, blockers: (ServiceControlConnection & { lock: string })[],
 *   elsewhere: number }[] }>} listDatabaseLocks each of those connections that waits, the ones of them it waits on, and
 *   how many blockers are on another project's database
 * @property {(request: ServiceControlRequest & { serviceId?: string, connectionId: number }) =>
 *   Promise<{ service: ServiceControlService, connection: { id: number, database: string }, outcome: string,
 *   message: string, ok?: boolean }>} endDatabaseConnection ends one of those connections, refusing any other
 */
/**
 * A composed host's own vibe64-helper group (vibe64.terminals.helper-command-groups, helperCommandGroups.js), run as
 * `vibe64-helper <name> [arguments]` after the session control's identity, the session's binding and refuseUnreadFields.
 * @typedef {object} HelperCommandGroup
 * @property {string} name a-z, 0-9 and -, starting with a letter, at most 24 characters; never one of vibe64-helper's own
 * @property {string} summary one line of at most 100 characters, which vibe64-helper --help lists after its own groups
 * @property {string} help what `vibe64-helper <name> --help` (or -h) prints, without reaching the host; at most 16 KiB
 * @property {(request: HelperCommandRequest, output: HelperCommandOutput) => Promise<HelperCommandAnswer>} run
 */
/**
 * One call of a host's group: the session, the project it is bound to, the person whose request the agent works on,
 * that request's turn while it works (else ""), the caller's words after the group's name, the caller's folder (in
 * the session's source or its temporary folder), the session's source, and a signal that aborts when the caller goes
 * away (SIGINT, SIGTERM, hangup, its job stopped) or the session closes.
 * @typedef {{ sessionId: string, projectSlug: string, actor: object | null, turnId: string, args: string[], cwd: string,
 *   sourceRoot: string, signal: AbortSignal }} HelperCommandRequest
 */
/**
 * The caller's output, which reaches it as it is written.
 * @typedef {{ stdout: (chunk: string | Uint8Array) => void, stderr: (chunk: string | Uint8Array) => void }} HelperCommandOutput
 */
/**
 * The group's answer: the caller's exit status (0 to 255). The caller never runs a command of its own; a host whose
 * work needs a process runs it through its own managed execution.
 * @typedef {{ exit: number }} HelperCommandAnswer
 */
/** @typedef {ReturnType<typeof import("./agentSessionCommand.js").createAgentSessionCommandService>} AgentSessionCommandService */
/** @typedef {ReturnType<typeof import("./needHelp/needHelpService.js").createNeedHelpService>} NeedHelpService */
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
/** @typedef {ReturnType<typeof import("./assistantRoutingAdmission.js").createAssistantRoutingAdmission>} AssistantRoutingAdmission */
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
/** @typedef {ReturnType<typeof import("./writesWhileAssistantWorks.js").createWritesWhileAssistantWorks>} WritesWhileAssistantWorks */
/** @typedef {ServiceState["trackShutdownWork"]} TrackShutdownWork */
/** @typedef {ReturnType<typeof import("./turnInterruptions.js").createServerRun>} ServerRun */
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
