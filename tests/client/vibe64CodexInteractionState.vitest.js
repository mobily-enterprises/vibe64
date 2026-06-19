import { describe, expect, it } from "vitest";

import {
  codexInteractionLocksControls,
  codexLiveProgressMessagesVisible
} from "../../src/lib/vibe64CodexInteractionState.js";

describe("vibe64CodexInteractionState", () => {
  it("keeps live progress visible without treating it as a workflow lock", () => {
    const conversationLog = {
      activityMessages: [
        {
          id: "progress-1",
          text: "Checking files."
        }
      ]
    };

    expect(codexLiveProgressMessagesVisible(conversationLog)).toBe(true);
    expect(codexInteractionLocksControls({
      codexThinking: false
    })).toBe(false);
  });

  it("locks workflow controls when the server says Codex is still working", () => {
    expect(codexInteractionLocksControls({
      codexThinking: true
    })).toBe(true);
  });
});
