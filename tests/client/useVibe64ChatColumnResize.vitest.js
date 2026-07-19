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
      max: 508,
      min: 320
    };

    expect(vibe64ChatColumnWidthForKey("ArrowLeft", 400, bounds)).toBe(384);
    expect(vibe64ChatColumnWidthForKey("ArrowRight", 500, bounds)).toBe(508);
    expect(vibe64ChatColumnWidthForKey("Home", 400, bounds)).toBe(320);
    expect(vibe64ChatColumnWidthForKey("End", 400, bounds)).toBe(508);
    expect(vibe64ChatColumnWidthForKey("Enter", 400, bounds)).toBeNull();
  });

  it("keeps the active separator style scoped away from the page body", () => {
    const filename = "src/components/studio/Vibe64SessionPanel.vue";
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
  });
});
