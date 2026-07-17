import { describe, expect, it } from "vitest";

import {
  defaultPreviewIdentityMode,
  launchPreviewAddressNavigationUrl,
  launchPreviewEmptyText,
  launchPreviewFrameUrl,
  previewFrameLifecycleIdentity,
  previewIdentityFromExchange,
  previewIdentityLabelText,
  previewIdentityLifecycleIdentity,
  previewIdentityTitleText,
  previewLoadingOverlayShouldShow,
  launchPreviewIssue,
  launchPreviewInFlightText,
  launchPreviewNotice,
  launchPreviewStatusText,
  launchToolbarDockShouldShow,
  previewAddressDisplayText,
  previewOpeningOverlayVisible,
  previewRouteFromUrl,
  previewUrlForRoute,
  redactPreviewDebugDetails
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
    })).toBe("Checking preview status.");

    expect(launchPreviewEmptyText({
      previewManualStartAvailable: true
    })).toBe("Preview is ready to start.");
  });

  it("does not call idle auto-start placeholders preparing preview", () => {
    expect(launchPreviewEmptyText({
      previewAutoStartPreparing: true
    })).toBe("Preview will appear here when it is ready.");
  });

  it("surfaces server preview failures before generic loading state", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      previewMessage: "No launch preview proxy port is available.",
      previewState: "failed"
    })).toBe("No launch preview proxy port is available.");
  });

  it("describes launch status loading and failures with attempt numbers", () => {
    expect(launchPreviewStatusText({
      attempt: 2,
      loading: true
    })).toBe("Checking preview status (attempt 2).");

    expect(launchPreviewStatusText({
      attempt: 3,
      loadError: "Log in to Vibe64."
    })).toBe("Preview status request failed (attempt 3).");

    expect(launchPreviewEmptyText({
      launchStatusText: "Preview status request failed (attempt 3).",
      loading: true
    })).toBe("Preview status request failed (attempt 3).");
  });

  it("clears the opening overlay after the iframe load marks the preview URL ready", () => {
    expect(previewOpeningOverlayVisible({
      previewFrameRequestId: 1,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 1,
      previewUrl: "https://preview.example.test/home"
    })).toBe(false);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 2,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 2,
      previewUrl: ""
    })).toBe(false);
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

  it("does not call unavailable embedded launch targets ready to start", () => {
    expect(launchPreviewEmptyText({
      previewManualStartAvailable: false,
      previewStartUnavailableReason: "Install dependencies before running the app."
    })).toBe("Install dependencies before running the app.");
  });

  it("describes the exact embedded preview operation while it is in flight", () => {
    expect(launchPreviewInFlightText({
      embeddedStartTarget: {
        id: "dev",
        label: "Run app"
      },
      launchStarting: true
    })).toBe("Starting preview: Run app.");

    expect(launchPreviewInFlightText({
      activeLaunchTarget: {
        id: "dev",
        label: "Run app"
      },
      terminalIsRunning: true
    })).toBe("Waiting for preview URL from Run app.");

    expect(launchPreviewInFlightText({
      previewDisplayedAddress: "/dashboard",
      previewLoadingOverlayVisible: true,
      previewUrl: "https://preview.example.test/dashboard"
    })).toBe("Loading preview page: /dashboard. The server is ready; the browser is still loading the app.");

    expect(launchPreviewInFlightText({
      previewEmbedUnavailableReason: "HTTP previews cannot be embedded from HTTPS Studio."
    })).toBe("HTTP previews cannot be embedded from HTTPS Studio.");
  });

  it("uses exact in-flight copy ahead of generic preview placeholders", () => {
    expect(launchPreviewEmptyText({
      launchStarting: true,
      previewInFlightText: "Starting preview: Run app."
    })).toBe("Starting preview: Run app.");
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

  it("surfaces launch request failures before server preview state exists", () => {
    const launchError = "Set the public Vibe64 source root in preview options before running Vibe64 Online.";

    expect(launchPreviewIssue({
      launchError,
      state: "idle"
    })).toEqual({
      message: launchError,
      title: "Preview could not be started"
    });
    expect(launchPreviewNotice({
      launchError,
      state: "idle"
    })).toEqual({
      message: launchError,
      title: "Preview could not be started"
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

  it("builds one immutable frame URL for the current route", () => {
    expect(launchPreviewFrameUrl({
      baseUrl: "http://127.0.0.1:4188/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      visitedUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files"
    })).toBe("http://127.0.0.1:4188/jobs/42?tab=docs#files");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://preview.example.test/home",
      displayBaseUrl: "https://preview.example.test/home",
      visitedUrl: "https://preview.example.test/settings?tab=users#invite"
    })).toBe("https://preview.example.test/settings?tab=users#invite");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://new-preview.example.test/home",
      displayBaseUrl: "https://new-preview.example.test/home",
      visitedUrl: "https://old-preview.example.test/admin/jobs/42?tab=docs#files"
    })).toBe("https://new-preview.example.test/admin/jobs/42?tab=docs#files");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://preview.example.test/home?vibe64_preview_token=abc",
      displayBaseUrl: "https://app.example.test/home",
      visitedUrl: "https://app.example.test/jobs/42?tab=docs#files"
    })).toBe("https://preview.example.test/jobs/42?tab=docs&vibe64_preview_token=abc#files");
  });

  it("keeps preview lifecycle identity stable across output-only proxy token changes", () => {
    const lifecycle = {
      launchTargetId: "dev",
      sessionId: "session-1",
      terminalSessionId: "terminal-1"
    };

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=second"
    }));

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).not.toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?tab=users&vibe64_preview_token=first"
    }));

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).not.toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first",
      terminalSessionId: "terminal-2"
    }));
  });

  it("resets preview identity state only when its project, session, terminal, or app route changes", () => {
    const lifecycle = {
      launchTargetId: "dev",
      previewBaseUrl: "https://preview.example.test/settings?vibe64_preview_token=first",
      projectSlug: "catalog",
      sessionId: "session-1",
      terminalSessionId: "terminal-1"
    };

    expect(previewIdentityLifecycleIdentity(lifecycle)).toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      previewBaseUrl: "https://preview.example.test/settings?vibe64_preview_token=second"
    }));
    expect(previewIdentityLifecycleIdentity(lifecycle)).not.toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      terminalSessionId: "terminal-2"
    }));
    expect(previewIdentityLifecycleIdentity(lifecycle)).not.toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      sessionId: "session-2"
    }));
  });

  it("presents confirmed, switching, guest, and recoverable failure identity states", () => {
    const viewer = {
      email: "ada@example.com",
      mode: "viewer"
    };
    expect(previewIdentityLabelText({ identity: viewer })).toBe("You — ada@example.com");
    expect(previewIdentityLabelText({ identity: { mode: "guest" } })).toBe("Guest");
    expect(previewIdentityLabelText({
      identity: {
        email: "grace@example.com",
        mode: "email",
        username: "Grace"
      }
    })).toBe("Grace — grace@example.com");
    expect(previewIdentityTitleText({ busy: true })).toBe("Switching preview identity…");
    expect(previewIdentityTitleText({
      error: "User not found.",
      identity: { mode: "guest" }
    })).toBe("Preview identity failed: User not found.");
    expect(previewLoadingOverlayShouldShow({
      identityBusy: true,
      loadedFrameRequestId: 4,
      previewFrameRequestId: 4,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);
    expect(defaultPreviewIdentityMode({
      capability: { defaultMode: "viewer" },
      viewer: { email: "ada@example.com" }
    })).toBe("viewer");
    expect(defaultPreviewIdentityMode({
      capability: { defaultMode: "viewer" }
    })).toBe("guest");
  });

  it("uses the application's canonical identity after exchange without changing the selected mode", () => {
    expect(previewIdentityFromExchange({
      identity: {
        email: " ADA@EXAMPLE.COM ",
        userId: "user-7",
        username: "Ada"
      }
    }, {
      email: "requested@example.com",
      mode: "viewer"
    })).toEqual({
      displayName: "Ada",
      email: "ada@example.com",
      mode: "viewer",
      userId: "user-7",
      username: "Ada"
    });
    expect(previewIdentityFromExchange({}, {
      mode: "guest"
    })).toEqual({
      mode: "guest"
    });
  });

  it("stores preview location as a host-independent route", () => {
    expect(previewRouteFromUrl("https://old-preview.example.test/admin/jobs/42?tab=docs#files"))
      .toBe("/admin/jobs/42?tab=docs#files");
    expect(previewRouteFromUrl("/settings/users?tab=access"))
      .toBe("/settings/users?tab=access");

    expect(previewUrlForRoute(
      "/admin/jobs/42?tab=docs#files",
      "https://new-preview.example.test/home"
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
      "http://127.0.0.1:4100/jobs/42?tab=docs&vibe64_preview_token=abc#files",
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

  it("redacts preview bearer tokens from nested debug details", () => {
    const redacted = redactPreviewDebugDetails({
      frame: "https://preview.example.test/home?vibe64_preview_token=secret&tab=one",
      nested: ["/home?vibe64_preview_token=secret#section"]
    });

    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(redacted.frame).toBe("https://preview.example.test/home?tab=one");
    expect(redacted.nested).toEqual(["/home#section"]);
  });

  it("maps entered preview addresses from display URLs to embedded proxy URLs", () => {
    expect(launchPreviewAddressNavigationUrl({
      address: "/jobs/42?tab=docs#files",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
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
      previewBaseUrl: "http://127.0.0.1:4188/home?vibe64_preview_token=abc"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/jobs/42?tab=docs&vibe64_preview_token=abc#files"
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
