import { describe, expect, it } from "vitest";

import {
  normalizeRoutePath,
  routePathContainsSection
} from "../../src/lib/routeActiveState.js";

describe("route active state", () => {
  it("normalizes empty, root, and trailing-slash paths", () => {
    expect(normalizeRoutePath("")).toBe("/");
    expect(normalizeRoutePath("/")).toBe("/");
    expect(normalizeRoutePath("/app/project/demo/dashboard/history/")).toBe("/app/project/demo/dashboard/history");
  });

  it("matches a section route and its nested children", () => {
    expect(routePathContainsSection(
      "/app/project/demo/dashboard/history",
      "/app/project/demo/dashboard/history"
    )).toBe(true);
    expect(routePathContainsSection(
      "/app/project/demo/dashboard/history/session-1",
      "/app/project/demo/dashboard/history"
    )).toBe(true);
  });

  it("does not mark root or sibling routes as active", () => {
    expect(routePathContainsSection("/app/project/demo/dashboard/history", "/")).toBe(false);
    expect(routePathContainsSection(
      "/app/project/demo/dashboard/history-extra",
      "/app/project/demo/dashboard/history"
    )).toBe(false);
  });
});
