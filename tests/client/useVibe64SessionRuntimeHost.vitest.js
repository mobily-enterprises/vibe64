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

  it("blocks Codex terminal auto-start while capabilities are refreshing", () => {
    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesFetching: false,
      runtimeBusy: false
    })).toBe(true);

    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesFetching: true,
      runtimeBusy: false
    })).toBe(false);
    expect(codexTerminalStartAllowed({
      active: true,
      capabilitiesFetching: false,
      runtimeBusy: true
    })).toBe(false);
    expect(codexTerminalStartAllowed({
      active: false,
      capabilitiesFetching: false,
      runtimeBusy: false
    })).toBe(false);
  });
});
