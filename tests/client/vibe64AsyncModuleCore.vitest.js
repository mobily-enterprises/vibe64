import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  asyncModuleErrorState,
  dismissVibe64AsyncModuleError,
  isVibe64AsyncImportError,
  notifyVibe64AsyncModuleError,
  vibe64AsyncModuleErrorMessage
} from "../../src/lib/vibe64AsyncModuleCore.js";

describe("vibe64AsyncModuleCore", () => {
  beforeEach(() => {
    dismissVibe64AsyncModuleError();
    asyncModuleErrorState.error = null;
    asyncModuleErrorState.label = "";
    asyncModuleErrorState.message = "";
    asyncModuleErrorState.retry = null;
    asyncModuleErrorState.stale = false;
  });

  it("recognizes browser dynamic import failures", () => {
    expect(isVibe64AsyncImportError(
      new Error("Failed to fetch dynamically imported module: /assets/xterm.js")
    )).toBe(true);
    expect(isVibe64AsyncImportError(
      new Error("Loading chunk session failed")
    )).toBe(true);
  });

  it("does not classify ordinary runtime errors as stale chunks", () => {
    expect(isVibe64AsyncImportError(new Error("Request failed."))).toBe(false);
    expect(isVibe64AsyncImportError(new Error("Terminal stream failed."))).toBe(false);
  });

  it("uses a direct retry action without hiding the error as a generic request failure", () => {
    const retry = vi.fn();
    const error = new Error("Failed to fetch dynamically imported module: /assets/diff.js");

    notifyVibe64AsyncModuleError(error, {
      label: "Diff viewer",
      retry
    });

    expect(asyncModuleErrorState.visible).toBe(true);
    expect(asyncModuleErrorState.label).toBe("Diff viewer");
    expect(asyncModuleErrorState.message).toBe(
      "Diff viewer did not download. The app may have been updated, or the network request failed."
    );
    expect(asyncModuleErrorState.retry).toBe(retry);
    expect(asyncModuleErrorState.stale).toBe(true);
  });

  it("keeps non-stale module failures actionable", () => {
    expect(vibe64AsyncModuleErrorMessage(new Error("boom"), {
      label: "Terminal",
      stale: false
    })).toBe("Terminal could not load.");
  });
});
