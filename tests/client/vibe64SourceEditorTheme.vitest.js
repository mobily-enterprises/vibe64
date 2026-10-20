import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The Files editor's line-number gutter is sticky: when a long line scrolls
// sideways (a learner editing one line on a phone), the code passes under it.
// A translucent gutter showed that code through the numbers.
describe("Files editor theme", () => {
  it("paints the sticky gutter on an opaque surface", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const gutter = editor.match(/"\.cm-gutters": \{([^}]*)\}/u)?.[1] || "";
    expect(gutter).toMatch(/backgroundColor: "rgb\(var\(--v-theme-surface\)\)"/u);
    expect(gutter).toMatch(/backgroundImage: "linear-gradient\(rgba\(var\(--v-theme-surface-variant\), 0\.38\)/u);
    expect(gutter).not.toMatch(/backgroundColor: "rgba\(/u);
  });
});
