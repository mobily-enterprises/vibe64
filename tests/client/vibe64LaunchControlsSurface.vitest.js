import { describe, expect, it } from "vitest";

import {
  launchPreviewAddressNavigationUrl,
  launchPreviewReloadBaseUrl,
  launchPreviewEmptyText,
  launchPreviewIssue,
  launchPreviewNotice,
  launchToolbarDockShouldShow,
  previewAddressDisplayText,
  previewRouteFromUrl,
  previewUrlForRoute
} from "../../src/composables/useVibe64LaunchControlsSurface.js";

describe("Vibe64 launch controls surface", () => {
  it("keeps launch lifecycle text stable during background polling", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      launchStarting: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      launchStarting: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      previewState: "starting"
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      terminalIsRunning: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true
    })).toBe("Loading preview targets.");

    expect(launchPreviewEmptyText({
      previewAutoStartPreparing: true
    })).toBe("Preparing preview.");
  });

  it("surfaces server preview failures before generic loading state", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      previewMessage: "No launch preview proxy port is available.",
      previewState: "failed"
    })).toBe("No launch preview proxy port is available.");
  });

  it("treats a starting server state as preparing preview", () => {
    expect(launchPreviewEmptyText({
      loading: false,
      previewState: "starting"
    })).toBe("Preparing preview.");
  });

  it("uses neutral copy when no launch state is available yet", () => {
    expect(launchPreviewEmptyText()).toBe("Preview will appear here when it is ready.");
  });

  it("surfaces a manual start state when an embedded target can be launched", () => {
    expect(launchPreviewEmptyText({
      previewManualStartAvailable: true
    })).toBe("Preview is ready to start.");
  });

  it("surfaces server restart preview recovery", () => {
    expect(launchPreviewNotice({
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      state: "failed"
    })).toEqual({
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      title: "Preview could not be opened"
    });
  });

  it("surfaces stale server-side preview recovery as non-blocking attention", () => {
    expect(launchPreviewNotice({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      state: "stale"
    })).toBeNull();

    expect(launchPreviewIssue({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      state: "stale"
    })).toEqual({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      title: "Preview may be stale"
    });
  });

  it("surfaces stopped preview processes as diagnostics", () => {
    expect(launchPreviewNotice({
      message: "The preview process exited with code 1.",
      state: "failed"
    })).toEqual({
      message: "The preview process exited with code 1.",
      title: "Preview could not be opened"
    });
  });

  it("routes stopped preview processes through toolbar attention", () => {
    expect(launchPreviewIssue({
      message: "The preview process exited with code 0.",
      state: "stopped"
    })).toEqual({
      message: "The preview process exited with code 0.",
      title: "Preview stopped"
    });
  });

  it("does not duplicate embedded preview diagnostics with the toolbar dock", () => {
    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      previewIssueVisible: true,
      terminalVisible: true
    })).toBe(true);

    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      embeddedTerminalVisible: true,
      terminalVisible: true
    })).toBe(true);

    expect(launchToolbarDockShouldShow({
      embeddedPreview: false,
      terminalDockVisible: true,
      terminalVisible: true
    })).toBe(true);
  });

  it("keeps the toolbar dock available for preview attention", () => {
    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      previewIssueVisible: true
    })).toBe(true);
  });

  it("maps manual preview reloads to the current embedded route", () => {
    expect(launchPreviewReloadBaseUrl({
      baseUrl: "http://127.0.0.1:4188/home?vibe64_reload=1",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      visitedUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files"
    })).toBe("http://127.0.0.1:4188/jobs/42?tab=docs#files");

    expect(launchPreviewReloadBaseUrl({
      baseUrl: "https://preview.example.test/home?vibe64_reload=1",
      displayBaseUrl: "https://preview.example.test/home",
      visitedUrl: "https://preview.example.test/settings?tab=users#invite"
    })).toBe("https://preview.example.test/settings?tab=users#invite");

    expect(launchPreviewReloadBaseUrl({
      baseUrl: "https://new-preview.example.test/home?vibe64_reload=1",
      displayBaseUrl: "https://new-preview.example.test/home",
      visitedUrl: "https://old-preview.example.test/admin/jobs/42?tab=docs#files"
    })).toBe("https://new-preview.example.test/admin/jobs/42?tab=docs#files");
  });

  it("stores preview location as a host-independent route", () => {
    expect(previewRouteFromUrl("https://old-preview.example.test/admin/jobs/42?tab=docs#files"))
      .toBe("/admin/jobs/42?tab=docs#files");
    expect(previewRouteFromUrl("/settings/users?tab=access"))
      .toBe("/settings/users?tab=access");

    expect(previewUrlForRoute(
      "/admin/jobs/42?tab=docs#files",
      "https://new-preview.example.test/home?vibe64_reload=1"
    )).toBe("https://new-preview.example.test/admin/jobs/42?tab=docs#files");
  });

  it("shows same-app preview addresses as clean routes", () => {
    expect(previewAddressDisplayText(
      "http://127.0.0.1:4100/?vibe64_preview_token=abc",
      {
        previewBaseUrl: "http://127.0.0.1:4100/?vibe64_preview_token=abc"
      }
    )).toBe("/");

    expect(previewAddressDisplayText(
      "http://127.0.0.1:4100/jobs/42?tab=docs&vibe64_reload=2&vibe64_preview_token=abc#files",
      {
        displayBaseUrl: "http://127.0.0.1:4100/"
      }
    )).toBe("/jobs/42?tab=docs#files");

    expect(previewAddressDisplayText(
      "https://example.test/jobs?vibe64_preview_token=abc",
      {
        displayBaseUrl: "http://127.0.0.1:4100/"
      }
    )).toBe("https://example.test/jobs");
  });

  it("maps entered preview addresses from display URLs to embedded proxy URLs", () => {
    expect(launchPreviewAddressNavigationUrl({
      address: "/jobs/42?tab=docs#files",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home?vibe64_reload=1"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/jobs/42?tab=docs#files"
    });

    expect(launchPreviewAddressNavigationUrl({
      address: "settings/users",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    }).previewUrl).toBe("http://127.0.0.1:4188/settings/users");

    expect(launchPreviewAddressNavigationUrl({
      address: "/jobs/42?tab=docs#files",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home?vibe64_preview_token=abc&vibe64_reload=1"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/jobs/42?tab=docs#files"
    });
  });

  it("allows proxy-origin preview addresses but rejects external origins", () => {
    expect(launchPreviewAddressNavigationUrl({
      address: "http://127.0.0.1:4188/admin",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/admin",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/admin"
    });

    expect(launchPreviewAddressNavigationUrl({
      address: "https://example.com/",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    })).toEqual({
      displayUrl: "",
      error: "Preview URL must stay inside this app.",
      ok: false,
      previewUrl: ""
    });
  });
});
