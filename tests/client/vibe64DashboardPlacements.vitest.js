import { describe, expect, it } from "vitest";
import {
  mdiFileCogOutline,
  mdiHistory,
  mdiTune
} from "@mdi/js";

import getPlacements from "../../src/placement.js";

describe("Vibe64 dashboard placements", () => {
  it("links dashboard tabs through the public project route namespace", () => {
    const dashboardLinks = getPlacements()
      .filter((placement) => (
        placement?.kind === "link" &&
        placement?.owner === "app-dashboard" &&
        placement?.target === "page.section-nav"
      ));

    const labels = dashboardLinks.map((placement) => placement.props.label);
    expect(labels).toHaveLength(3);
    expect(labels).toEqual(expect.arrayContaining([
      "Runtime Config",
      "Session History",
      "Setup"
    ]));
    expect(labels).not.toContain("Configure");
    expect(labels).not.toContain("Github repository");
    expect(labels).not.toContain("Run");
    expect(labels).not.toContain("Publish");
    expect(dashboardLinks.map((placement) => [placement.props.label, placement.props.icon])).toEqual(expect.arrayContaining([
      ["Runtime Config", mdiFileCogOutline],
      ["Session History", mdiHistory],
      ["Setup", mdiTune]
    ]));
    for (const placement of dashboardLinks) {
      expect(placement.props.scopedSuffix).toMatch(/^\/project\/\[slug\]\/dashboard\//u);
      expect(placement.props.unscopedSuffix).toMatch(/^\/project\/\[slug\]\/dashboard\//u);
      expect(placement.props.scopedSuffix).not.toMatch(/^\/\[slug\]\//u);
      expect(placement.props.unscopedSuffix).not.toMatch(/^\/\[slug\]\//u);
    }
  });
});
