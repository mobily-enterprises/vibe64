import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const autopilotSource = readFileSync(
  "src/components/studio/ai-studio-session/AiStudioAutopilotView.vue",
  "utf8"
);
const conversationLogSource = readFileSync(
  "src/components/studio/ai-studio-session/AiStudioConversationLog.vue",
  "utf8"
);

describe("AiStudioAutopilot composer keyboard flow", () => {
  it("keeps the send submit button before workflow controls in tab order", () => {
    const rowIndex = autopilotSource.indexOf("studio-autopilot__composer-actions-row");
    const submitIndex = autopilotSource.indexOf("studio-autopilot__composer-submit-actions", rowIndex);
    const workflowControlIndex = autopilotSource.indexOf("studio-autopilot__screen-actions--composer", rowIndex);

    expect(rowIndex).toBeGreaterThan(-1);
    expect(submitIndex).toBeGreaterThan(rowIndex);
    expect(workflowControlIndex).toBeGreaterThan(rowIndex);
    expect(submitIndex).toBeLessThan(workflowControlIndex);
  });

  it("keeps workflow controls visually left while send remains keyboard-first", () => {
    expect(autopilotSource).toContain(".studio-autopilot__composer-submit-actions");
    expect(autopilotSource).toContain("order: 2;");
    expect(autopilotSource).toContain(".studio-autopilot__screen-actions.studio-autopilot__screen-actions--composer");
    expect(autopilotSource).toContain("order: 1;");
  });

  it("scrolls the conversation to the latest message when the composer changes", () => {
    expect(autopilotSource).toContain(":scroll-key=\"conversationScrollKey\"");
    expect(conversationLogSource).toContain("scrollKey");
    expect(conversationLogSource).toContain("ref=\"bodyElement\"");
    expect(conversationLogSource).toContain("target.scrollTop = target.scrollHeight;");
  });
});
