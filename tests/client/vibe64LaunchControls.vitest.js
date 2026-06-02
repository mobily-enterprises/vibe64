import { describe, expect, it, vi } from "vitest";

import {
  browserCanOpenTarget,
  launchBrowserTargetName,
  launchPreviewBaseUrl,
  launchPreviewUrl,
  launchTargetWorktreePath,
  launchTerminalAiFixAvailable,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget
} from "../../src/composables/useVibe64LaunchControls.js";

describe("Vibe64 launch controls", () => {
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

  it("opens a pending browser window and navigates it when launch is ready", () => {
    const browserWindow = fakeBrowserWindow();
    const session = {
      targetRoot: "/workspace/customer-app"
    };
    const target = {
      href: "http://127.0.0.1:4100/home",
      kind: "url"
    };

    const pendingWindow = openPendingLaunchBrowserWindow(session, browserWindow);
    const readyWindow = openReadyLaunchBrowserTarget(target, session, pendingWindow);

    expect(browserWindow.open).toHaveBeenCalledWith(
      "about:blank",
      launchBrowserTargetName(session),
      "popup,width=1400,height=900,left=80,top=60"
    );
    expect(readyWindow).toBe(pendingWindow);
    expect(pendingWindow.location.href).toBe(target.href);
    expect(pendingWindow.focus).toHaveBeenCalledTimes(2);
  });

  it("rejects non-url launch targets", () => {
    const browserWindow = fakeBrowserWindow();

    expect(browserCanOpenTarget({ href: "http://127.0.0.1:4100", kind: "url" })).toBe(true);
    expect(browserCanOpenTarget({ href: "mailto:test@example.com", kind: "mailto" })).toBe(false);
    expect(openLaunchBrowserTarget({ href: "mailto:test@example.com", kind: "mailto" }, {}, browserWindow))
      .toBeNull();
    expect(browserWindow.open).not.toHaveBeenCalled();
  });

  it("detects when a session has the worktree needed to load launch targets", () => {
    expect(launchTargetWorktreePath({
      currentStep: "worktree_created",
      sessionId: "session-1",
      status: "active"
    })).toBe("");

    expect(launchTargetWorktreePath({
      metadata: {
        worktree_path: "/workspace/.vibe64/sessions/session-1/worktree"
      },
      sessionId: "session-1",
      worktreeReady: true
    })).toBe("/workspace/.vibe64/sessions/session-1/worktree");
  });

  it("only offers AI repair for workflow-owned launch commands", () => {
    expect(launchTerminalAiFixAvailable({
      workflowCommand: false
    })).toBe(false);
    expect(launchTerminalAiFixAvailable({
      workflowCommand: true
    })).toBe(true);
  });

  it("keeps the embedded preview URL blank until the launch preview is ready", () => {
    const actions = [
      {
        href: "mailto:test@example.com",
        kind: "mailto"
      },
      {
        href: "http://127.0.0.1:4103/home?mode=dev",
        kind: "url"
      }
    ];

    const baseUrl = launchPreviewBaseUrl(actions);

    expect(baseUrl).toBe("http://127.0.0.1:4103/home?mode=dev");
    expect(launchPreviewUrl({
      baseUrl,
      ready: false,
      reloadKey: 2
    })).toBe("");
    expect(launchPreviewUrl({
      baseUrl,
      ready: true,
      reloadKey: 2
    })).toBe("http://127.0.0.1:4103/home?mode=dev&vibe64_reload=2");
  });
});

function fakeBrowserWindow() {
  return {
    open: vi.fn(() => ({
      document: {
        close: vi.fn(),
        write: vi.fn()
      },
      focus: vi.fn(),
      location: {
        href: ""
      },
      opener: {}
    }))
  };
}
