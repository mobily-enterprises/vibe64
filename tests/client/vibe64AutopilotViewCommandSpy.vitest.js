import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const conversationLogPath = path.resolve("src/components/studio/vibe64-session/Vibe64ConversationLog.vue");
const codexTerminalPath = path.resolve("packages/vibe64-terminals/src/server/codexTerminal.js");
const composerControlModelPath = path.resolve("src/lib/vibe64AutopilotComposerControlModel.js");
const diffContentPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionDiffContent.vue");
const diffPanelPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionDiffPanel.vue");
const promptTextareaPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue");
const sessionCurrentStepPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionCurrentStep.vue");
const sessionToolbarPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionToolbar.vue");
const workflowControlFormPath = path.resolve("src/components/studio/vibe64-session/Vibe64WorkflowControlForm.vue");

describe("Vibe64AutopilotView command spy placement", () => {
  it("renders the command spy outside pane pages so session tools cannot hide it", () => {
    const source = fs.readFileSync(componentPath, "utf8");
    const commandSpyIndex = source.indexOf("studio-autopilot__command-spy");
    const firstPanePageIndex = source.indexOf("studio-autopilot__right-pane-page");

    expect(commandSpyIndex).toBeGreaterThan(-1);
    expect(firstPanePageIndex).toBeGreaterThan(-1);
    expect(commandSpyIndex).toBeLessThan(firstPanePageIndex);
  });

  it("keeps the composer as one surface across selected and passive modes", () => {
    const source = fs.readFileSync(componentPath, "utf8");
    const composerBlock = source.match(/<Vibe64WorkflowControlForm\n\s+v-if="composerControlComposerFormVisible"[\s\S]*?\/>/u)?.[0] || "";
    const timelineBlock = source.match(/<Vibe64WorkflowControlForm\n\s+v-if="composerControlTimelineFormVisible"[\s\S]*?\/>/u)?.[0] || "";
    const scriptBlock = source.match(/const \{[\s\S]*?\} = useVibe64AutopilotView\(props, emit\);/u)?.[0] || "";

    expect(source).not.toContain("v-else-if=\"controlSurfaceMode === 'passive_composer'\"");
    expect(source).toContain("v-if=\"bottomComposerVisible\"");
    expect(composerBlock).toContain(":key=\"composerControlFormKey\"");
    expect(composerBlock).toContain(":can-submit-selected-control=\"composerControlCanSubmit\"");
    expect(composerBlock).toContain(":agent-controls-visible=\"composerControlAgentControlsVisible\"");
    expect(composerBlock).toContain(":attach-textarea=\"composerControlAttachTextarea\"");
    expect(composerBlock).toContain(":input-disabled-reason=\"composerInlineInputDisabledReason\"");
    expect(composerBlock).not.toContain(":attachments-enabled=\"false\"");
    expect(composerBlock).toContain(":workflow-controls=\"composerControlWorkflowControls\"");
    expect(composerBlock).toContain("@submit=\"submitComposerControl\"");
    expect(composerBlock).toContain("@update-value=\"updateComposerControlValue\"");
    expect(timelineBlock).toContain(":can-submit-selected-control=\"composerControlCanSubmit\"");
    expect(timelineBlock).toContain(":layout=\"composerControlLayout\"");
    expect(timelineBlock).toContain(":workflow-controls=\"composerControlWorkflowControls\"");
    expect(timelineBlock).toContain("workflow-controls-with-open-form");
    expect(timelineBlock).toContain("@submit=\"submitComposerControl\"");
    expect(timelineBlock).toContain("@update-value=\"updateComposerControlValue\"");
    expect(scriptBlock).toContain("composerControlCanSubmit");
    expect(scriptBlock).toContain("composerControlFormKey");
    expect(scriptBlock).toContain("composerControlComposerFormVisible");
    expect(scriptBlock).toContain("composerControlTimelineFormVisible");
    expect(scriptBlock).toContain("composerInlineInputDisabledReason");
    expect(scriptBlock).toContain("composerControlWorkflowControls");
    expect(scriptBlock).toContain("bottomComposerVisible");
  });

  it("builds workflow buttons from canonical screen controls", () => {
    const source = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(source).toContain("return visibleWorkflowButtonControls(");
    expect(source).toContain("allScreenControls.value.map((control) => ({");
    expect(source).not.toContain("return screenControls.value.map((control) => ({");
  });

  it("keeps source config in the session tools surface", () => {
    const componentSource = fs.readFileSync(componentPath, "utf8");
    const composableSource = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(composableSource).toContain("id: \"config\"");
    expect(composableSource).toContain("label: \"Config\"");
    expect(composableSource).toContain("vibe64SessionSourcePath(props.session || {})");
    expect(componentSource).toContain("v-show=\"rightPaneTab === 'config'\"");
    expect(componentSource).toContain("<ProjectConfigSetup");
    expect(componentSource).toContain("@save=\"saveSessionProjectConfig\"");
  });

  it("keeps session tools inline with the session tabs", () => {
    const componentSource = fs.readFileSync(componentPath, "utf8");
    const sessionTabsRowBlock = componentSource.match(/<div class="studio-autopilot__session-tabs-row">[\s\S]*?<\/div>\n\n {8}<Vibe64AutopilotNavigation/u)?.[0] || "";
    const sessionToolsButtonRule = componentSource.match(/\.studio-autopilot__session-tools-button \{[\s\S]*?\}/u)?.[0] || "";

    expect(sessionTabsRowBlock).toContain("<Vibe64SessionToolbar");
    expect(sessionTabsRowBlock).toContain("<v-menu");
    expect(sessionTabsRowBlock.indexOf("<Vibe64SessionToolbar")).toBeLessThan(sessionTabsRowBlock.indexOf("<v-menu"));
    expect(componentSource).toContain(".studio-autopilot__session-tabs-row {\n  align-items: center;\n  display: flex;");
    expect(componentSource).toContain(".studio-autopilot__session-tabs-row :deep(.studio-ai-sessions__toolbar) {\n  flex: 1 1 auto;");
    expect(sessionToolsButtonRule).toContain("flex: 0 0 2rem;");
    expect(sessionToolsButtonRule).not.toContain("margin-left: auto");
  });

  it("does not duplicate the selected control inside selected control workflow choices", () => {
    const source = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(source).toContain("const selectedControlId = String(selectedControl.value?.id || \"\").trim();");
    expect(source).toContain("String(control?.id || \"\").trim() !== selectedControlId");
  });

  it("keeps inline composer workflow controls in one form surface", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");
    const toolbarWorkflowControlsBlock = source.match(/const toolbarWorkflowControlsVisible = computed\(\(\) => Boolean\([\s\S]*?\)\);/u)?.[0] || "";
    const footerSlotIndex = source.indexOf("#footer");
    const inlineActionsIndex = source.indexOf("class=\"vibe64-workflow-control-form__inline-actions\"");
    const inlineSubmitIndex = source.indexOf("class=\"vibe64-workflow-control-form__inline-submit\"", inlineActionsIndex);
    const inlineCancelIndex = source.indexOf("class=\"vibe64-workflow-control-form__inline-cancel\"", inlineActionsIndex);
    const toolbarIndex = source.indexOf("class=\"vibe64-workflow-control-form__composer-toolbar\"");
    const footerToolbarIndex = source.indexOf("class=\"vibe64-workflow-control-form__composer-toolbar\"", footerSlotIndex);
    const footerRule = source.match(/\.vibe64-workflow-control-form__composer-footer \{[\s\S]*?\}/u)?.[0] || "";
    const toolbarRule = source.match(/\.vibe64-workflow-control-form__composer-toolbar \{[\s\S]*?\}/u)?.[0] || "";
    const inlineActionsRule = source.match(/\.vibe64-workflow-control-form__inline-actions \{[\s\S]*?\}/u)?.[0] || "";

    expect(source).toContain("v-if=\"toolbarWorkflowControlsVisible || inputDisabledStatusVisible || interruptVisible || agentControlsVisible || composerToolsVisible\"");
    expect(source).toContain("v-if=\"toolbarWorkflowControlsVisible\"");
    expect(source).toContain("role=\"status\"");
    expect(source).toContain("inputDisabledStatusVisible");
    expect(source).toContain("promptFieldPlaceholder(field)");
    expect(source).toContain("v-if=\"actionWorkflowControlsVisible\"");
    expect(source).toContain("v-if=\"inlineCancelButtonVisible\"");
    expect(source).toContain("ref=\"inlineSubmitButtonRef\"");
    expect(source).not.toContain("@keydown.tab.exact=\"focusInlineSubmitFromTextarea(field, $event)\"");
    expect(source).not.toContain("function focusInlineSubmitFromTextarea(field = {}, event = null)");
    expect(source).not.toContain("#input-start");
    expect(footerSlotIndex).toBeGreaterThan(-1);
    expect(toolbarIndex).toBeGreaterThan(footerSlotIndex);
    expect(inlineActionsIndex).toBeGreaterThan(-1);
    expect(inlineActionsIndex).toBeGreaterThan(footerSlotIndex);
    expect(inlineSubmitIndex).toBeGreaterThan(inlineActionsIndex);
    expect(inlineCancelIndex).toBeGreaterThan(inlineSubmitIndex);
    expect(footerToolbarIndex).toBeGreaterThan(inlineActionsIndex);
    expect(source).toContain("const selectedControlFormOpen = computed(() => Boolean(");
    expect(source).toContain("workflowControlsWithOpenForm");
    expect(source).toContain("(!selectedControlFormOpen.value || props.workflowControlsWithOpenForm) &&");
    expect(source).toContain("const actionWorkflowControlsVisible = computed(() => Boolean(");
    expect(source).toContain("!toolbarWorkflowControlsVisible.value &&");
    expect(source).toContain("!inlineSubmitActive.value &&");
    expect(toolbarWorkflowControlsBlock).toContain("(!selectedControlFormOpen.value || props.workflowControlsWithOpenForm) &&");
    expect(source).toContain(".vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-cancel)");
    expect(source).toContain("background: var(--studio-control-bg, #fff) !important;");
    expect(source).toContain("color: var(--studio-control-text, #202124) !important;");
    expect(footerRule).toContain("display: flex;");
    expect(footerRule).toContain("justify-content: space-between;");
    expect(toolbarRule).toContain("order: 1;");
    expect(toolbarRule).not.toContain("grid-row");
    expect(inlineActionsRule).toContain("margin-left: auto;");
    expect(inlineActionsRule).toContain("order: 2;");
    expect(inlineActionsRule).not.toContain("grid-row");
  });

  it("scrolls conversation logs only when the session pane is visible", () => {
    const componentSource = fs.readFileSync(componentPath, "utf8");
    const composableSource = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");
    const conversationLogBlock = componentSource.match(/<Vibe64ConversationLog[\s\S]*?\/>/u)?.[0] || "";

    expect(conversationLogBlock).toContain(":visible=\"conversationLogVisible\"");
    expect(conversationLogBlock).toContain(":has-more-before=\"conversationLog.hasMoreBefore\"");
    expect(conversationLogBlock).toContain(":loading-more=\"conversationLog.loadingMore\"");
    expect(conversationLogBlock).toContain(":load-more-error=\"conversationLog.loadMoreError\"");
    expect(conversationLogBlock).toContain("@load-more=\"loadMoreChatTurns\"");
    expect(composableSource).toContain("const conversationLogVisible = computed(() => Boolean(");
    expect(composableSource).toContain("async function loadMoreChatTurns()");
    expect(composableSource).toContain("props.conversationLog.loadMore()");
    expect(composableSource).toContain("props.active &&");
    expect(composableSource).toContain("chatTimelineVisible.value");
    expect(composableSource).toContain("conversationLogVisible,");
    expect(composableSource).toContain("loadMoreChatTurns,");
    expect(componentSource).toContain("function chatBodyScrollContainerActive()");
    expect(componentSource).toContain("chatTakeoverVisible.value ||");
    expect(componentSource).toContain("stepInputFormVisible.value");
    expect(componentSource).toContain("if (!props.active || !chatBodyScrollContainerActive())");
  });

  it("lets users scroll away from live conversation updates", () => {
    const conversationLogSource = fs.readFileSync(conversationLogPath, "utf8");

    expect(conversationLogSource).toContain("@wheel.passive=\"markUserScrollIntent\"");
    expect(conversationLogSource).toContain("@touchmove.passive=\"markUserScrollIntent\"");
    expect(conversationLogSource).toContain("@scroll.passive=\"updateLatestFollowFromScroll\"");
    expect(conversationLogSource).toContain("const followingLatest = ref(true);");
    expect(conversationLogSource).toContain("const userScrollIntent = ref(false);");
    expect(conversationLogSource).toContain("const autoScrollEnabled = computed(() => Boolean(");
    expect(conversationLogSource).toContain("props.visible &&");
    expect(conversationLogSource).toContain("followingLatest.value");
    expect(conversationLogSource).toContain("scrollElementNearBottom(target)");
    expect(conversationLogSource).toContain("!userScrollIntent.value && followingLatest.value");
    expect(conversationLogSource).toContain("clearScheduledScrolls();");
  });

  it("uses instant initial conversation settling and smooth live follow scrolling", () => {
    const conversationLogSource = fs.readFileSync(conversationLogPath, "utf8");

    expect(conversationLogSource).toContain("function latestUserScrollKey(turns = [])");
    expect(conversationLogSource).toContain("function latestAssistantScrollKey(turns = [])");
    expect(conversationLogSource).toContain("function latestThinkingScrollKey(turns = [])");
    expect(conversationLogSource).toContain("const timelineScrollTrigger = computed(() => [");
    expect(conversationLogSource).toContain("displayTurns.value.length ? \"has-turns\" : \"empty\"");
    expect(conversationLogSource).toContain("const initialScrollSettled = ref(false);");
    expect(conversationLogSource).toContain("const initialScrollPending = computed(() => Boolean(");
    expect(conversationLogSource).toContain("function queueInitialBottomScroll()");
    expect(conversationLogSource).toContain("function queueLiveBottomScroll(");
    expect(conversationLogSource).toContain("studio-conversation-log__body--settling");
    expect(conversationLogSource).toContain("const latestUserTurnScrollKey = computed(() => latestUserScrollKey(displayTurns.value));");
    expect(conversationLogSource).toContain("const latestAssistantTurnScrollKey = computed(() => latestAssistantScrollKey(displayTurns.value));");
    expect(conversationLogSource).toContain("const latestThinkingTurnScrollKey = computed(() => latestThinkingScrollKey(displayTurns.value));");
    expect(conversationLogSource).toContain("timelineScrollTrigger.value,\n  latestUserTurnScrollKey.value");
    expect(conversationLogSource).toContain("timelineScrollTrigger.value,\n  latestAssistantTurnScrollKey.value");
    expect(conversationLogSource).toContain("timelineScrollTrigger.value,\n  latestThinkingTurnScrollKey.value");
    expect(conversationLogSource).toContain("if (timelineKey !== previousTimelineKey) {");
    expect(conversationLogSource).toContain("behavior: \"smooth\"");
    expect(conversationLogSource).toContain("function queueLiveBottomScroll({\n  force = false\n} = {})");
    expect(conversationLogSource).toContain("force: true");
    expect(conversationLogSource).toContain("watch(timelineScrollTrigger, () => {");
    expect(conversationLogSource).toContain("queueInitialBottomScroll();");
    expect(conversationLogSource).toContain("behavior: \"auto\"");
    expect(conversationLogSource).not.toContain("displayTurns.value.map(turnScrollKey)");
  });

  it("keeps session tab close state visible with a cheap thinking dot animation", () => {
    const toolbarSource = fs.readFileSync(sessionToolbarPath, "utf8");
    const autopilotViewSource = fs.readFileSync(componentPath, "utf8");

    expect(toolbarSource).toContain("class=\"studio-ai-sessions__tab-main\"");
    expect(toolbarSource).toContain("class=\"studio-ai-sessions__tab-close-slot\"");
    expect(toolbarSource).toContain("background: transparent !important;");
    expect(toolbarSource).toContain("padding: 0 !important;");
    expect(toolbarSource).toContain(".studio-ai-sessions__tab :deep(.v-chip__content)");
    expect(toolbarSource).toContain(".studio-ai-sessions__tab-main:hover,");
    expect(toolbarSource).toContain("background: rgb(var(--v-theme-primary)) !important;");
    expect(toolbarSource).toContain("color: rgb(var(--v-theme-on-primary)) !important;");
    expect(toolbarSource).toContain(".studio-ai-sessions__tab-main:hover + .studio-ai-sessions__tab-close-slot");
    expect(toolbarSource).toContain("background: var(--studio-control-active-bg, #e7e7e7);");
    expect(toolbarSource).toContain("border-radius: 0 999px 999px 0;");
    expect(toolbarSource).toContain("border-radius: 999px 0 0 999px;");
    expect(toolbarSource).toContain("flex: 0 0 1.38rem;");
    expect(toolbarSource).toContain("height: 1.38rem !important;");
    expect(toolbarSource).toContain("padding-inline: 0.14rem 0.28rem;");
    expect(toolbarSource).not.toContain("opacity: 0;");
    expect(toolbarSource).not.toContain(":has(");
    expect(toolbarSource).not.toContain(".studio-ai-sessions__tab:hover .studio-ai-sessions__tab-abandon");
    expect(toolbarSource).toContain("@media (hover: none), (pointer: coarse)");
    expect(toolbarSource).toContain(".studio-ai-sessions__tab-abandon:hover");
    expect(toolbarSource).toContain("inset 0 0 0 1px rgba(var(--v-theme-on-primary), 0.16)");
    expect(toolbarSource).toContain("0 1px 3px rgba(var(--v-theme-primary), 0.34);");
    expect(toolbarSource).toContain("opacity: 1;");
    expect(toolbarSource).toContain("'studio-ai-sessions__tab--thinking': sessionItem.codexThinking");
    expect(toolbarSource).toContain(".studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot");
    expect(toolbarSource).toContain("animation: studio-ai-sessions-thinking-pulse 1.3s steps(2, end) infinite;");
    expect(toolbarSource).toContain("@keyframes studio-ai-sessions-thinking-pulse");
    expect(toolbarSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(toolbarSource).not.toContain(".studio-ai-sessions__tab--thinking .studio-ai-sessions__status-dot::after");
    expect(toolbarSource).not.toContain("will-change: opacity, transform");
    expect(toolbarSource).not.toContain("box-shadow: 0 0 0 0.18rem");
    expect(toolbarSource).not.toContain("box-shadow: 0 0 0 0.22rem");
    expect(autopilotViewSource).toContain("studio-autopilot__thinking-mark");
    expect(autopilotViewSource).toContain("studio-autopilot-thinking-pulse");
  });

  it("routes pasted files through the prompt textarea attachment uploader", () => {
    const source = fs.readFileSync(promptTextareaPath, "utf8");

    expect(source).toContain("@paste=\"handlePaste\"");
    expect(source).toContain("const handlePaste = attachments.handlePaste;");
  });

  it("hides disabled selected-control submit buttons instead of rendering disabled actions", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(source).toContain("v-if=\"submitButtonVisible\"");
    expect(source).toContain("const submitButtonVisible = computed(() => Boolean(");
    expect(source).not.toContain(":disabled=\"!canSubmitSelectedControl\"");
  });

  it("keeps inline steer and submit controls dimensionally stable", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(source).toContain(".vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-submit)");
    expect(source).toContain("border-radius: 8px !important;");
    expect(source).toContain("height: 2.4rem !important;");
    expect(source).toContain("min-height: 2.4rem !important;");
    expect(source).toContain("min-width: 5.4rem !important;");
    expect(source).toContain("width: 5.4rem !important;");
    expect(source).toContain(".vibe64-workflow-control-form :deep(.v-btn.vibe64-workflow-control-form__inline-submit--with-label)");
    expect(source).toContain(".vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn)");
    expect(source).toContain("min-width: max-content;");
    expect(source).toContain("width: max-content;");
    expect(source).toContain(".vibe64-workflow-control-form__workflow-actions--toolbar :deep(.v-btn__content)");
    expect(source).toContain("text-overflow: clip;");
  });

  it("keeps primary workflow buttons readable on hover", () => {
    const autopilotSource = fs.readFileSync(componentPath, "utf8");
    const currentStepSource = fs.readFileSync(sessionCurrentStepPath, "utf8");
    const formSource = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(autopilotSource).toContain(".studio-autopilot__screen-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover)");
    expect(autopilotSource).toContain(".studio-autopilot__screen-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible)");
    expect(currentStepSource).toContain(".studio-ai-sessions__actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover)");
    expect(currentStepSource).toContain(".studio-ai-sessions__actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible)");
    expect(formSource).toContain(".vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):hover)");
    expect(formSource).toContain(".vibe64-workflow-control-form__workflow-actions :deep(.v-btn--variant-flat:not(.v-btn--disabled):focus-visible)");
  });

  it("keeps disabled composer drafts from changing weight during submit", () => {
    const formSource = fs.readFileSync(workflowControlFormPath, "utf8");
    const promptTextareaSource = fs.readFileSync(promptTextareaPath, "utf8");
    const formDisabledRule = formSource.match(/\.vibe64-workflow-control-form :deep\(\.studio-autopilot-prompt-textarea__input:disabled\) \{[\s\S]*?\}/u)?.[0] || "";
    const textareaDisabledRule = promptTextareaSource.match(/\.studio-autopilot-prompt-textarea__input:disabled \{[\s\S]*?\}/u)?.[0] || "";

    expect(formDisabledRule).toContain("color: rgba(var(--v-theme-on-surface), 0.95);");
    expect(textareaDisabledRule).toContain("color: rgba(var(--v-theme-on-surface), 0.95);");
    expect(formDisabledRule).not.toContain("font-weight");
    expect(formDisabledRule).not.toContain("font-size");
    expect(textareaDisabledRule).not.toContain("font-weight");
    expect(textareaDisabledRule).not.toContain("font-size");
  });

  it("keeps composer and outlined input borders visible", () => {
    const appSource = fs.readFileSync(path.resolve("src/App.vue"), "utf8");
    const promptTextareaSource = fs.readFileSync(promptTextareaPath, "utf8");

    expect(appSource).toContain(".v-application .v-field--variant-outlined .v-field__outline");
    expect(appSource).toContain(".v-application .v-field--variant-outlined.v-field--focused");
    expect(appSource).toContain("0 0 0 2px rgba(var(--v-theme-primary), 0.28)");
    expect(promptTextareaSource).toContain(".studio-autopilot-prompt-textarea__field:focus-within");
    expect(promptTextareaSource).toContain("border: 1px solid rgba(var(--v-theme-on-surface), 0.34)");
    expect(promptTextareaSource).toContain("inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.08)");
  });

  it("recovers local composer handoff when the Vibe64 server disconnects", () => {
    const autopilotSource = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");
    const actionsSource = fs.readFileSync(path.resolve("src/composables/useVibe64SessionActions.js"), "utf8");

    expect(autopilotSource).toContain("BROWSER_LIFECYCLE_DISCONNECTED_EVENT");
    expect(autopilotSource).toContain("function failLocalComposerSubmissionForLifecycleDisconnect()");
    expect(autopilotSource).toContain("optimisticComposerTurnIsLocalPending(optimistic)");
    expect(autopilotSource).toContain("optimistic?.status === \"failed\"");
    expect(autopilotSource).toContain("props.conversationLog.turns.some((turn) => turnMatchesOptimisticComposerTurn(turn, optimistic))");
    expect(autopilotSource).toContain("Vibe64 restarted before this message reached Codex.");
    expect(autopilotSource).toContain("props.actions?.clear?.();");
    expect(actionsSource).toContain("function clearSessionCommandState()");
    expect(actionsSource).toContain("command.resource?.mutation?.reset?.();");
  });

  it("enters passive composer steer mode before steering submit is available", () => {
    const autopilotSource = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");
    const composerControlModelSource = fs.readFileSync(composerControlModelPath, "utf8");

    expect(autopilotSource).toContain("label: passiveComposerSteeringModeActive.value");
    expect(autopilotSource).toContain("? \"Steer Codex\"");
    expect(autopilotSource).toContain(": \"Message\"");
    expect(autopilotSource).toContain("id: passiveComposerSteeringModeActive.value ? \"passive_steer_codex\" : \"passive_composer\"");
    expect(autopilotSource).toContain("label: passiveComposerSteeringModeActive.value ? \"Steer\" : \"Send\"");
    expect(autopilotSource).toContain("passiveComposerSteeringModeActive: passiveComposerSteeringModeActive.value");
    expect(composerControlModelSource).toContain("? passiveComposerSteeringModeActive");
    expect(autopilotSource).toContain("passiveComposerSteeringActive.value &&");
    expect(autopilotSource).toContain("steeringActive: passiveComposerSteeringModeActive.value");
  });

  it("keeps late reasoning summaries from jumping above visible progress", () => {
    const conversationLogSource = fs.readFileSync(conversationLogPath, "utf8");
    const codexTerminalSource = fs.readFileSync(codexTerminalPath, "utf8");

    expect(codexTerminalSource).toContain("function createCodexAppServerReasoningSegment(");
    expect(codexTerminalSource).toContain("function splitCodexAppServerReasoningTurn(");
    expect(codexTerminalSource).toContain("persistedAt: \"\"");
    expect(codexTerminalSource).toContain("segment.persistedAt ||= new Date().toISOString();");
    expect(codexTerminalSource).toContain("at: segment.persistedAt");
    expect(conversationLogSource).toContain("function displayThinkingMessage(message = null)");
    expect(conversationLogSource).toContain(".studio-conversation-log__thinking-message {\n  white-space: pre-wrap;");
  });

  it("filters unavailable workflow and fallback action buttons instead of rendering disabled buttons", () => {
    const formSource = fs.readFileSync(workflowControlFormPath, "utf8");
    const actionButtonSource = fs.readFileSync(path.resolve("src/components/studio/vibe64-session/Vibe64SessionActionButton.vue"), "utf8");

    expect(formSource).toContain("visibleWorkflowButtonControls(props.workflowControls)");
    expect(actionButtonSource).toContain("v-if=\"action.enabled === true\"");
    expect(actionButtonSource).not.toContain(":disabled=\"busy || action.enabled !== true\"");
  });

  it("isolates the heavy diff pane from composer keystroke rendering", () => {
    const componentSource = fs.readFileSync(componentPath, "utf8");
    const diffPanelSource = fs.readFileSync(diffPanelPath, "utf8");
    const diffContentSource = fs.readFileSync(diffContentPath, "utf8");
    const diffPaneBlock = componentSource.match(/v-show="rightPaneTab === 'diff'"[\s\S]*?<Vibe64SessionDiffPanel[\s\S]*?\/>/u)?.[0] || "";

    expect(diffPaneBlock).toContain("studio-autopilot__diff-pane");
    expect(diffPaneBlock).toContain("v-memo=\"[rightPaneTab, diff.payload, diff.error, diff.loading, review.diffDisabled, review.diffTitle]\"");
    expect(componentSource).toContain(".studio-autopilot__diff-pane {\n  contain: layout paint;");
    expect(diffPanelSource).toContain(".studio-ai-session-diff-panel {\n  contain: layout paint;");
    expect(diffContentSource).toContain(".studio-ai-session-diff-content {\n  contain: layout paint;");
    expect(diffContentSource).toContain(".studio-ai-session-diff-content__rendered {\n  contain: layout paint;");
  });
});
