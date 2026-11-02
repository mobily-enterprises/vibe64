import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTOPILOT_VIEW_FILES, readAutopilotViewSource } from "./helpers/autopilotViewSource.js";

const DIRECT_SESSION_FILES = Object.freeze([
  ...AUTOPILOT_VIEW_FILES,
  "src/composables/useVibe64AutopilotView.js",
  "src/composables/useVibe64AgentTurnState.js",
  "src/composables/useVibe64AutopilotChatPane.js",
  "src/composables/useVibe64MainChatDelivery.js",
  "src/composables/useVibe64ShortActionDismissals.js"
]);

const RETIRED_WORKFLOW_WORDS = Object.freeze([
  "create_and_merge_pull_request",
  "finish_session",
  "make_seed_plan",
  "merge_pr",
  "plan_and_execute",
  "prepare_for_merge",
  "review_and_validate",
  "run_deep_ui_check",
  "skip_merge",
  "work_source_selected"
]);

describe("direct session client ownership", () => {
  it("does not interpret workflow stages or actions", () => {
    for (const filePath of DIRECT_SESSION_FILES) {
      const source = readFileSync(filePath, "utf8");
      for (const word of RETIRED_WORKFLOW_WORDS) {
        expect(source, `${filePath} should not branch on ${word}`).not.toContain(word);
      }
      expect(source).not.toContain("currentStepDefinition");
      expect(source).not.toContain("runNextOperation");
      expect(source).not.toContain("props.actions.goNext");
    }
  });

  it("keeps conversation history and input in one direct chat surface", () => {
    const component = readAutopilotViewSource();
    const composable = readFileSync("src/composables/useVibe64AutopilotView.js", "utf8");

    expect(component).toContain("<Vibe64ConversationLog");
    expect(component).toContain("<Vibe64AutopilotPromptTextarea");
    expect(component).not.toContain("ReportPreview");
    expect(component).not.toContain("command-spy");
    expect(composable).not.toContain("chatActivityMessages");
    expect(composable).not.toContain("commandFailureResponseVisible");
  });
});
