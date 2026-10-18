import { describe, expect, it } from "vitest";
import {
  mdiAccountKeyOutline,
  mdiCogOutline,
  mdiConnection,
  mdiFileCogOutline,
  mdiHeartPulse,
  mdiHistory,
  mdiGithub
} from "@mdi/js";

import getPlacements, {
  uniqueDashboardSectionPlacements
} from "../../src/placement.js";
import {
  VIBE64_ACTIVE_SESSION_NAV_OWNER,
  VIBE64_ACTIVE_SESSION_NAV_TARGET,
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix
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
    expect(labels).toHaveLength(9);
    expect(labels).toEqual(expect.arrayContaining([
      "App access",
      "Env",
      "Health",
      "Integrations",
      "Issues/PR",
      "Project settings",
      "Git log",
      "Incoming changes",
      "Session History"
    ]));
    expect(labels).not.toContain("Configure");
    expect(labels).not.toContain("Github repository");
    expect(labels).not.toContain("Run");
    expect(labels).not.toContain("Session info");
    expect(labels).not.toContain("Publish");
    expect(dashboardLinks.map((placement) => [placement.props.label, placement.props.icon])).toEqual(expect.arrayContaining([
      ["App access", mdiAccountKeyOutline],
      ["Env", mdiFileCogOutline],
      ["Health", mdiHeartPulse],
      ["Integrations", mdiConnection],
      ["Project settings", mdiCogOutline],
      ["Session History", mdiHistory],
      ["Issues/PR", mdiGithub]
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
      ...VIBE64_SESSION_TOOL_DEFINITIONS.filter(tool => tool.navigationScope !== "project")
        .map((tool) => `vibe64.active-session.${tool.id}`)
    ]);
    expect(sessionPlacements.every((placement) => placement.kind === "link")).toBe(true);
    expect(sessionPlacements.every((placement) => typeof placement.when === "function")).toBe(true);
    expect(sessionPlacements[0].props.role).toBe("heading");
    expect(sessionPlacements.slice(1).map((placement) => placement.props.toolId)).toEqual(
      VIBE64_SESSION_TOOL_DEFINITIONS.filter(tool => tool.navigationScope !== "project").map((tool) => tool.id)
    );
    expect(sessionPlacements.slice(1).map((placement) => placement.props.label)).toContain("Session info");
    expect(sessionPlacements.slice(1).map((placement) => placement.props.label)).not.toContain("Git log");
    expect(sessionPlacements.slice(1).map((placement) => [
      placement.props.toolId,
      placement.props.label,
      placement.props.scopedSuffix,
      placement.props.unscopedSuffix
    ])).toEqual(VIBE64_SESSION_TOOL_DEFINITIONS.filter(tool => tool.navigationScope !== "project").map((tool) => [
      tool.id,
      tool.label,
      `/project/[slug]${vibe64SessionToolDashboardSuffix(tool.id)}`,
      `/project/[slug]${vibe64SessionToolDashboardSuffix(tool.id)}`
    ]));
  });

  it("gives the real Dashboard sections the guide ids a lesson teacher can point at", () => {
    const guides = Object.fromEntries(getPlacements()
      .filter((placement) => placement?.props?.toolId)
      .map((placement) => [placement.props.toolId, placement.props.guideId]));
    expect(guides).toEqual({ info: "session-info", changes: "changes", repository: "git-log", editor: "files",
      database: "database", system: "architecture", "ai-terminal": undefined });
  });

  it("shows a practice lesson only the Dashboard sections and session tools with lesson actions", () => {
    const placements = getPlacements();
    const sectionLinks = placements.filter(placement => placement?.kind === "link" &&
      placement?.owner === "app-dashboard" && placement?.target === "page.section-nav");
    const sessionLinks = placements.filter(placement => placement?.owner === VIBE64_ACTIVE_SESSION_NAV_OWNER &&
      placement?.target === VIBE64_ACTIVE_SESSION_NAV_TARGET && placement.props?.toolId);
    const projectContext = { repositoryMode: "github", githubRepository: "owner/repo", repository: { provider: "github" } };
    const lessonTools = ["info", "changes", "editor", "database", "system"].map(id => ({ id }));
    const working = { projectContext, activeSessionNav: { visible: true, tools: lessonTools } };
    const lesson = { projectContext, lessonDashboard: true,
      activeSessionNav: { visible: true, lesson: true, tools: lessonTools } };
    const shown = (context) => sectionLinks.filter(placement => placement.when(context) !== false &&
      placement.props.visibleWhen?.(context) !== false).map(placement => placement.props.label).sort();

    expect(shown(lesson)).toEqual(["Env", "Git log", "Health", "Session History"]);
    // Working keeps every section it showed before.
    expect(shown(working)).toEqual(expect.arrayContaining(["App access", "Env", "Git log", "Health", "Integrations",
      "Project settings", "Session History"]));
    for (const placement of sectionLinks) {
      expect(typeof placement.when).toBe("function");
      expect(placement.when(lesson)).toBe(placement.props.visibleWhen(lesson));
    }
    // AI Terminal has no lesson URL, so a lesson never offers it.
    const offered = (context) => sessionLinks.filter(placement => placement.when(context)).map(placement => placement.props.toolId);
    expect(offered(lesson)).toEqual(["info", "changes", "editor", "database", "system"]);
    expect(offered({ ...working, activeSessionNav: { visible: true, tools: [...lessonTools, { id: "ai-terminal" }] } }))
      .toContain("ai-terminal");
  });
});
