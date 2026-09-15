import { describe, expect, it } from "vitest";

import {
  scrollDistanceFromBottom,
  scrollElementNearBottom
} from "@jskit-ai/assistant-core/shared/conversation";

describe("scroll follow state", () => {
  it("measures distance from the bottom of a scroll container", () => {
    expect(scrollDistanceFromBottom({
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 740
    })).toBe(140);
  });

  it("treats near-bottom positions as still following latest content", () => {
    expect(scrollElementNearBottom({
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 834
    })).toBe(true);
    expect(scrollElementNearBottom({
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 820
    })).toBe(false);
    expect(scrollElementNearBottom({
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 832
    })).toBe(true);
    expect(scrollElementNearBottom({
      clientHeight: 320,
      scrollHeight: 1200,
      scrollTop: 831
    })).toBe(false);
  });

  it("handles missing or non-finite element values defensively", () => {
    expect(scrollDistanceFromBottom(null)).toBe(0);
    expect(scrollElementNearBottom({
      clientHeight: Number.NaN,
      scrollHeight: undefined,
      scrollTop: "bad"
    })).toBe(true);
  });
});
