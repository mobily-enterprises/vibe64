import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  dashboardReturnPath,
  projectPaneNavigationReady,
  projectRuntimeClosedPayloadMatches,
  previewToolbarTargetVisible,
  selfTargetAutoSelectProjectTarget
} from "../../src/composables/useVibe64AppPage.js";

describe("Vibe64 app page", () => {
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

  it("keeps project pane navigation scoped to the project that passed setup gates", () => {
    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      projectTypeReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(true);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      projectTypeReady: true,
      readyProjectSlug: "compas-next"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "beepollen",
      projectTypeReady: false,
      readyProjectSlug: "beepollen"
    })).toBe(false);

    expect(projectPaneNavigationReady({
      projectSlug: "",
      projectTypeReady: true,
      readyProjectSlug: "beepollen"
    })).toBe(false);
  });

  it("returns dashboard navigation to the last dashboard route", () => {
    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/editor"
    })).toBe("/app/project/beepollen/dashboard/editor");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/beepollen/dashboard/diff"
    })).toBe("/app/project/beepollen/dashboard/diff");

    expect(dashboardReturnPath({
      dashboardBasePath: "/app/project/beepollen/dashboard",
      lastDashboardRoutePath: "/app/project/other/dashboard/editor"
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
});
