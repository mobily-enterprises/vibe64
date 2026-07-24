import { describe, expect, it, vi } from "vitest";
import {
  createTerminalMatcherEngine
} from "../../src/lib/vibe64TerminalMatchers.js";

describe("Vibe64 terminal matchers", () => {
  it("does not normalize terminal history when no matchers are configured", () => {
    const engine = createTerminalMatcherEngine();
    const output = {
      toString() {
        throw new Error("terminal history should remain untouched");
      }
    };

    expect(engine.inspect({
      output,
      sessionId: "terminal-1",
      source: "append"
    })).toEqual([]);
  });

  it("matches plain terminal content that spans streamed chunks", () => {
    const onMatch = vi.fn();
    const engine = createTerminalMatcherEngine({
      matchers: [{
        id: "ready-marker",
        pattern: "READY NOW"
      }],
      onMatch
    });

    expect(engine.inspect({
      output: "Service REA",
      sessionId: "terminal-1",
      source: "append"
    })).toEqual([]);
    const matches = engine.inspect({
      output: "Service READY NOW",
      outputVersion: 2,
      sessionId: "terminal-1",
      source: "append"
    });

    expect(matches).toEqual([expect.objectContaining({
      matcher: "ready-marker",
      outputVersion: 2,
      text: "READY NOW",
      transcriptOffset: 8
    })]);
    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("does not emit a once matcher again after snapshot replay", () => {
    const onMatch = vi.fn();
    const engine = createTerminalMatcherEngine({
      matchers: [{
        id: "device-code",
        pattern: "ABCD-1234"
      }],
      onMatch
    });
    const context = {
      output: "Code: \u001b[1mABCD-1234\u001b[0m",
      sessionId: "terminal-1"
    };

    engine.inspect(context);
    engine.inspect({
      ...context,
      source: "snapshot"
    });

    expect(onMatch).toHaveBeenCalledTimes(1);
  });

  it("resets matcher completion for a new terminal session", () => {
    const onMatch = vi.fn();
    const engine = createTerminalMatcherEngine({
      matchers: [{
        id: "ready",
        pattern: "READY"
      }],
      onMatch
    });

    engine.inspect({ output: "READY", sessionId: "terminal-1" });
    engine.inspect({ output: "READY", sessionId: "terminal-2" });

    expect(onMatch).toHaveBeenCalledTimes(2);
  });

  it("allows repeating matchers to inspect a replaced transcript", () => {
    const onMatch = vi.fn();
    const engine = createTerminalMatcherEngine({
      matchers: [{
        id: "prompt",
        once: false,
        pattern: "Continue?"
      }],
      onMatch
    });

    engine.inspect({
      output: "Continue?",
      sessionId: "terminal-1",
      source: "snapshot"
    });
    engine.inspect({
      output: "Continue?",
      sessionId: "terminal-1",
      source: "replacement"
    });

    expect(onMatch).toHaveBeenCalledTimes(2);
  });
});
