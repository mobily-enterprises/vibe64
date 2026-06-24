import { describe, expect, it } from "vitest";

import {
  launchPreviewReloadBaseUrl,
  launchPreviewDiagnostic,
  launchPreviewEmptyText
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
      message: "The preview did not report that it is ready. Open the launch log for details.",
      title: "Preview needs attention"
    });
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
});
