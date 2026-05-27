import { describe, expect, it } from "vitest";

import {
  terminalDisplayWriteState
} from "../../src/composables/useStudioTerminal.js";
import {
  stripStudioContextBlocksForDisplay
} from "../../src/lib/codexOutput.js";
import {
  INVALID_TERMINAL_SIZE_ERROR,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "../../src/lib/studioTerminalSize.js";

describe("useStudioTerminal", () => {
  it("does not report transient terminal sizes that the PTY server rejects", () => {
    expect(reportableTerminalSize({
      cols: 19,
      rows: 30
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: 80,
      rows: 4
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: Number.NaN,
      rows: 30
    })).toBeNull();
  });

  it("normalizes valid terminal sizes before sending resize messages", () => {
    expect(reportableTerminalSize({
      cols: 120.8,
      rows: 32.4
    })).toEqual({
      cols: 120,
      rows: 32
    });
  });

  it("recognizes resize failures as non-fatal terminal messages", () => {
    expect(terminalResizeErrorMessage(INVALID_TERMINAL_SIZE_ERROR)).toBe(true);
    expect(terminalResizeErrorMessage("Terminal stream failed.")).toBe(false);
  });

  it("can keep raw terminal output while hiding streamed Studio context from display", () => {
    let renderedOutput = "";
    let renderedOffset = 0;

    function apply(rawOutput) {
      const update = terminalDisplayWriteState({
        displayOutput: stripStudioContextBlocksForDisplay(rawOutput),
        renderedOffset,
        renderedOutput
      });
      renderedOutput = update.output;
      renderedOffset = update.offset;
      return update;
    }

    expect(apply("Intro\n").chunk).toBe("Intro\n");
    expect(apply("Intro\n[[VIBE64_CONTEXT_START]]\nhidden prompt")).toMatchObject({
      chunk: "",
      output: "Intro\n"
    });
    expect(apply([
      "Intro",
      "[[VIBE64_CONTEXT_START]]",
      "hidden prompt",
      "[[VIBE64_CONTEXT_END]]",
      "Visible result"
    ].join("\n"))).toMatchObject({
      chunk: "\nVisible result",
      output: "Intro\n\nVisible result"
    });
  });
});
