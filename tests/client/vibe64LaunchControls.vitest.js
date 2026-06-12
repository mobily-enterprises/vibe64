import { describe, expect, it, vi } from "vitest";

import {
  browserCanOpenTarget,
  launchBrowserTargetName,
  launchPreviewBaseUrl,
  launchPreviewDisplayUrl,
  launchPreviewOptionsStorageKey,
  launchPreviewToolbarStorageKey,
  launchPreviewUrl,
  launchTargetWorktreePath,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  sameSiteLoopbackPreviewUrl
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
    expect(launchBrowserTargetName(firstSession, "alpha_1"))
      .not.toBe(launchBrowserTargetName(firstSession, "beta_2"));
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
      completedSteps: ["worktree_created"],
      sessionId: "session-1",
      sessionRoot: "/workspace/.vibe64/sessions/active/session-1",
      status: "active"
    })).toBe("/workspace/.vibe64/sessions/active/session-1/worktree");

    expect(launchTargetWorktreePath({
      metadata: {
        worktree_path: "/workspace/.vibe64/sessions/session-1/worktree"
      },
      sessionId: "session-1",
      worktreeReady: true
    })).toBe("/workspace/.vibe64/sessions/session-1/worktree");

    expect(launchTargetWorktreePath({
      completedSteps: ["worktree_created"],
      metadata: {
        worktree_path: "/old-workspace/.vibe64/sessions/active/session-1/worktree"
      },
      sessionId: "session-1",
      sessionRoot: "/workspace/.vibe64/sessions/active/session-1",
      worktreeReady: true
    })).toBe("/workspace/.vibe64/sessions/active/session-1/worktree");
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

  it("uses the proxy URL for the embedded iframe and the target URL for display", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url",
        previewHref: "http://127.0.0.1:4188/home"
      }
    ];

    expect(launchPreviewBaseUrl(actions)).toBe("http://127.0.0.1:4188/home");
    expect(launchPreviewDisplayUrl(actions)).toBe("http://127.0.0.1:4103/home");
  });

  it("does not embed raw loopback launch URLs from a public Studio host", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url"
      }
    ];

    expect(launchPreviewBaseUrl(actions, {
      studioHref: "https://tonymobily.vibe64.dev/app/beepollen"
    })).toBe("");
    expect(launchPreviewBaseUrl([{
      ...actions[0],
      previewHref: "https://v64preview-abc123--tonymobily.vibe64.dev/home"
    }], {
      studioHref: "https://tonymobily.vibe64.dev/app/beepollen"
    })).toBe("https://v64preview-abc123--tonymobily.vibe64.dev/home");
    expect(launchPreviewBaseUrl([{
      ...actions[0],
      previewHref: "http://127.0.0.1:49100/home?vibe64_preview_token=abc"
    }], {
      studioHref: "https://tonymobily.vibe64.dev/app/beepollen"
    })).toBe("");
    expect(launchPreviewDisplayUrl([{
      ...actions[0],
      previewHref: "https://v64preview-abc123--tonymobily.vibe64.dev/home"
    }], {
      studioHref: "https://tonymobily.vibe64.dev/app/beepollen"
    })).toBe("https://v64preview-abc123--tonymobily.vibe64.dev/home");
  });

  it("keeps embedded loopback preview URLs same-site with the Studio page", () => {
    expect(sameSiteLoopbackPreviewUrl(
      "http://127.0.0.1:4188/home?vibe64_preview_token=abc",
      "http://localhost:3000/app/beepollen"
    )).toBe("http://localhost:4188/home?vibe64_preview_token=abc");

    expect(sameSiteLoopbackPreviewUrl(
      "http://localhost:4188/home?vibe64_preview_token=abc",
      "http://127.0.0.1:3000/app/beepollen"
    )).toBe("http://127.0.0.1:4188/home?vibe64_preview_token=abc");

    expect(sameSiteLoopbackPreviewUrl(
      "https://preview.example.test/home?vibe64_preview_token=abc",
      "https://studio.example.test/app/beepollen"
    )).toBe("https://preview.example.test/home?vibe64_preview_token=abc");
  });

  it("uses center as the default embedded preview toolbar position", () => {
    expect(normalizeLaunchPreviewToolbarPosition("")).toBe("center");
    expect(normalizeLaunchPreviewToolbarPosition("bottom")).toBe("center");
    expect(normalizeLaunchPreviewToolbarPosition("left")).toBe("left");
    expect(normalizeLaunchPreviewToolbarPosition("right")).toBe("right");
  });

  it("moves the embedded preview toolbar within the top positions", () => {
    expect(nextLaunchPreviewToolbarPosition("center", -1)).toBe("left");
    expect(nextLaunchPreviewToolbarPosition("center", 1)).toBe("right");
    expect(nextLaunchPreviewToolbarPosition("left", -1)).toBe("left");
    expect(nextLaunchPreviewToolbarPosition("right", 1)).toBe("right");
    expect(nextLaunchPreviewToolbarPosition("left", 1)).toBe("center");
    expect(nextLaunchPreviewToolbarPosition("right", -1)).toBe("center");
  });

  it("stores embedded preview toolbar position by project target", () => {
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

    expect(launchPreviewToolbarStorageKey(firstSession))
      .toBe(launchPreviewToolbarStorageKey(secondSessionForSameProject));
    expect(launchPreviewToolbarStorageKey(firstSession))
      .not.toBe(launchPreviewToolbarStorageKey(differentProject));
    expect(launchPreviewToolbarStorageKey(firstSession, "alpha_1"))
      .not.toBe(launchPreviewToolbarStorageKey(firstSession, "beta_2"));
  });

  it("stores preview options by project target and launch target", () => {
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

    expect(launchPreviewOptionsStorageKey(firstSession, "alpha_1", "dev"))
      .toBe(launchPreviewOptionsStorageKey(secondSessionForSameProject, "alpha_1", "dev"));
    expect(launchPreviewOptionsStorageKey(firstSession, "alpha_1", "dev"))
      .not.toBe(launchPreviewOptionsStorageKey(differentProject, "alpha_1", "dev"));
    expect(launchPreviewOptionsStorageKey(firstSession, "alpha_1", "dev"))
      .not.toBe(launchPreviewOptionsStorageKey(firstSession, "alpha_1", "built"));
    expect(launchPreviewOptionsStorageKey(firstSession, "alpha_1", "dev"))
      .not.toBe(launchPreviewOptionsStorageKey(firstSession, "beta_2", "dev"));
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
