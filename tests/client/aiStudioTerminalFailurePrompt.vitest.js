import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_FAILURE_TAIL_LINES,
  terminalFailureFixRequest,
  terminalFailureOutputTail
} from "../../src/lib/aiStudioTerminalFailurePrompt.js";
import {
  questionBatchLimitInstruction
} from "@local/ai-studio-adapters/server/promptQuestionPolicy";

describe("AI Studio terminal failure prompt", () => {
  it("captures the last 200 terminal lines", () => {
    const output = Array.from({ length: DEFAULT_TERMINAL_FAILURE_TAIL_LINES + 5 }, (_, index) => `line-${index + 1}`)
      .join("\n");

    const tail = terminalFailureOutputTail(output);

    const tailLines = tail.split("\n");
    expect(tailLines).toHaveLength(DEFAULT_TERMINAL_FAILURE_TAIL_LINES);
    expect(tailLines[0]).toBe("line-6");
    expect(tailLines.at(-1)).toBe(`line-${DEFAULT_TERMINAL_FAILURE_TAIL_LINES + 5}`);
  });

  it("builds a Codex fix request with the current-step helper contract and command context", () => {
    const request = terminalFailureFixRequest({
      actionId: "build",
      actionLabel: "Build app",
      closeError: "Command exited with code 1",
      commandPreview: "npm run build",
      currentStep: "project_validated",
      exitCode: 1,
      output: "older\nlatest failure",
      sessionId: "session-1",
      stepStatus: "waiting_for_input",
      terminalKind: "command",
      terminalSessionId: "terminal-1",
      terminalStatus: "exited",
      userMessage: "This looked stuck before I stopped it."
    });

    expect(request.outputTail).toBe("older\nlatest failure");
    expect(request.prompt).toContain("\"kind\": \"consider_resolved\"");
    expect(request.prompt).toContain("\"stepId\": \"project_validated\"");
    expect(request.prompt).toContain("\"stepStatus\": \"waiting_for_input\"");
    expect(request.prompt).toContain("\"kind\": \"waiting_for_input\"");
    expect(request.prompt).toContain("write the same question or blocker in normal Codex response text");
    expect(request.prompt).toContain(questionBatchLimitInstruction());
    expect(request.prompt).toContain("format each question on its own line as `[1] Question text`");
    expect(request.prompt).toContain("- Session: session-1");
    expect(request.prompt).toContain("- Subject: Build app");
    expect(request.prompt).toContain("- Command: npm run build");
    expect(request.prompt).toContain("This looked stuck before I stopped it.");
    expect(request.prompt).toContain("latest failure");
  });
});
