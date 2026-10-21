import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  dashboardReturnPath,
  nextProjectPane,
  openProjectSwitcherProjects,
  projectPaneTabs,
  projectPaneNavigationReady,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  selfTargetAutoSelectProjectTarget
} from "../../src/composables/useVibe64AppPage.js";

describe("Vibe64 app page", () => {
  it("shows only open projects in the project switcher", () => {
    const projects = [
      { runtime: { open: false }, slug: "closed" },
      { runtime: { open: true }, slug: "zulu" },
      { runtime: { open: true }, slug: "alpha" },
      { slug: "unknown" }
    ];

    expect(openProjectSwitcherProjects(projects).map((project) => project.slug)).toEqual([
      "alpha",
      "zulu"
    ]);
    expect(projects.map((project) => project.slug)).toEqual([
      "closed",
      "zulu",
      "alpha",
      "unknown"
    ]);
  });

  it("targets the configured self-target project only when the repro hook is active", () => {
    const projects = [
      { slug: "beepollen" },
      { slug: "vibe64" }
    ];

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toEqual({ slug: "beepollen" });

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: false
      }
    })).toBeNull();

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "beepollen",
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toBeNull();

    expect(selfTargetAutoSelectProjectTarget({
      currentSlug: "vibe64",
      loading: true,
      projects,
      repro: {
        enabled: true,
        projectSlug: "beepollen",
        selfTarget: true
      }
    })).toBeNull();
  });

  it("shows the preview toolbar target with the same pane visibility rule as project navigation", () => {
    expect(previewToolbarTargetVisible({
      chatCollapsed: false,
      mobilePaneLayout: false,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(true);

    expect(previewToolbarTargetVisible({
      chatCollapsed: false,
      mobilePaneLayout: true,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(false);

    expect(previewToolbarTargetVisible({
      chatCollapsed: true,
      mobilePaneLayout: true,
      projectPane: "preview",
      projectPaneNavigationVisible: true
    })).toBe(true);

    expect(previewToolbarTargetVisible({
      chatCollapsed: true,
      mobilePaneLayout: true,
      projectPane: "dashboard",
      projectPaneNavigationVisible: true
    })).toBe(false);
  });

  it("keeps project pane navigation scoped to the selected project", () => {
    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(true);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: true,
      readyProjectSlug: "compas-next"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      selectionReady: false,
      readyProjectSlug: "beepollen"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "",
      selectionReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(false);
  });

  it("adds the current lesson's Lesson pane: a tab on its practice project, the main pane without one", () => {
    const ids = tabs => tabs.map(tab => tab.id);
    expect(ids(projectPaneTabs({ projectSlug: "alpha" }))).toEqual(["preview", "dashboard"]);
    expect(ids(projectPaneTabs({ projectSlug: "" }))).toEqual(["preview", "dashboard"]);
    expect(ids(projectPaneTabs({ projectSlug: "training-abc", lesson: true }))).toEqual(["preview", "dashboard", "lesson"]);
    expect(ids(projectPaneTabs({ projectSlug: "", lesson: true })), "no Preview without a project").toEqual(["lesson", "dashboard"]);
    expect(projectPaneTabs({ projectSlug: "", lesson: true })[0].label).toBe("Lesson");
  });

  it("cycles the phone's next-pane pill through the panes in tab order", () => {
    const practice = projectPaneTabs({ projectSlug: "training-abc", lesson: true });
    expect(nextProjectPane(practice, "lesson")).toMatchObject({ pane: "preview", label: "Preview", ariaLabel: "Go to preview" });
    expect(nextProjectPane(practice, "preview")).toMatchObject({ pane: "dashboard", label: "Dashboard" });
    expect(nextProjectPane(practice, "dashboard")).toMatchObject({ pane: "lesson", label: "Lesson", ariaLabel: "Go to lesson" });
    const lessonOnly = projectPaneTabs({ projectSlug: "", lesson: true });
    expect(nextProjectPane(lessonOnly, "lesson").pane).toBe("dashboard");
    expect(nextProjectPane(lessonOnly, "dashboard").pane).toBe("lesson");
    const plain = projectPaneTabs({ projectSlug: "alpha" });
    expect(nextProjectPane(plain, "preview")).toMatchObject({ pane: "dashboard", ariaLabel: "Go to dashboard" });
    expect(nextProjectPane(plain, "dashboard")).toMatchObject({ pane: "preview", ariaLabel: "Go to preview" });
  });

  it("returns dashboard navigation to the last dashboard route", () => {
    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/files"
    })).toBe("/app/project/beepollen/dashboard/files");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/repository"
    })).toBe("/app/project/beepollen/dashboard/repository");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/other/dashboard/files"
    })).toBe("/app/project/beepollen/dashboard/env");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: ""
    })).toBe("/app/project/beepollen/dashboard/env");
  });

  it("keeps project runtime close available without route-leave shutdown", () => {
    const source = readFileSync(new URL("../../src/composables/useVibe64AppPage.js", import.meta.url), "utf8");

    expect(source).toContain("closeProjectRuntimeForSlug");
    expect(source).toContain("PROJECT_RUNTIME_CLOSE_API_PATH");
    expect(source).toContain("PROJECT_RUNTIME_OPEN_API_PATH");
    expect(source).not.toContain("onBeforeRouteLeave");
    expect(source).not.toContain("project-route-leave");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("pagehide");
  });

  it("matches project runtime closed realtime events for the active project", () => {
    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "alpha",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(true);

    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "beta",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(false);

    expect(projectRuntimeClosedPayloadMatches({
      action: "runtime-closed",
      projectSlug: "alpha",
      runtime: {
        open: true
      }
    }, "alpha")).toBe(false);

    expect(projectRuntimeClosedPayloadMatches({
      projectSlug: "alpha",
      runtime: {
        open: false
      }
    }, "alpha")).toBe(false);
  });

  it("stays on a deleted practice project's page so its gate shows the deleted notice", () => {
    const deleting = { action: "runtime-closed", projectSlug: "alpha", runtime: { open: false }, runtimeCloseReason: "project-delete" };
    expect(projectRuntimeClosedPayloadMatches(deleting, "alpha", { practice: true })).toBe(false);
    // An ordinary project's delete and a practice project's ordinary close still leave the page.
    expect(projectRuntimeClosedPayloadMatches(deleting, "alpha")).toBe(true);
    expect(projectRuntimeClosedPayloadMatches({ ...deleting, runtimeCloseReason: "project-close" }, "alpha", { practice: true })).toBe(true);
  });
});
