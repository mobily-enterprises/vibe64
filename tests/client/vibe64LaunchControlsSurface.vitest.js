import { describe, expect, it } from "vitest";

import {
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
});
