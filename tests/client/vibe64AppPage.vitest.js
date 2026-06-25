import { describe, expect, it } from "vitest";

import {
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
});
