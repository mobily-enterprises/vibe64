import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTerminalPolicyEngine
} from "../../src/lib/vibe64TerminalPolicies.js";

describe("Vibe64 terminal policies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs named actions once per terminal session", () => {
    const expand = vi.fn();
    const engine = createTerminalPolicyEngine({
      actions: { expand },
      currentSessionId: () => "terminal-1",
      policies: [{
        action: "expand",
        id: "expand-on-error",
        on: "error"
      }]
    });

    engine.handle({ sessionId: "terminal-1", type: "error" });
    engine.handle({ sessionId: "terminal-1", type: "error" });

    expect(expand).toHaveBeenCalledTimes(1);
  });

  it("cancels delayed actions when the session changes", async () => {
    let sessionId = "terminal-1";
    const hide = vi.fn();
    const engine = createTerminalPolicyEngine({
      actions: { hide },
      currentSessionId: () => sessionId,
      policies: [{
        actions: [{
          delayMs: 100,
          type: "hide"
        }],
        id: "hide-on-success",
        on: "exit",
        when: (event) => event.exitCode === 0
      }]
    });

    engine.handle({
      exitCode: 0,
      sessionId,
      type: "exit"
    });
    sessionId = "terminal-2";
    await vi.advanceTimersByTimeAsync(100);

    expect(hide).not.toHaveBeenCalled();
  });
});
