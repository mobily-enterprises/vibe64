import { describe, expect, it } from "vitest";

import {
  launchPreviewEmptyText
} from "../../src/composables/useVibe64LaunchControlsSurface.js";

describe("Vibe64 launch controls surface", () => {
  it("keeps launch lifecycle text stable during background polling", () => {
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
});
