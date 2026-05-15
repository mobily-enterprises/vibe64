import { describe, expect, it } from "vitest";

import {
  buildIssueSessionCodexPromptSignature
} from "../../src/lib/issueSessionPromptIdentity.js";

describe("issue session prompt identity", () => {
  it("keeps the same prompt signature after JSKIT advances to the user decision step", () => {
    const base = {
      activeCycle: "001",
      currentReviewPass: "002",
      prompt: "Review this worktree and list important findings.",
      sessionId: "session-1"
    };

    expect(buildIssueSessionCodexPromptSignature({
      ...base,
      currentStep: "review_prompt_rendered"
    })).toBe(buildIssueSessionCodexPromptSignature({
      ...base,
      currentStep: "review_changes_accepted"
    }));
  });

  it("uses the review pass to separate repeated deslop prompts with the same text", () => {
    const base = {
      activeCycle: "001",
      prompt: "Review this worktree and list important findings.",
      sessionId: "session-1"
    };

    expect(buildIssueSessionCodexPromptSignature({
      ...base,
      currentReviewPass: "001"
    })).not.toBe(buildIssueSessionCodexPromptSignature({
      ...base,
      currentReviewPass: "002"
    }));
  });
});
