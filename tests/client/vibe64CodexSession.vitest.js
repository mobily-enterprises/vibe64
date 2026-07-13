import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/Vibe64CodexSession.vue");

describe("Vibe64CodexSession", () => {
  it("composes Codex behavior around the canonical terminal element", () => {
    const source = readFileSync(componentPath, "utf8");

    expect(source).toContain("<Vibe64Terminal");
    expect(source).toContain("useVibe64Terminal");
    expect(source).toContain("createWebSocketTerminalDriver");
    expect(source).not.toContain("codex-terminal__host");
    expect(source).not.toContain("loadXtermModules");
  });

  it("detaches an attached Codex session on unmount without deleting it", () => {
    const source = readFileSync(componentPath, "utf8");
    const unmountHandler = source.match(/onBeforeUnmount\(\(\) => \{(?<body>[\s\S]*?)\n\}\);/u)?.groups?.body || "";

    expect(unmountHandler).toContain("detachTerminal()");
    expect(unmountHandler).not.toContain("closeTerminal()");
  });
});
