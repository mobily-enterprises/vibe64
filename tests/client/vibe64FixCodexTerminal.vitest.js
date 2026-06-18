import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/Vibe64FixCodexTerminal.vue");

describe("Vibe64FixCodexTerminal", () => {
  it("keeps the terminal transcript visible after Fix Codex exits", () => {
    const source = readFileSync(componentPath, "utf8");

    expect(source).toContain("terminalExitMessage");
    expect(source).toContain("Review the transcript");
    expect(source).not.toContain("disposeTerminalDisplay");
  });
});
