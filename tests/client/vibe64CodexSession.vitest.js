import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/Vibe64CodexSession.vue");

describe("Vibe64CodexSession", () => {
  it("composes Codex behavior around the canonical terminal element", () => {
    const source = readFileSync(componentPath, "utf8");

    expect(source).toContain("<Vibe64InteractiveTerminal");
    expect(source).toContain("useVibe64Terminal");
    expect(source).toContain("createWebSocketTerminalDriver");
    expect(source).toContain('@clean-exit="closeTerminal"');
    expect(source).not.toContain(":collapsible");
    expect(source).not.toContain("codex-terminal__host");
    expect(source).not.toContain("loadXtermModules");
  });

  it("detaches an attached Codex session on unmount without deleting it", () => {
    const source = readFileSync(componentPath, "utf8");
    const unmountHandler = source.match(/onBeforeUnmount\(\(\) => \{(?<body>[\s\S]*?)\n\}\);/u)?.groups?.body || "";

    expect(unmountHandler).toContain("detachTerminal()");
    expect(unmountHandler).not.toContain("closeTerminal()");
  });

  it("shares the agent terminal panels and shows one start icon for panel and button", () => {
    const source = readFileSync(componentPath, "utf8");
    const native = readFileSync(path.resolve("src/components/studio/Vibe64NativeAgentSession.vue"), "utf8");
    for (const file of [source, native]) {
      expect(file).toContain("<Vibe64AgentTerminalStartPanel");
      expect(file).toContain("<Vibe64AgentTerminalDropOverlay");
      expect(file).toContain("useVibe64AgentTerminalDisplay(props,");
    }
    expect(source).not.toContain("terminalStartButtonIcon");
    expect(source).toMatch(/terminalStartIcon = computed\(\(\) => \(\s*terminalReconnectRequired\.value \|\|/u);
    expect(source).not.toContain("handleTerminalAttachmentDrag");
    expect(source).toContain('@dragenter.prevent="terminalAttachmentsEnabled && handleAttachmentDragEnter($event)"');
  });
});
