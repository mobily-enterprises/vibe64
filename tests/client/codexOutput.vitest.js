import { describe, expect, it } from "vitest";
import {
  stripTerminalControlSequences
} from "../../src/lib/codexOutput.js";

describe("codexOutput terminal utilities", () => {
  it("strips terminal control sequences without parsing AI responses", () => {
    expect(stripTerminalControlSequences("\u001B[31mhello\u001B[0m")).toBe("hello");
  });
});
