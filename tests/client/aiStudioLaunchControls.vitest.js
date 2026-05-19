import { describe, expect, it, vi } from "vitest";

import {
  browserCanOpenTarget,
  launchBrowserTargetName,
  openLaunchBrowserTarget
} from "../../src/composables/useAiStudioLaunchControls.js";

describe("AI Studio launch controls", () => {
  it("builds a stable browser target name from the project root", () => {
    const firstSession = {
      sessionId: "session-1",
      targetRoot: "/workspace/customer-app"
    };
    const secondSessionForSameProject = {
      sessionId: "session-2",
      targetRoot: "/workspace/customer-app"
    };
    const differentProject = {
      sessionId: "session-1",
      targetRoot: "/workspace/admin-app"
    };

    expect(launchBrowserTargetName(firstSession)).toBe(launchBrowserTargetName(secondSessionForSameProject));
    expect(launchBrowserTargetName(firstSession)).not.toBe(launchBrowserTargetName(differentProject));
  });

  it("opens launch targets in the named browser target", () => {
    const browserWindow = fakeBrowserWindow();
    const target = {
      href: "http://127.0.0.1:4100",
      kind: "url"
    };
    const session = {
      targetRoot: "/workspace/customer-app"
    };

    const openedWindow = openLaunchBrowserTarget(target, session, browserWindow);

    expect(browserWindow.open).toHaveBeenCalledWith(
      target.href,
      launchBrowserTargetName(session),
      "popup,width=1400,height=900,left=80,top=60"
    );
    expect(openedWindow.opener).toBeNull();
    expect(openedWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("rejects non-url launch targets", () => {
    const browserWindow = fakeBrowserWindow();

    expect(browserCanOpenTarget({ href: "http://127.0.0.1:4100", kind: "url" })).toBe(true);
    expect(browserCanOpenTarget({ href: "mailto:test@example.com", kind: "mailto" })).toBe(false);
    expect(openLaunchBrowserTarget({ href: "mailto:test@example.com", kind: "mailto" }, {}, browserWindow))
      .toBeNull();
    expect(browserWindow.open).not.toHaveBeenCalled();
  });
});

function fakeBrowserWindow() {
  return {
    open: vi.fn(() => ({
      focus: vi.fn(),
      opener: {}
    }))
  };
}
