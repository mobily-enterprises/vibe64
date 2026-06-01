import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const AUTOPILOT_RUNTIME_FILES = Object.freeze([
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue",
  "src/composables/useVibe64AutopilotController.js",
  "src/composables/useVibe64SessionData.js",
  "src/composables/useVibe64SessionActions.js",
  "src/lib/vibe64SessionPanelModel.js"
]);

const SERVER_OWNED_WORKFLOW_WORDS = Object.freeze([
  "agent_conversation",
  "changes_accepted",
  "create_and_merge_pull_request",
  "deep_ui_check_run",
  "final_review_conversation",
  "finish_session",
  "human_review_conversation",
  "implementation_reviewed",
  "issue_file_created",
  "local_session_finished",
  "main_checkout_synced",
  "make_plan",
  "make_seed_plan",
  "merge_pr",
  "plan_and_execute",
  "prepare_for_merge",
  "review_and_validate",
  "run_deep_ui_check",
  "seed_plan_made",
  "session_created",
  "session_finished",
  "skip_merge",
  "work_source_selected"
]);

describe("dumb Autopilot client ownership", () => {
  it("keeps workflow step and action vocabulary out of the Autopilot runtime client", () => {
    for (const filePath of AUTOPILOT_RUNTIME_FILES) {
      const source = readFileSync(filePath, "utf8");
      for (const word of SERVER_OWNED_WORKFLOW_WORDS) {
        expect(source, `${filePath} should not branch on ${word}`).not.toContain(word);
      }
      expect(source, `${filePath} should not inspect workflow autopilot definitions`).not.toContain("currentStepDefinition.autopilot");
    }
  });

  it("keeps direct step-input advancement owned by the server autopilot operation", () => {
    const source = readFileSync("src/components/studio/vibe64-session/Vibe64AutopilotView.vue", "utf8");
    expect(source).not.toContain("props.actions.goNext");
  });

  it("keeps Autopilot conversation history out of response-preview replacement branches", () => {
    const source = readFileSync("src/components/studio/vibe64-session/Vibe64AutopilotView.vue", "utf8");
    expect(source).toContain(":activity-messages=\"chatActivityMessages\"");
    expect(source).toContain("v-if=\"chatTakeoverVisible\"");
    expect(source).not.toContain("v-else-if=\"responsePreviewVisible\"");
  });

  it("keeps the transient command spy tied to live or failed commands", () => {
    const source = readFileSync("src/components/studio/vibe64-session/Vibe64AutopilotView.vue", "utf8");
    const commandSpyVisible = source.match(/const commandSpyVisible = computed\(\(\) => Boolean\(([\s\S]*?)\n\)\);/u)?.[1] || "";
    expect(commandSpyVisible).toContain("commandTerminalVisible.value");
    expect(commandSpyVisible).toContain("commandRunning.value");
    expect(commandSpyVisible).toContain("commandTerminalFailed.value");
    expect(commandSpyVisible).not.toContain("commandPreview.value");
    expect(commandSpyVisible).not.toContain("commandOutput.value");
  });
});
