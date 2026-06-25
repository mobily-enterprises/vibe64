import { describe, expect, it } from "vitest";

import {
  launchPreviewAddressNavigationUrl,
  launchPreviewAttention,
  launchPreviewReloadBaseUrl,
  launchPreviewDiagnostic,
  launchPreviewEmptyText,
  launchPreviewRecoveryIntent,
  previewAddressDisplayText
} from "../../src/composables/useVibe64LaunchControlsSurface.js";

describe("Vibe64 launch controls surface", () => {
  it("keeps launch lifecycle text stable during background polling", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      launchStarting: true
    })).toBe("Starting preview.");

    expect(launchPreviewEmptyText({
      launchStarting: true
    })).toBe("Starting preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      previewStarting: true
    })).toBe("Starting preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      terminalIsRunning: true
    })).toBe("Starting preview.");

    expect(launchPreviewEmptyText({
      loading: true
    })).toBe("Loading preview targets.");

    expect(launchPreviewEmptyText({
      previewAutoStartPreparing: true
    })).toBe("Preparing preview.");
  });

  it("surfaces preview proxy failures before generic loading state", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      previewProxyUnavailable: true,
      previewTargetDisabledReason: "No launch preview proxy port is available."
    })).toBe("No launch preview proxy port is available.");
  });

  it("treats a proxy-required preview with no server reason as still starting", () => {
    expect(launchPreviewEmptyText({
      loading: false,
      previewProxyUnavailable: true,
      terminalIsRunning: true
    })).toBe("Starting preview.");
  });

  it("uses neutral copy when no launch state is available yet", () => {
    expect(launchPreviewEmptyText()).toBe("Preview will appear here when it is ready.");
  });

  it("surfaces a manual start state when an embedded target can be launched", () => {
    expect(launchPreviewEmptyText({
      previewManualStartAvailable: true
    })).toBe("Preview is ready to start.");
  });

  it("points users to the launch log when preview readiness stalls", () => {
    expect(launchPreviewDiagnostic({
      previewReadyNeedsAttention: true
    })).toEqual({
      message: "The preview did not report that it is ready. Restart preview or open the launch log for details.",
      title: "Preview could not be opened"
    });
  });

  it("surfaces server restart preview recovery", () => {
    expect(launchPreviewDiagnostic({
      previewRecovery: {
        canRestart: true,
        reason: "server_restart_state_lost"
      }
    })).toEqual({
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      title: "Preview could not be opened"
    });
  });

  it("surfaces stale server-side preview recovery as non-blocking attention", () => {
    expect(launchPreviewDiagnostic({
      previewRecovery: {
        canRestart: true,
        reason: "server_source_changed"
      }
    })).toBeNull();

    expect(launchPreviewAttention({
      previewRecovery: {
        canRestart: true,
        reason: "server_source_changed"
      }
    })).toEqual({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      title: "Preview may be stale"
    });
  });

  it("forces a restart when recovery advertises a restartable preview without a stoppable terminal", () => {
    expect(launchPreviewRecoveryIntent({
      hasEmbeddedStartTarget: true,
      previewRecovery: {
        canRestart: true,
        reason: "server_source_changed"
      },
      terminalCanRestart: false,
      terminalCanRetry: true
    })).toBe("force-run");
  });

  it("uses restart instead of retry when recovery has a running terminal", () => {
    expect(launchPreviewRecoveryIntent({
      hasEmbeddedStartTarget: true,
      previewRecovery: {
        canRestart: true,
        reason: "server_source_changed"
      },
      terminalCanRestart: true,
      terminalCanRetry: true
    })).toBe("restart");
  });

  it("surfaces stopped preview processes as diagnostics", () => {
    expect(launchPreviewDiagnostic({
      terminalExitCode: 1,
      terminalStatus: "exited"
    })).toEqual({
      message: "The preview process exited with code 1.",
      title: "Preview stopped"
    });
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
