// The app's client types: the values its composables, client factories and components hand to one another
// across files, each named once. First the composables' results, then the client factories'.

/** @typedef {ReturnType<typeof import("./composables/useAiTaskConversation.js").useAiTaskConversation>} AiTaskConversation */
/** @typedef {ReturnType<typeof import("./composables/useAiTaskConversationSaves.js").useAiTaskConversationSaves>} AiTaskConversationSaves */
/** @typedef {ReturnType<typeof import("./composables/useCodexTerminalOutput.js").useCodexTerminalOutput>} CodexTerminalOutput */
/** @typedef {ReturnType<typeof import("./composables/useVibe64CodexCommands.js").useVibe64CodexCommands>} Vibe64CodexCommands */
/** @typedef {NonNullable<ReturnType<typeof import("./composables/useVibe64ConversationRuntime.js").useVibe64ConversationRuntime>["value"]>} Vibe64ConversationRuntime */
/** @typedef {ReturnType<typeof import("./composables/useVibe64FileAreaBrowser.js").useVibe64FileAreaBrowser>} Vibe64FileAreaBrowser */
/** @typedef {ReturnType<typeof import("./composables/useVibe64FileAreaFocus.js").useVibe64FileAreaFocus>} Vibe64FileAreaFocus */
/** @typedef {ReturnType<typeof import("./composables/useVibe64LearningCourses.js").useVibe64LearningCourses>} Vibe64LearningCourses */
/** @typedef {import("vue").UnwrapNestedRefs<ReturnType<typeof import("./composables/useVibe64MainChatApprovals.js").useVibe64MainChatApprovals>>} Vibe64MainChatApprovals */
/** @typedef {ReturnType<typeof import("./composables/useVibe64OutputControls.js").useVibe64OutputControls>} Vibe64OutputControls */
/** @typedef {ReturnType<typeof import("./composables/useVibe64OutputLaunch.js").useVibe64OutputLaunch>} Vibe64OutputLaunch */
/** @typedef {ReturnType<typeof import("./composables/useVibe64OutputStatus.js").useVibe64OutputStatus>} Vibe64OutputStatus */
/** @typedef {ReturnType<typeof import("./composables/useVibe64OutputTerminal.js").useVibe64OutputTerminal>} Vibe64OutputTerminal */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewAddress.js").useVibe64PreviewAddress>} Vibe64PreviewAddress */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewFrame.js").useVibe64PreviewFrame>} Vibe64PreviewFrame */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewIdentity.js").useVibe64PreviewIdentity>} Vibe64PreviewIdentity */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewPick.js").useVibe64PreviewPick>} Vibe64PreviewPick */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewRecovery.js").useVibe64PreviewRecovery>} Vibe64PreviewRecovery */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewReload.js").useVibe64PreviewReload>} Vibe64PreviewReload */
/** @typedef {ReturnType<typeof import("./composables/useVibe64PreviewTargets.js").useVibe64PreviewTargets>} Vibe64PreviewTargets */
/** @typedef {ReturnType<typeof import("./composables/useVibe64SessionDialogs.js").useVibe64SessionDialogs>} Vibe64SessionDialogs */
/** @typedef {ReturnType<typeof import("./composables/useVibe64SessionRenewal.js").useVibe64SessionRenewal>} Vibe64SessionRenewal */
/** @typedef {ReturnType<typeof import("./composables/useVibe64SourceEditor.js").useVibe64SourceEditor>} Vibe64SourceEditor */
/** @typedef {ReturnType<typeof import("./composables/useVibe64SourceEditorFile.js").useVibe64SourceEditorFile>} Vibe64SourceEditorFile */
/** @typedef {ReturnType<typeof import("./composables/useVibe64SourceEditorTree.js").useVibe64SourceEditorTree>} Vibe64SourceEditorTree */
/** @typedef {ReturnType<typeof import("./composables/useVibe64StarredFiles.js").useVibe64StarredFiles>} Vibe64StarredFiles */
/** @typedef {ReturnType<typeof import("./composables/useVibe64TemporaryAi.js").useVibe64TemporaryAi>} Vibe64TemporaryAi */
/** @typedef {ReturnType<typeof import("./composables/useVibe64TemporaryAiTaskRecords.js").useVibe64TemporaryAiTaskRecords>} Vibe64TemporaryAiTaskRecords */
/** @typedef {ReturnType<typeof import("./composables/useVibe64Terminal.js").useVibe64Terminal>} Vibe64Terminal */
/** @typedef {ReturnType<typeof import("./composables/useVibe64TerminalConnection.js").useVibe64TerminalConnection>} Vibe64TerminalConnection */
/** @typedef {ReturnType<typeof import("./composables/useVibe64TerminalDisplay.js").useVibe64TerminalDisplay>} Vibe64TerminalDisplay */
/** @typedef {ReturnType<typeof import("./composables/useVibe64Terminal.js").createVibe64TerminalState>} Vibe64TerminalState */

/** @typedef {ReturnType<typeof import("./lib/vibe64LessonPlayer.js").createLessonPlayer>} LessonPlayer */
/** @typedef {ReturnType<typeof import("./lib/vibe64PageActivity.js").createPageActivity>} PageActivity */
/** @typedef {ReturnType<typeof import("./lib/vibe64ColleagueModelBridge.js").createVibe64ColleagueModelBridge>} Vibe64ColleagueModelBridge */
/** @typedef {ReturnType<typeof import("./lib/vibe64Learning.js").createVibe64Learning>} Vibe64Learning */

export {};
