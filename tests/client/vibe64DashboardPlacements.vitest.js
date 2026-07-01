import { describe, expect, it } from "vitest";
import {
  mdiFileCogOutline,
  mdiHistory,
  mdiTune
} from "@mdi/js";

import getPlacements, {
  uniqueDashboardSectionPlacements
} from "../../src/placement.js";
import {
  VIBE64_ACTIVE_SESSION_NAV_OWNER,
  VIBE64_ACTIVE_SESSION_NAV_TARGET,
  VIBE64_SESSION_TOOL_DEFINITIONS
} from "../../src/lib/vibe64SessionToolDefinitions.js";

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
      "Env",
      "Session History",
      "Setup"
    ]));
    expect(labels).not.toContain("Configure");
    expect(labels).not.toContain("Github repository");
    expect(labels).not.toContain("Run");
    expect(labels).not.toContain("Publish");
    expect(dashboardLinks.map((placement) => [placement.props.label, placement.props.icon])).toEqual(expect.arrayContaining([
      ["Env", mdiFileCogOutline],
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

  it("keeps one dashboard section link per destination", () => {
    const placements = uniqueDashboardSectionPlacements([
      {
        id: "dashboard.env.primary",
        kind: "link",
        order: 300,
        owner: "app-dashboard",
        props: {
          label: "Env",
          scopedSuffix: "/project/[slug]/dashboard/env"
        },
        target: "page.section-nav"
      },
      {
        id: "dashboard.env.generated",
        kind: "link",
        order: 350,
        owner: "app-dashboard",
        props: {
          label: "Env",
          scopedSuffix: "/dashboard/env"
        },
        target: "page.section-nav"
      },
      {
        id: "dashboard.publish",
        kind: "link",
        order: 400,
        owner: "app-dashboard",
        props: {
          label: "Publish",
          scopedSuffix: "/project/[slug]/dashboard/publish"
        },
        target: "page.section-nav"
      }
    ]);

    expect(placements.map((placement) => placement.id)).toEqual([
      "dashboard.env.primary",
      "dashboard.publish"
    ]);
  });

  it("places session-owned tools in their own dashboard rail target", () => {
    const sessionPlacements = getPlacements()
      .filter((placement) => (
        placement?.owner === VIBE64_ACTIVE_SESSION_NAV_OWNER &&
        placement?.target === VIBE64_ACTIVE_SESSION_NAV_TARGET
      ));

    expect(sessionPlacements.map((placement) => placement.id)).toEqual([
      "vibe64.active-session.heading",
      ...VIBE64_SESSION_TOOL_DEFINITIONS.map((tool) => `vibe64.active-session.${tool.id}`)
    ]);
    expect(sessionPlacements.every((placement) => placement.kind === "link")).toBe(true);
    expect(sessionPlacements.every((placement) => typeof placement.when === "function")).toBe(true);
    expect(sessionPlacements[0].props.role).toBe("heading");
    expect(sessionPlacements.slice(1).map((placement) => placement.props.toolId)).toEqual(
      VIBE64_SESSION_TOOL_DEFINITIONS.map((tool) => tool.id)
    );
  });
});
