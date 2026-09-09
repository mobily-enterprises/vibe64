import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const composablePath = path.resolve("src/composables/useVibe64AutopilotView.js");
const promptTextareaPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue"
);
const promptHintsPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64PromptHints.vue"
);
const runtimeHostPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue");
const temporaryAiPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue"
);
const temporaryAiComposablePath = path.resolve("src/composables/useVibe64TemporaryAi.js");
const temporaryAiFixActionPath = path.resolve(
  "src/components/studio/Vibe64TemporaryAiFixAction.vue"
);

describe("Vibe64 direct session view", () => {
  it("uses one shared Fix it with AI control for every Temporary AI recovery launcher", () => {
    const autopilot = fs.readFileSync(componentPath, "utf8");
    const outputControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64OutputControls.vue"),
      "utf8"
    );
    const repository = fs.readFileSync(
      path.resolve("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      "utf8"
    );
    const fixAction = fs.readFileSync(temporaryAiFixActionPath, "utf8");

    expect(autopilot.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(2);
    expect(outputControls.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(1);
    expect(repository.match(/<Vibe64TemporaryAiFixAction/gu)).toHaveLength(1);
    expect([autopilot, outputControls, repository].join("\n")).not.toContain(
      "Fix with temporary AI"
    );
    expect(fixAction).toContain('aria-label="Fix it with AI"');
    expect(fixAction).toContain('{{ pending ? "Opening…" : "Fix it with AI" }}');
  });

  it("is chat-first and contains no workflow state-machine surface", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const retiredNames = [
      "AutopilotNavigation",
      "WorkflowControlForm",
      "SessionCurrentStep",
      "SessionTimeline",
      "ReportPreview",
      "SessionRecoveryNotice",
      "StepInputDisplayFields",
      "activateWorkflowButtonControl",
      "runNextOperation",
      "rewindToAutopilotStep"
    ];

    expect(component).toContain("<Vibe64ConversationLog");
    expect(component).toContain(':welcome-message="emptyConversationWelcome"');
    expect(component).toContain(':source-operations-suspended="sourceOperationsSuspended"');
    expect(component).not.toContain(':source-operations-suspended="sourceOperationsSuspended || agentActive"');
    expect(component).toContain(':busy="agentActive || Boolean(props.page?.busy || props.page?.launchBusy)"');
    expect(component).toContain("<Vibe64AutopilotPromptTextarea");
    for (const retiredName of retiredNames) {
      expect(component).not.toContain(retiredName);
      expect(composable).not.toContain(retiredName);
    }
  });

  it("offers native confirmed Save with temporary action output, not an AI prompt", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const combined = `${component}\n${composable}`;

    expect(composable).toContain("saveWorkActionLabel");
    expect(component).toContain('v-if="saveWorkHeaderVisible"');
    expect(component).toContain("saveWorkHeaderAriaLabel");
    expect(component).not.toContain("saveWorkHeaderLabel");
    expect(component).not.toContain("saveWorkTeleportTarget");
    expect(component).toContain(':aria-busy="saveWorkSending ? \'true\' : undefined"');
    expect(component).not.toContain(':loading="saveWorkSending"');
    expect(component).toContain(":icon=\"mdiIncognito\"");
    expect(component).toContain("saveWorkRequiresUpdate ? mdiSourcePull : mdiContentSaveOutline");
    expect(component).toContain("@click=\"confirmSaveWork\"");
    expect(component).toContain("<Vibe64TemporaryActionTerminal");
    expect(component.indexOf("<Vibe64TemporaryActionTerminal")).toBeLessThan(
      component.indexOf("<Vibe64ConversationLog")
    );
    expect(component).toContain('#error-actions');
    expect(component).toContain("saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'primary' : undefined)");
    expect(composable).toContain("const result = await props.saveSessionWork();");
    expect(composable).toContain("await props.updateSessionWork();");
    expect(composable).toContain("const saveWorkUnsaved = computed");
    expect(composable).toContain("const saveWorkOperationActive = computed");
    expect(component).toContain('class="studio-autopilot__activity"');
    expect(component).toContain(".studio-autopilot__activity:empty");
    expect(composable).toContain("Vibe64—not Temporary AI—owns every repository operation");
    expect(component).toContain(':disabled="repositoryRecoverySending || !assistantDirectAllowed"');
    expect(component).toContain(":title=\"assistantDirectAllowed ? 'Open temporary AI to resolve this repository problem' : assistantRestrictionMessage\"");
    expect(component).toContain(":title=\"assistantDirectAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantRestrictionMessage\"");
    expect(component).toContain("assistantDirectAllowed: assistantDirectAllowed.value");
    expect(component).toContain("assistantRestrictionMessage: assistantRestrictionMessage.value");
    expect(composable).toContain("Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase");
    expect(composable).toContain("leave both byte-for-byte unchanged");
    expect(composable).toContain("Resolve only by editing the conflicting working-tree files");
    expect(composable).toContain("Preserve the intended behavior of both the latest saved work and this session");
    expect(component).toContain('@click="requestSessionSaveWork"');
    expect(component).toContain('@check-update="checkTemporaryAiUpdate"');
    expect(component).toContain("temporaryAiWorkspace.value?.updateRepairTask");
    expect(component).toContain("{ force: true }");
    expect(component).toContain(':active="saveWorkOperationActive || saveWorkSending"');
    expect(component).toContain(':dismissed="saveWorkActivityDismissed"');
    expect(component).toContain(':operation-key="saveWorkActivityKey"');
    expect(component).toContain('@dismiss="dismissSaveWorkActivity"');
    expect(composable).toContain("SHORT_ACTION_DISMISSALS_STORAGE_PREFIX");
    expect(component).toContain('v-if="savedCommitDeslop"');
    expect(component).toMatch(/v-if="savedCommitDeslop"[\s\S]{0,160}color="surface-variant"/u);
    expect(component).toContain('@click="startSavedCommitDeslop"');
    expect(component).toContain('@click="dismissSavedCommitDeslop"');
    expect(composable).toContain('genesisTask: "deslop"');
    expect(composable).toContain('message: `Deslop commit ${saveCommit}.`');
    expect(composable).not.toContain("SAVE_WORK_PROMPT");
    expect(combined).not.toMatch(/runGit|executeGit|merge pr|finish session/iu);
    expect(component).toContain("sessionGithubActor.displayLabel");
    expect(component).toContain(":to=\"props.githubActorTeleportTarget\"");
    expect(composable).toContain("sessionGithubCommandActor(props.session || {})");
    expect(composable).toContain("sessionGithubActor.value.available");
    const sessionHeader = component.slice(
      component.indexOf('<header class="studio-autopilot__session-header">'),
      component.indexOf("</header>")
    );
    expect(sessionHeader).toContain("studio-autopilot__save-work");
    expect(sessionHeader).toContain(':icon="saveWorkRequiresUpdate ? mdiSourcePull : mdiContentSaveOutline"');
    expect(sessionHeader).toContain('height="48"');
    expect(sessionHeader).toContain('width="48"');
    expect(sessionHeader).not.toContain("studio-autopilot__save-work-label");
  });

  it("keeps temporary AI unmistakable, ephemeral, multi-task, and attachment-owned", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const temporaryAi = fs.readFileSync(temporaryAiPath, "utf8");
    const temporaryAiComposable = fs.readFileSync(temporaryAiComposablePath, "utf8");
    const temporaryAiFixAction = fs.readFileSync(temporaryAiFixActionPath, "utf8");

    expect(component).toContain("Open temporary AI");
    expect(component).toContain("<Vibe64TemporaryAiFixAction");
    expect(temporaryAiFixAction).toContain("Fix it with AI");
    expect(component).toContain("<Vibe64TemporaryAiWorkspace");
    expect(temporaryAi).toContain("grid-row: 3 / -1");
    expect(temporaryAi).not.toContain("position: sticky");
    expect(temporaryAi.indexOf("data-temporary-ai-check-update")).toBeLessThan(
      temporaryAi.indexOf('class="vibe64-temporary-ai__messages"')
    );
    expect(component).toContain("temporaryAiWorkspace.value?.showWorkspace?.()");
    // Switching sessions retains the temporary workspace; Main chat closes it.
    expect(component).not.toContain("activateRealSession");
    expect(component).toContain("@select-main-chat=\"showMainChat\"");
    expect(component).toContain("@task-finished=\"finishTemporaryAiTask\"");
    expect(component).toContain("reportTaskRecovery");
    expect(component).toContain("Workspace preparation succeeded. Vibe64 independently verified the AI repair.");
    expect(component).toContain("temporaryAiWorkspace.value?.closeWorkspace?.()");
    expect(component).toContain("mainChat.value?.focus?.({ preventScroll: true })");
    expect(temporaryAi).toContain("Main chat");
    expect(temporaryAi).toContain("data-temporary-ai-main-chat");
    expect(temporaryAi).toContain("Main and temporary conversations");
    expect(temporaryAi).toContain('aria-label="New temporary AI task"');
    expect(temporaryAi).toContain("function showWorkspace()");
    expect(temporaryAi).toContain("startTask");
    expect(temporaryAi).not.toContain("Not saved to session history");
    expect(temporaryAi).not.toContain("vibe64-temporary-ai__header");
    expect(temporaryAi).toContain('"R/W" : "R/O"');
    expect(temporaryAi).not.toContain("Read-only guidance");
    expect(temporaryAi).not.toContain("Allow edits");
    expect(temporaryAi).toContain('v-for="task in temporary.tasks.value"');
    expect(temporaryAi).toContain("<Vibe64AgentSettingsMenu");
    expect(temporaryAi).toContain("<Vibe64AutopilotPromptTextarea");
    expect(temporaryAi).toContain("data-temporary-ai-recovery");
    expect(temporaryAi).toContain("AI repair in progress");
    expect(temporaryAi).toContain("Repair verified");
    expect(temporaryAi).toContain("activeTaskRecoveryStatus");
    expect(temporaryAi).toContain("AI is working…");
    expect(temporaryAi).toContain('class="vibe64-temporary-ai__activity"');
    expect(temporaryAi).toContain('role="status"');
    expect(temporaryAi).toContain("vibe64.temporary-ai.feedback");
    expect(temporaryAi).toContain("finished. Review the result before continuing.");
    expect(temporaryAi).not.toContain("Attach visible preview");
    expect(temporaryAi).not.toContain("console & network");
    expect(temporaryAiComposable).toContain("beforeunload");
    expect(temporaryAiComposable).toContain("keepalive: true");
    expect(temporaryAiComposable).toContain("vibe64AgentAttachmentFilePath");
    expect(temporaryAiComposable).toContain("function showWorkspace()");
    expect(temporaryAiComposable).toContain("async function startTask(options = {})");
    expect(temporaryAiComposable).toContain("if (tasks.value.length === 0)");
    expect(temporaryAiComposable).toContain("progressUpdates: temporaryAiProgressUpdates(response.progressUpdates)");
    expect(temporaryAiComposable).toContain("task.displayMessage || payload.displayMessage");
    expect(temporaryAiComposable).toContain('status: "failed"');
    expect(temporaryAiComposable).not.toMatch(/localStorage|sessionStorage/gu);
  });

  it("keeps direct source, City, preview, terminal, and close controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("<Vibe64SessionToolbar");
    expect(component).toContain(":archive=\"props.sessionArchive\"");
    expect(component).toContain("<Vibe64SessionSourceEditor");
    expect(component).toContain("<Vibe64SystemWorldView");
    expect(component).toContain("<Vibe64OutputControls");
    expect(component).toContain("name=\"ai-terminal\"");
    expect(component).not.toContain("Session tools");
    expect(component).not.toContain("mdiDotsHorizontal");
  });

  it("offers preview attachments as ordinary direct-chat controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(component).toContain("aria-label=\"Attach visible preview\"");
    expect(component).toContain("aria-label=\"Attach console & network\"");
    expect(component).toContain("@preview-attachment-state=\"updatePreviewAttachmentState\"");
    expect(component).not.toContain("Composer menu");
    expect(promptTextarea).toContain("const attachmentCommands = useVibe64AttachmentCommands();");
    expect(promptTextarea).toContain("canUpload: () => props.attachmentsEnabled && !props.disabled");
    expect(promptTextarea).toContain("onError: attachmentFeedback.error");
    expect(promptTextarea).toContain('source: "vibe64.agent-attachment.upload.feedback"');
    expect(promptTextarea).not.toContain("attachments.status.value");
    expect(promptTextarea).not.toContain("Attachments are disabled for this prompt.");
  });

  it("labels active-turn messages as compact steering", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const promptHints = fs.readFileSync(promptHintsPath, "utf8");

    expect(component).toContain('v-if="agentStopVisible"');
    expect(component).toContain(':aria-label="composerSubmitActionAriaLabel"');
    expect(component).toContain("composerSubmitMode === 'send' ? mdiSend");
    expect(component).toContain("['steer', 'steering'].includes(composerSubmitMode)");
    expect(component).toContain("{{ composerSubmitActionLabel }}");
    expect(component).toContain('"Suggest to owner"');
    expect(component).not.toContain('"Suggesting…"');
    expect(component).toContain(':aria-busy="composerSending ? \'true\' : undefined"');
    expect(component).not.toContain(':loading="composerSending"');
    expect(component).not.toContain(':loading="interrupting"');
    expect(component).toContain('{{ interrupting ? "Stopping…" : "Stop" }}');
    expect(component).toContain(':described-by="composerSupportStatusVisible ? thinkingStatusId : \'\'"');
    expect(component).toContain("<Vibe64PromptHints");
    expect(promptHints).toContain("@media (prefers-reduced-motion: reduce)");
    expect(composable).toContain('waiting: "Waiting…"');
    expect(composable).toContain('steering: "Steering…"');
    expect(composable).toContain('retry: "Retry"');
    expect(composable).toContain('state) === "active"');
    expect(composable).toContain('props.agentConnectionStatus === "connected"');
    expect(composable).not.toContain("Send guidance while the assistant is working.");
  });

  it("requires complete compact structured answers while preserving free-form escape", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    expect(component).toContain("<v-select");
    expect(component).toContain('item-title="selectLabel"');
    expect(component).toContain(':items="numberedQuestionSelectItems[question.name]"');
    expect(component).not.toContain("#selection=");
    expect(component).toContain("Answer normally instead");
    expect(component).toContain(':prepend-icon="mdiPencilOutline"');
    expect(component.match(/:disabled="!composerCanSubmit \|\| !attachmentState\.canSubmit"/gu)).toHaveLength(1);
    expect(composable).toContain('const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";');
    expect(composable).toContain("numberedQuestions.value.every");
  });

  it("passes only direct chat and tool state through the runtime host", () => {
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");
    const runtimeHostComposable = fs.readFileSync(
      path.resolve("src/composables/useVibe64SessionRuntimeHost.js"),
      "utf8"
    );

    expect(runtimeHost).toContain(":send-agent-message=\"sendAgentMessage\"");
    expect(runtimeHost).toContain(":conversation-log=\"conversationLog\"");
    expect(runtimeHost).toContain(":retry-workspace-setup=\"retryWorkspaceSetup\"");
    expect(runtimeHost).toContain(":save-session-work=\"saveSessionWork\"");
    expect(runtimeHost).toContain(":update-session-work=\"updateSessionWork\"");
    expect(runtimeHost).toContain(":work-state=\"workState\"");
    expect(runtimeHost).toContain("sessions: props.toolbarSessions");
    expect(runtimeHost).not.toContain(":source-safety=\"sourceSafety\"");
    expect(runtimeHost).not.toContain(":autopilot-steps=");
    expect(runtimeHost).not.toContain(":automation-enabled=");
    expect(runtimeHost).not.toContain(":report-preview=");
    expect(runtimeHost).not.toContain(":rewind-to-step=");
    expect(runtimeHost).not.toContain(":actions=");
    expect(runtimeHostComposable).toContain(
      'void refreshSessionData({ reason: "agent-message-accepted" }).catch(() => null);'
    );
    expect(runtimeHostComposable).not.toContain(
      'await refreshSessionData({ reason: "agent-message-accepted" })'
    );
  });

  it("keeps workspace preparation status in chat while routing recovery to Temporary AI", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    const chatStart = component.indexOf("class=\"studio-autopilot__chat-panel\"");
    const projectStart = component.indexOf("class=\"studio-autopilot__project-panel\"");
    const activityStart = component.indexOf('aria-label="Session activity"');
    const conversationStart = component.indexOf("<Vibe64ConversationLog");

    expect(activityStart).toBeGreaterThan(chatStart);
    expect(activityStart).toBeLessThan(conversationStart);
    expect(conversationStart).toBeLessThan(projectStart);
    expect(component).toContain(':title="workspaceSetupTitle"');
    expect(component).toContain("<Vibe64TemporaryAiFixAction");
    expect(component).toContain('@retry="retryWorkspaceSetup"');
    expect(component).not.toContain(':error-messages="composerError"');
    expect(composable).toContain("requestTemporaryAi({");
    expect(composable).toContain('policy: "workspace_write"');
    expect(composable).toContain("handleTemporaryAiTaskFinished");
    expect(composable).toContain("Vibe64 will automatically rerun its deterministic workspace preparation");
    expect(composable.match(/recoveryNotice: TEMPORARY_AI_RECOVERY_NOTICE/gu)).toHaveLength(4);
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(workspaceSetupFixPrompt");
    expect(component).not.toMatch(/workspace.*(?:dialog|stepper)|(?:dialog|stepper).*workspace/iu);
  });

  it("turns a rejected managed preview identity into a Temporary AI repair request", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const launchControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64OutputControls.vue"),
      "utf8"
    );

    expect(component).toContain(":ask-codex-to-fix-preview-identity=\"assistantDirectAllowed ? askCodexToFixPreviewIdentity : null\"");
    expect(launchControls).toContain("previewIdentityFixAvailable");
    expect(launchControls).toContain("<Vibe64TemporaryAiFixAction");
    expect(launchControls).toContain("previewIdentityFixSending");
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(previewIdentityFixPrompt(input)))");
    expect(composable).toContain("app-owned, idempotent development seed");
    expect(composable).toContain("Keep preview authentication material host-managed");
  });

  it("uses multiline Enter and moves Tab directly from chat input to Send", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(component).toContain("tab-to-submit");
    expect(component).toContain(':submit-enabled="composerCanSubmit"');
    expect(component).toContain("@tab-to-submit=\"focusComposerSendButton\"");
    expect(component).not.toContain("submit-on-enter");
    expect(composable).not.toContain("Enter sends. Shift+Enter adds a line.");
    expect(promptTextarea).toContain('event.key === "Enter" && !props.submitOnEnter');
    expect(promptTextarea).toContain("props.submitEnabled");
    expect(promptTextarea).toContain("event.stopPropagation()");
  });

});
