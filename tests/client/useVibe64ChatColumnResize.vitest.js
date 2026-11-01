import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compileStyle, parse } from "@vue/compiler-sfc";
import {
  VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX,
  VIBE64_CHAT_COLUMN_STORAGE_KEY,
  constrainVibe64ChatColumnWidth,
  vibe64ChatColumnBounds,
  vibe64ChatColumnWidthForKey
} from "../../src/composables/useVibe64ChatColumnResize.js";

describe("useVibe64ChatColumnResize", () => {
  it("keeps both sides useful across practical desktop widths", () => {
    expect(vibe64ChatColumnBounds(1_600)).toEqual({
      max: 720,
      min: 320
    });
    expect(vibe64ChatColumnBounds(1_000)).toEqual({
      max: 508,
      min: 320
    });
    expect(vibe64ChatColumnBounds(700)).toEqual({
      max: 320,
      min: 320
    });
  });

  it("restores only a numeric width and clamps it to the supported range", () => {
    expect(constrainVibe64ChatColumnWidth(null)).toBe(
      VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX
    );
    expect(constrainVibe64ChatColumnWidth("500")).toBe(
      VIBE64_CHAT_COLUMN_DEFAULT_WIDTH_PX
    );
    expect(constrainVibe64ChatColumnWidth(100)).toBe(320);
    expect(constrainVibe64ChatColumnWidth(900)).toBe(720);
    expect(VIBE64_CHAT_COLUMN_STORAGE_KEY).toBe(
      "vibe64:studio-chat-column-width"
    );
  });

  it("supports precise keyboard resizing without crossing the current bounds", () => {
    const bounds = {
      max: 620,
      min: 320
    };

    expect(vibe64ChatColumnWidthForKey("ArrowLeft", 600, bounds)).toBe(584);
    expect(vibe64ChatColumnWidthForKey("ArrowRight", 610, bounds)).toBe(620);
    expect(vibe64ChatColumnWidthForKey("Home", 600, bounds)).toBe(320);
    expect(vibe64ChatColumnWidthForKey("End", 600, bounds)).toBe(620);
    expect(vibe64ChatColumnWidthForKey("Enter", 600, bounds)).toBeNull();
  });

  it("keeps the active separator style scoped away from the page body", () => {
    const filename = "src/components/studio/Vibe64SessionFrame.vue";
    const descriptor = parse(readFileSync(filename, "utf8"), { filename }).descriptor;
    const style = descriptor.styles[0];
    const result = compileStyle({
      filename,
      id: "data-v-chat-resize-test",
      scoped: style.scoped,
      source: style.content
    });

    expect(result.errors).toEqual([]);
    expect(result.code).toContain(
      ".studio-ai-sessions__chat-column-separator--resizing[data-v-chat-resize-test]::before"
    );
    expect(result.code).not.toMatch(
      /body\.studio-home-chat-column-resizing\s*\{[^}]*background:/u
    );
    expect(result.code).not.toMatch(
      /body\.studio-home-chat-column-resizing\s*\{[^}]*width:/u
    );
    expect(result.code).not.toContain("body.studio-home-chat-column-resizing");
    expect(result.code).toMatch(
      /studio-ai-sessions--resizing[^}]*cursor:\s*col-resize/u
    );
  });

  it("coalesces drag layout updates and never writes inherited width state on body", () => {
    const source = readFileSync(
      "src/composables/useVibe64ChatColumnResize.js",
      "utf8"
    );

    expect(source).toContain("window.requestAnimationFrame(flushLayoutWidth)");
    expect(source).toContain("document.querySelector(\".studio-home-shell-heading\")");
    expect(source).not.toContain("document.body.style.setProperty");
    const moveResizeStart = source.indexOf("function moveResize");
    const moveResizeEnd = source.indexOf("function startResize", moveResizeStart);
    const moveResizeSource = source.slice(moveResizeStart, moveResizeEnd);
    expect(moveResizeStart).toBeGreaterThanOrEqual(0);
    expect(moveResizeEnd).toBeGreaterThan(moveResizeStart);
    expect(moveResizeSource).toBeTruthy();
    expect(moveResizeSource).not.toContain("preferredWidth.value =");
  });

  it("keeps the active chat pane on the same resizable column as its separator", () => {
    const source = readFileSync(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue",
      "utf8"
    );

    expect(source).toMatch(
      /@media \(min-width: 981px\)[\s\S]*\.studio-autopilot\s*\{[\s\S]*var\(--studio-home-chat-column-width/u
    );
  });

  it("does not wrap the active Studio panes in a shell-level horizontal gutter", () => {
    const source = readFileSync(
      "src/components/StudioAppShellLayout.vue",
      "utf8"
    );

    expect(source).toMatch(
      /body\.studio-home-shell-active \.shell-layout__content[\s\S]*padding-left:\s*0;[\s\S]*padding-right:\s*0;/u
    );
  });

  it("contains chat chrome and its icon-only Save action", () => {
    const filename = "src/components/studio/vibe64-session/Vibe64AutopilotView.vue";
    const source = readFileSync(filename, "utf8");
    const descriptor = parse(source, { filename }).descriptor;
    const style = descriptor.styles[0];
    const result = compileStyle({
      filename,
      id: "data-v-chat-containment-test",
      scoped: style.scoped,
      source: style.content
    });

    expect(result.errors).toEqual([]);
    expect(result.code).toContain("container-name: studio-chat-pane");
    expect(result.code).toMatch(/studio-autopilot__session-header[^}]*box-sizing:\s*border-box/u);
    expect(result.code).toMatch(/studio-autopilot__composer[^}]*box-sizing:\s*border-box/u);
    expect(result.code).toMatch(/studio-autopilot__project-panel[^}]*contain:\s*strict/u);
    expect(source).toContain('class="studio-autopilot__save-work"');
    expect(source).toMatch(/class="studio-autopilot__save-work"[\s\S]*?\n\s+icon\n/u);
    expect(source).toContain('class="studio-autopilot__save-symbol" aria-hidden="true"');
    expect(source).not.toContain("studio-autopilot__save-work-label");
    expect(source).not.toContain("Answer the assistant's questions");
  });

  // The transcript's own containment, parsing bounds and scroll work belong to
  // JSKIT's conversation package and its tests; the view only must not deep-watch.
  it("bounds the view's live scroll work without deep watchers", () => {
    const view = readFileSync(
      "src/composables/useVibe64AutopilotView.js",
      "utf8"
    );

    expect(view).not.toContain("}, { deep: true });");
  });

  it("mounts only the visible project tool instead of retaining every heavy pane", () => {
    const source = readFileSync(
      "src/composables/useVibe64SessionToolPane.js",
      "utf8"
    );

    expect(source).not.toContain("mountedRightPaneTabs");
    expect(source).toMatch(
      /function rightPaneTabMounted[\s\S]*return rightPaneTab\.value === String\(tabId \|\| ""\);/u
    );
  });
});
