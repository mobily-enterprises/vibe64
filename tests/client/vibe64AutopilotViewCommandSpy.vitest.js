import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
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
    expect(scriptBlock).toContain("passiveComposerSteeringActive");
    expect(scriptBlock).toContain("passiveComposerWorkflowControls");
  });

  it("builds workflow buttons from canonical screen controls", () => {
    const source = fs.readFileSync(path.resolve("src/composables/useVibe64AutopilotView.js"), "utf8");

    expect(source).toContain("return allScreenControls.value.map((control) => ({");
    expect(source).not.toContain("return screenControls.value.map((control) => ({");
  });

  it("keeps inline composer workflow controls in one form surface", () => {
    const source = fs.readFileSync(workflowControlFormPath, "utf8");

    expect(source).toContain("v-if=\"toolbarWorkflowControlsVisible\"");
    expect(source).toContain("v-if=\"actionWorkflowControlsVisible\"");
    expect(source).toContain("const actionWorkflowControlsVisible = computed(() => Boolean(");
    expect(source).toContain("!toolbarWorkflowControlsVisible.value &&");
  });
});
