import { describe, expect, it } from "vitest";

import {
  codexInteractionLocksControls
} from "../../src/lib/vibe64CodexInteractionState.js";

describe("vibe64CodexInteractionState", () => {
  it("does not lock workflow controls without active Codex work", () => {
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
