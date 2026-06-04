import { describe, expect, it } from "vitest";

import {
  createStudioTerminalRenderOutputFilter
} from "../../src/lib/studioTerminalRenderOutput.js";

describe("studioTerminalRenderOutput", () => {
  it("removes DECRQM mode-report requests before xterm rendering", () => {
    const filter = createStudioTerminalRenderOutputFilter();

    expect(filter.filter("before\u001b[?2026$pafter")).toBe("beforeafter");
  });

  it("handles DECRQM requests split across websocket chunks", () => {
    const filter = createStudioTerminalRenderOutputFilter();

    expect(filter.filter("before\u001b[?202")).toBe("before");
    expect(filter.filter("6$pafter")).toBe("after");
  });

  it("preserves non-DECRQM ANSI sequences, including split sequences", () => {
    const filter = createStudioTerminalRenderOutputFilter();

    expect(filter.filter("before\u001b[31")).toBe("before");
    expect(filter.filter("mred\u001b[0m\u001b[2;1H")).toBe("\u001b[31mred\u001b[0m\u001b[2;1H");
  });
});
