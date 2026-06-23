import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const diffContentPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionDiffContent.vue");
const diffPanelPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionDiffPanel.vue");
const promptTextareaPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue");
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

  it("keeps the passive steer composer lean and wired to submit state", () => {
    const source = fs.readFileSync(componentPath, "utf8");
    const passiveComposerBlock = source.match(/<Vibe64WorkflowControlForm\n\s+v-else-if="passiveComposerVisible"[\s\S]*?\/>/u)?.[0] || "";
    const scriptBlock = source.match(/const \{[\s\S]*?\} = useVibe64AutopilotView\(props, emit\);/u)?.[0] || "";

    expect(passiveComposerBlock).toContain(":can-submit-selected-control=\"passiveComposerCanSubmit\"");
    expect(passiveComposerBlock).toContain(":agent-controls-visible=\"false\"");
    expect(passiveComposerBlock).toContain(":attachments-enabled=\"false\"");
    expect(passiveComposerBlock).toContain(":workflow-controls=\"passiveComposerWorkflowControls\"");
    expect(scriptBlock).toContain("passiveComposerCanSubmit");
    expect(scriptBlock).toContain("passiveComposerInputDisabled");
    expect(scriptBlock).toContain("passiveComposerSteeringModeActive");
    expect(scriptBlock).toContain("passiveComposerWorkflowControls");
  });

  it("builds workflow buttons from canonical screen controls", () => {
    const source = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(source).toContain("return visibleWorkflowButtonControls(");
    expect(source).toContain("allScreenControls.value.map((control) => ({");
    expect(source).not.toContain("return screenControls.value.map((control) => ({");
  });

  it("does not duplicate the selected control inside selected control workflow choices", () => {
    const source = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(source).toContain("const selectedControlId = String(selectedControl.value?.id || \"\").trim();");
    expect(source).toContain("String(control?.id || \"\").trim() !== selectedControlId");
  });

  it("keeps inline composer workflow controls in one form surface", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(source).toContain("v-if=\"toolbarWorkflowControlsVisible\"");
    expect(source).toContain("v-if=\"actionWorkflowControlsVisible\"");
    expect(source).toContain("const actionWorkflowControlsVisible = computed(() => Boolean(");
    expect(source).toContain("!toolbarWorkflowControlsVisible.value &&");
  });

  it("hides disabled selected-control submit buttons instead of rendering disabled actions", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(source).toContain("v-if=\"submitButtonVisible\"");
    expect(source).toContain("const submitButtonVisible = computed(() => Boolean(");
    expect(source).not.toContain(":disabled=\"!canSubmitSelectedControl\"");
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
