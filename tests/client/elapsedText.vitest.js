// How long something has run, as the AI task window and other running-step lines say it: whole seconds under a
// minute, whole minutes under an hour, then hours and minutes. A time before its start reads as none.
import { describe, expect, it } from "vitest";
import { elapsedText } from "../../packages/vibe64-core/src/shared/elapsedText.js";

describe("elapsed time", () => {
  it.each([
    [-5_000, "0 s"],
    [0, "0 s"],
    [59_999, "59 s"],
    [60_000, "1 min"],
    [162_000, "2 min"],
    [3_900_000, "1 h 5 min"]
  ])("counts %d ms as %s", (ms, text) => {
    expect(elapsedText(ms)).toBe(text);
  });
});
