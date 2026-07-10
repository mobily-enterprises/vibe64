import { describe, expect, it } from "vitest";

import {
  agentInteractionLocksControls
} from "../../src/lib/vibe64AgentInteractionState.js";

describe("vibe64AgentInteractionState", () => {
  it("does not lock workflow controls without active assistant work", () => {
    expect(agentInteractionLocksControls({
      agentThinking: false
    })).toBe(false);
  });

  it("locks workflow controls when the server says the assistant is still working", () => {
    expect(agentInteractionLocksControls({
      agentThinking: true
    })).toBe(true);
  });
});
