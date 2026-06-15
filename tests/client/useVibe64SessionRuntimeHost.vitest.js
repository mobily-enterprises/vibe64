import { describe, expect, it } from "vitest";

import {
  codexTerminalStartAllowed,
  runtimeCapabilitiesState,
  runtimeControlsAreBusy
} from "../../src/composables/useVibe64SessionRuntimeHost.js";

describe("Vibe64 session runtime host", () => {
  it("keeps runtime controls busy until the selected session is stable", () => {
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: true,
      stable: true
    })).toBe(false);

    expect(runtimeControlsAreBusy({
      active: false,
      loading: false,
      sessionReady: true,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: true,
      sessionReady: true,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: false,
      stable: true
    })).toBe(true);
    expect(runtimeControlsAreBusy({
      active: true,
      loading: false,
      sessionReady: true,
      stable: false
    })).toBe(true);
  });

  it("treats first capability load differently from a refresh", () => {
    expect(runtimeCapabilitiesState({
      data: null,
      isLoading: true
    })).toEqual({
      fetching: true,
      initialLoading: true,
      loaded: false
    });

    expect(runtimeCapabilitiesState({
      data: {
        capabilities: {}
      },
      isFetching: true
    })).toEqual({
      fetching: true,
      initialLoading: false,
      loaded: true
    });
  });

  it("allows Codex terminal auto-start while loaded capabilities refresh", () => {
    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesReady: true,
      sessionReady: true
    })).toBe(true);

    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesReady: false,
      sessionReady: true
    })).toBe(false);
    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesReady: true,
      sessionReady: false
    })).toBe(false);
    expect(codexTerminalStartAllowed({
      active: false,
      capabilitiesReady: true,
      sessionReady: true
    })).toBe(false);
  });
});
