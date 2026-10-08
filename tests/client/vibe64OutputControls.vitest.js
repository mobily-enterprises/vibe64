import { describe, expect, it, vi } from "vitest";

import {
  AUTO_START_ATTEMPT_COOLDOWN_MS,
  AUTO_START_STABILITY_DELAY_MS,
  autoStartOutputsLoading,
  browserCanOpenTarget,
  launchAutoStartAttemptStorageKey,
  launchBrowserTargetHref,
  launchBrowserTargetName,
  launchControlsCanLoadTargets,
  launchPreviewFromStatus,
  launchPreviewTestNotice,
  launchPreviewLocationStorageKey,
  launchPreviewRequiresProxy,
  launchPreviewToolbarStorageKey,
  LAUNCH_STATUS_RETRY_LIMIT,
  outputTargetsRealtimeShouldRefresh,
  launchControlScopeKey,
  launchStatusAgentWriteBusy,
  launchStatusErrorText,
  launchStatusRetryDelay,
  launchStatusShouldRetry,
  outputTargetWorktreePath,
  launchControlsSessionCanRun,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreview,
  normalizeLaunchPreviewToolbarPosition,
  openLaunchBrowserTarget,
  openPendingLaunchBrowserWindow,
  openReadyLaunchBrowserTarget,
  readLaunchAutoStartAttemptCooldown,
  resolveLaunchPreviewDestination,
  sameSiteLoopbackPreviewUrl,
  shouldScheduleLaunchAutoStart
} from "../../src/composables/useVibe64OutputControls.js";
import {
  vibe64BrowserTabOriginId
} from "../../src/lib/vibe64BrowserTabOrigin.js";
import {
  managedPreviewTarget,
  preferredPreviewTarget
} from "@local/studio-terminal-core/shared";

describe("Vibe64 launch controls", () => {
  it("shows declared test data and retains restoration failures without guessing target names", () => {
    expect(launchPreviewTestNotice({}, { id: "test-database" })).toBeNull();
    expect(launchPreviewTestNotice({}, { id: "app", dataMode: "test" }).title).toBe("Test Preview");
    expect(launchPreviewTestNotice({ previewTestRun: { state: "running" } }, { dataMode: "development" }).title).toBe("Browser tests in progress");
    expect(launchPreviewTestNotice({ previewTestRun: { state: "restoring" } }, { dataMode: "test" }).title).toBe("Restoring your app");
    for (const state of ["restore_failed", "cleanup_required"]) {
      expect(launchPreviewTestNotice({ previewTestRun: { state } }, { dataMode: "development" }).error).toBe(true);
    }
    expect(launchPreviewTestNotice({}, { dataMode: "development" })).toBeNull();
    expect(outputTargetsRealtimeShouldRefresh({ payload: { sessionId: "one", reason: "preview-test-state-changed" } }, "one")).toBe(true);
  });
  const managedSourceMetadata = {
    source_kind: "session_clone",
    source_path: "/var/lib/vibe64/user/projects/project-test/sessions/active/session-1/source",
    source_path_authority: "managed_session_source"
  };

  it("scopes launch lifecycle state by project and session", () => {
    expect(launchControlScopeKey("vibe64", "session-1")).toBe("vibe64::session-1");
    expect(launchControlScopeKey("vibe64", "session-1"))
      .not.toBe(launchControlScopeKey("beepollen", "session-1"));
    expect(launchControlScopeKey("vibe64", "session-1"))
      .not.toBe(launchControlScopeKey("vibe64", "session-2"));
  });

  it("builds a stable browser target name from the explicit project slug", () => {
    const firstSession = {
      sessionId: "session-1"
    };
    const secondSessionForSameProject = {
      sessionId: "session-2"
    };

    expect(launchBrowserTargetName(firstSession, "customer-app"))
      .toBe(launchBrowserTargetName(secondSessionForSameProject, "customer-app"));
    expect(launchBrowserTargetName(firstSession, "customer-app"))
      .not.toBe(launchBrowserTargetName(firstSession, "admin-app"));
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

  it("opens remote Studio launch targets through the preview proxy", () => {
    const browserWindow = fakeBrowserWindow({
      href: "https://massimo.users.vibe64.dev/projects/jskit-project"
    });
    const target = {
      href: "http://127.0.0.1:4100/home",
      kind: "url",
      previewHref: "https://v64preview-abc123def456--massimo.vibe64.dev/home?vibe64_preview_token=token"
    };
    const session = {
      targetRoot: "/workspace/customer-app"
    };

    openLaunchBrowserTarget(target, session, browserWindow);

    expect(launchBrowserTargetHref(target, browserWindow)).toBe(target.previewHref);
    expect(browserWindow.open).toHaveBeenCalledWith(
      target.previewHref,
      launchBrowserTargetName(session),
      "popup,width=1400,height=900,left=80,top=60"
    );
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
    expect(outputTargetWorktreePath({
      currentStep: "source_created",
      sessionId: "session-1",
      status: "active"
    })).toBe("");

    expect(outputTargetWorktreePath({
      completedSteps: ["source_created"],
      sessionId: "session-1",
      sessionRoot: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1",
      status: "active"
    })).toBe("");

    expect(outputTargetWorktreePath({
      metadata: managedSourceMetadata,
      sessionId: "session-1",
      sourceReady: true
    })).toBe(managedSourceMetadata.source_path);

    expect(outputTargetWorktreePath({
      completedSteps: ["source_created"],
      metadata: {
        source_path: "/old-workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1/source"
      },
      sessionId: "session-1",
      sessionRoot: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1",
      sourceReady: true
    })).toBe("");
  });

  it("keeps hidden launch controls inert even when the session has a worktree", () => {
    const session = {
      completedSteps: ["source_created"],
      metadata: managedSourceMetadata,
      sessionId: "session-1",
      sessionRoot: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1",
      status: "active"
    };

    expect(launchControlsCanLoadTargets({
      displayed: true,
      session
    })).toBe(true);
    expect(launchControlsCanLoadTargets({
      displayed: false,
      session
    })).toBe(false);
    expect(launchControlsCanLoadTargets({
      displayed: true,
      session,
      sourceOperationsSuspended: true
    })).toBe(false);
  });

  it("recognizes the source write-boundary response as a suppressible status collision", () => {
    expect(launchStatusAgentWriteBusy({
      code: "vibe64_agent_write_mode_busy"
    })).toBe(true);
    expect(launchStatusAgentWriteBusy({
      response: {
        errors: [{ code: "vibe64_agent_write_mode_busy" }]
      }
    })).toBe(true);
    expect(launchStatusAgentWriteBusy({
      code: "vibe64_launch_invalid"
    })).toBe(false);
    expect(launchStatusAgentWriteBusy(new Error("Request failed."))).toBe(false);
  });

  it("keeps closed or closing sessions out of launch controls", () => {
    const session = {
      completedSteps: ["source_created"],
      metadata: managedSourceMetadata,
      sessionId: "session-1",
      sessionRoot: "/workspace/vibe64-local-editor/state/projects/project-test/sessions/active/session-1",
      sourceReady: true,
      status: "active"
    };

    expect(launchControlsSessionCanRun(session)).toBe(true);
    expect(launchControlsCanLoadTargets({
      displayed: true,
      session: {
        ...session,
        status: "archived"
      }
    })).toBe(false);
    expect(launchControlsCanLoadTargets({
      displayed: true,
      session: {
        ...session,
        metadata: {
          ...managedSourceMetadata,
          session_closing_reason: "archived"
        }
      }
    })).toBe(false);
  });

  it("selects the first browser action as the embedded preview destination", () => {
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

    expect(resolveLaunchPreviewDestination(actions)).toMatchObject({
      displayHref: "http://127.0.0.1:4103/home?mode=dev",
      embedHref: "http://127.0.0.1:4103/home?mode=dev",
      unavailableReason: ""
    });
  });

  it("normalizes canonical server preview status", () => {
    expect(normalizeLaunchPreview({
      canRestart: true,
      canShowLog: true,
      href: " http://127.0.0.1:4188/app ",
      message: "Preview is ready.",
      state: "ready",
      targetHref: " http://127.0.0.1:4100/app ",
      terminalId: "terminal-1"
    })).toEqual({
      canRestart: true,
      canShowLog: true,
      canStart: false,
      href: "http://127.0.0.1:4188/app",
      message: "Preview is ready.",
      reason: "",
      recovery: null,
      state: "ready",
      targetHref: "http://127.0.0.1:4100/app",
      terminalId: "terminal-1"
    });

    expect(normalizeLaunchPreview({
      state: "unknown"
    }).state).toBe("idle");
    expect(normalizeLaunchPreview({
      state: "project_closed"
    }).message).toBe("Project is closed.");
  });

  it("normalizes legacy launch preview targets into preview status", () => {
    expect(launchPreviewFromStatus({
      activeTerminal: {
        id: "terminal-1"
      },
      openTarget: {
        href: " http://127.0.0.1:4100/home ",
        previewHref: " http://127.0.0.1:49000/home "
      },
      previewTarget: {
        href: " http://127.0.0.1:49000/home ",
        targetHref: " http://127.0.0.1:4100/home "
      }
    })).toEqual({
      canRestart: true,
      canShowLog: true,
      canStart: false,
      href: "http://127.0.0.1:49000/home",
      message: "Preview is ready.",
      reason: "",
      recovery: null,
      state: "ready",
      targetHref: "http://127.0.0.1:4100/home",
      terminalId: "terminal-1"
    });

    expect(launchPreviewFromStatus({
      preview: {
        message: "No preview proxy port is available.",
        state: "failed"
      },
      previewTarget: {
        href: "http://127.0.0.1:49000/home"
      }
    }).state).toBe("failed");
  });

  it("uses the proxy URL for the embedded iframe and the target URL for display", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url",
        previewHref: "http://127.0.0.1:4188/home"
      }
    ];

    expect(resolveLaunchPreviewDestination(actions)).toMatchObject({
      displayHref: "http://127.0.0.1:4103/home",
      embedHref: "http://127.0.0.1:4188/home",
      unavailableReason: ""
    });
  });

  it("does not fall back to direct URLs when preview auth requires the proxy", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url"
      }
    ];

    expect(resolveLaunchPreviewDestination(actions, {
      requirePreviewProxy: true
    })).toMatchObject({
      displayHref: "http://127.0.0.1:4103/home",
      embedHref: "",
      unavailableReason: "Waiting for the hosted preview URL."
    });
    expect(launchPreviewRequiresProxy({
      previewAuth: "vibe64-self"
    })).toBe(true);
    expect(launchPreviewRequiresProxy({
      previewAuth: ""
    })).toBe(false);
  });

  it("does not embed raw loopback launch URLs from a public Studio host", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url"
      }
    ];

    expect(resolveLaunchPreviewDestination(actions, {
      studioHref: "https://tonymobily.vibe64.dev/app/project/beepollen"
    })).toMatchObject({
      embedHref: "",
      unavailableReason: expect.stringMatching(/only reachable from the server/u)
    });
    expect(resolveLaunchPreviewDestination([{
      ...actions[0],
      previewHref: "https://v64preview-abc123--tonymobily.vibe64.dev/home"
    }], {
      studioHref: "https://tonymobily.vibe64.dev/app/project/beepollen"
    })).toMatchObject({
      displayHref: "https://v64preview-abc123--tonymobily.vibe64.dev/home",
      embedHref: "https://v64preview-abc123--tonymobily.vibe64.dev/home"
    });
    expect(resolveLaunchPreviewDestination([{
      ...actions[0],
      previewHref: "http://127.0.0.1:49100/home?vibe64_preview_token=abc"
    }], {
      studioHref: "https://tonymobily.vibe64.dev/app/project/beepollen"
    }).embedHref).toBe("");
  });

  it("does not embed remote HTTP previews from HTTPS Studio", () => {
    const actions = [
      {
        href: "http://127.0.0.1:4103/home",
        kind: "url",
        previewHref: "http://v64preview-abc123def456--pass.vibe64.dev/home?vibe64_preview_token=abc"
      }
    ];

    expect(resolveLaunchPreviewDestination(actions, {
      studioHref: "https://pass.users.vibe64.dev/app/project/whs"
    })).toMatchObject({
      displayHref: "http://v64preview-abc123def456--pass.vibe64.dev/home?vibe64_preview_token=abc",
      embedHref: "",
      unavailableReason: expect.stringMatching(/HTTP previews cannot be embedded from HTTPS Studio/u)
    });
  });

  it("applies mixed-content checks to direct preview URLs too", () => {
    expect(resolveLaunchPreviewDestination([{
      href: "http://preview.example.test/home",
      kind: "url"
    }], {
      studioHref: "https://studio.example.test/app/project/demo"
    })).toMatchObject({
      embedHref: "",
      unavailableReason: expect.stringMatching(/HTTP previews cannot be embedded from HTTPS Studio/u)
    });
  });

  it("keeps embedded loopback preview URLs same-site with the Studio page", () => {
    expect(sameSiteLoopbackPreviewUrl(
      "http://127.0.0.1:4188/home?vibe64_preview_token=abc",
      "http://localhost:3000/app/project/beepollen"
    )).toBe("http://localhost:4188/home?vibe64_preview_token=abc");

    expect(sameSiteLoopbackPreviewUrl(
      "http://localhost:4188/home?vibe64_preview_token=abc",
      "http://127.0.0.1:3000/app/project/beepollen"
    )).toBe("http://127.0.0.1:4188/home?vibe64_preview_token=abc");

    expect(sameSiteLoopbackPreviewUrl(
      "https://preview.example.test/home?vibe64_preview_token=abc",
      "https://studio.example.test/app/project/beepollen"
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

  it("stores embedded preview toolbar position by project slug", () => {
    const firstSession = {
      sessionId: "session-1"
    };
    const secondSessionForSameProject = {
      sessionId: "session-2"
    };

    expect(launchPreviewToolbarStorageKey(firstSession, "customer-app"))
      .toBe(launchPreviewToolbarStorageKey(secondSessionForSameProject, "customer-app"));
    expect(launchPreviewToolbarStorageKey(firstSession, "customer-app"))
      .not.toBe(launchPreviewToolbarStorageKey(firstSession, "admin-app"));
    expect(launchPreviewToolbarStorageKey(firstSession, "alpha_1"))
      .not.toBe(launchPreviewToolbarStorageKey(firstSession, "beta_2"));
  });

  it("stores embedded preview location by project slug", () => {
    const firstSession = {
      sessionId: "session-1"
    };
    const secondSessionForSameProject = {
      sessionId: "session-2"
    };

    expect(launchPreviewLocationStorageKey(firstSession, "customer-app"))
      .toBe(launchPreviewLocationStorageKey(secondSessionForSameProject, "customer-app"));
    expect(launchPreviewLocationStorageKey(firstSession, "customer-app"))
      .not.toBe(launchPreviewLocationStorageKey(firstSession, "admin-app"));
    expect(launchPreviewLocationStorageKey(firstSession, "alpha_1"))
      .not.toBe(launchPreviewLocationStorageKey(firstSession, "beta_2"));
  });

  it("requires a stable visible idle scope before scheduling embedded preview auto-start", () => {
    const readyState = {
      autoStartKey: "",
      key: "beepollen::session-1:dev",
      loading: false,
      operationBusy: false,
      sessionId: "session-1",
      target: {
        available: true,
        id: "dev"
      },
      terminalDisplayed: true,
      terminalVisible: false
    };

    expect(AUTO_START_STABILITY_DELAY_MS).toBeGreaterThan(0);
    expect(autoStartOutputsLoading({
      outputTargetsLoading: false,
      outputTargetsSettled: true
    })).toBe(false);
    expect(autoStartOutputsLoading({
      outputTargetsLoading: false,
      outputTargetsSettled: false
    })).toBe(true);
    expect(autoStartOutputsLoading({
      outputTargetsLoading: true,
      outputTargetsSettled: true
    })).toBe(true);
    expect(shouldScheduleLaunchAutoStart(readyState)).toBe(true);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      loading: true
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      operationBusy: true
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      externalBusy: true
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      sessionLaunchable: false
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      target: {
        available: false,
        id: "dev"
      }
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      terminalDisplayed: false
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      terminalVisible: true
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      autoStartKey: readyState.key
    })).toBe(false);
    expect(shouldScheduleLaunchAutoStart({
      ...readyState,
      sessionId: ""
    })).toBe(false);
  });

  it("keeps embedded preview auto-start attempts on cooldown across reloads", () => {
    const storage = fakeStorage();
    const key = "beepollen::session-1:dev";
    const storageKey = launchAutoStartAttemptStorageKey(key);

    expect(AUTO_START_ATTEMPT_COOLDOWN_MS).toBe(7000);

    storage.setItem(storageKey, JSON.stringify({
      key,
      startedAt: 1000
    }));

    expect(readLaunchAutoStartAttemptCooldown(key, {
      now: 1000,
      storage
    })).toBe(AUTO_START_ATTEMPT_COOLDOWN_MS);
    expect(readLaunchAutoStartAttemptCooldown(key, {
      now: 1000 + AUTO_START_ATTEMPT_COOLDOWN_MS - 1,
      storage
    })).toBe(1);
    expect(readLaunchAutoStartAttemptCooldown(key, {
      now: 1000 + AUTO_START_ATTEMPT_COOLDOWN_MS + 1,
      storage
    })).toBe(0);
    expect(storage.getItem(storageKey)).toBe(null);
  });

  it("retries transient launch status failures without polling missing routes", () => {
    expect(LAUNCH_STATUS_RETRY_LIMIT).toBe(2);
    expect(launchStatusRetryDelay(0)).toBe(1000);
    expect(launchStatusRetryDelay(10)).toBe(5000);
    expect(launchStatusShouldRetry(0, { status: 0 })).toBe(true);
    expect(launchStatusShouldRetry(0, { status: 502 })).toBe(true);
    expect(launchStatusShouldRetry(0, { status: 429 })).toBe(true);
    expect(launchStatusShouldRetry(0, {
      code: "vibe64_agent_write_mode_busy",
      status: 400
    })).toBe(true);
    expect(launchStatusShouldRetry(0, { status: 404 })).toBe(false);
    expect(launchStatusShouldRetry(0, { status: 401 })).toBe(false);
    expect(launchStatusShouldRetry(LAUNCH_STATUS_RETRY_LIMIT, { status: 502 })).toBe(false);

    expect(launchStatusErrorText({
      error: Object.assign(new Error("Request failed."), {
        status: 502
      }),
      path: "/api/vibe64/sessions/session-1/outputs"
    })).toBe("Request failed. (HTTP 502, /api/vibe64/sessions/session-1/outputs)");

    expect(launchStatusErrorText({
      error: Object.assign(new Error("Network request failed."), {
        status: 0
      }),
      path: "/api/vibe64/sessions/session-1/outputs"
    })).toBe("Network request failed. (network, /api/vibe64/sessions/session-1/outputs)");

    expect(launchStatusErrorText({
      error: Object.assign(new Error("Assistant owns the source."), {
        code: "vibe64_agent_write_mode_busy",
        status: 400
      }),
      path: "/api/vibe64/sessions/session-1/outputs"
    })).toBe("");
  });

  it("refreshes launch targets for lifecycle events and explicit refresh hints", () => {
    const ownOriginId = vibe64BrowserTabOriginId();

    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        reason: "output-target-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      localLaunchStarting: true,
      payload: {
        reason: "output-target-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        originId: ownOriginId,
        reason: "output-target-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        originId: "other-tab",
        reason: "output-target-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        reason: "output-target-ready",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        reason: "output-target-stale-cleared",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-started",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeOutputs: true
        },
        reason: "output-target-closed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeOutputs: true
        },
        reason: "codex-app-server-turn-idle",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);
    expect(outputTargetsRealtimeShouldRefresh({
      payload: {
        clientRefresh: {
          includeOutputs: true
        },
        reason: "output-target-ready",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });

  it("uses adapter preview preference while respecting availability", () => {
    const outputTargets = [
      {
        available: true,
        id: "built",
        presentation: { kind: "web" }
      },
      {
        available: false,
        default: true,
        disabledReason: "Install dependencies before running the app.",
        id: "dev",
        presentation: { kind: "web" }
      }
    ];

    expect(preferredPreviewTarget(outputTargets)?.id).toBe("dev");
    expect(managedPreviewTarget(outputTargets)?.id).toBe("built");
    expect(managedPreviewTarget(outputTargets.map((target) => ({
      ...target,
      available: true
    })))?.id).toBe("dev");
  });
});

function fakeBrowserWindow({
  href = "http://127.0.0.1:5173"
} = {}) {
  return {
    location: {
      href
    },
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

function fakeStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.has(key) ? values.get(key) : null),
    removeItem: vi.fn((key) => {
      values.delete(key);
    }),
    setItem: vi.fn((key, value) => {
      values.set(key, String(value));
    })
  };
}

import { provideConversationFixture } from "./helpers/conversationRuntimeFixture.js";

it("practice output controls use captured Learning reads and named Stop while Working Ctrl-C keeps raw FIFO input", async () => {
  const Vue = await import("vue");
  const { QueryClient, VueQueryPlugin } = await import("@tanstack/vue-query");
  const { configureHttpWebClient, resetHttpWebClientForTests } = await import("@jskit-ai/http-web/client/lib/httpClient");
  const { VIBE64_ASSISTANT_VIEWER_KEY } = await import("../../src/lib/vibe64AssistantHost.js");
  const { useVibe64OutputControls } = await import("../../src/composables/useVibe64OutputControls.js");
  const { vibe64OutputTerminalWebSocketUrl } = await import("../../src/lib/vibe64SessionApi.js");
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  const api = `/api/learning/${attemptId}/vibe64/sessions`;
  const session = Vue.ref({ sessionId: "saved-initial", metadata: {
    source_kind: "session_clone", source_path: "/controlled/practice/sessions/active/saved-initial/source", source_path_authority: "managed_session_source"
  } });
  const binding = Vue.ref({ actorKey: "learning-member-42", viewerActorKey: "member-42", learnerId: "42",
    learningAttemptId: attemptId, sessionId: "saved-initial", noExercise: false,
    sourceProjectSlug: "exact-practice", sessionsApiPath: api });
  const viewer = Vue.ref({ actorKey: "member-42" });
  const requests = [];
  const sockets = [];
  class ControlledSocket {
    static OPEN = 1; static CLOSED = 3; static CLOSING = 2;
    readyState = 1; handlers = new Map(); sent = [];
    constructor(url) { this.url = url; sockets.push(this); queueMicrotask(() => this.handlers.get("open")?.()); }
    addEventListener(name, callback) { this.handlers.set(name, callback); }
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.handlers.get("close")?.(); }
  }
  vi.stubGlobal("window", { location: new URL("http://127.0.0.1:5173/app/project/exact-practice"),
    localStorage: fakeStorage(), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("WebSocket", ControlledSocket);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  configureHttpWebClient({ request(url, options) {
    requests.push({ url, options });
    return Promise.resolve(url.endsWith("/stop") ? { ok: true, id: "output-1", status: "exited", exitCode: 0 }
      : { ok: true, outputTargets: [], preview: { state: "idle" } });
  } });
  let controls;
  const renderer = Vue.createRenderer({ createElement: () => ({}), createComment: () => ({}), createText: () => ({}),
    insert() {}, remove() {}, setElementText() {}, setText() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp({ setup() {
    controls = useVibe64OutputControls({ session, learningBinding: binding }); return () => Vue.h("div");
  } });
  provideConversationFixture(app, { on() {}, off() {} }, "member-42");
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.provide("jskit.shell-web.runtime.web-error.client", { dismiss() {}, report() { return { skipped: true }; } });
  app.use(VueQueryPlugin, { queryClient }); app.mount({});
  try {
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].url).toBe(`${api}/saved-initial/outputs`);
    expect(controls.outputProjectSlug.value).toBe("exact-practice");
    expect(controls.outputStorageScope.value).toBe(`learning:${JSON.stringify(["42", attemptId])}`);
    expect(controls.practiceBindingCurrent.value).toBe(true);
    expect(vibe64OutputTerminalWebSocketUrl("saved-initial", "output-1", api)).toContain(
      `/api/learning/${attemptId}/vibe64/sessions/saved-initial/output-runs/output-1/terminal/ws`);
    expect(vibe64OutputTerminalWebSocketUrl("working", "output-1")).toContain("/vibe64/sessions/working/output-runs/output-1/terminal/ws");
    await expect(controls.startNewlyConfiguredWorkspaceSetup()).resolves.toBe(false);
    await expect(controls.publishPreviewState({ route: "/" })).resolves.toBe(false);
    controls.terminal.applyTerminalSession({ id: "output-1", status: "running" });
    expect(controls.terminal.sendCtrlC).toBe(controls.stopTerminal);
    await expect(controls.stopTerminal()).resolves.toBe(true);
    const stops = requests.filter(request => request.options.method === "POST");
    expect(stops).toHaveLength(1);
    expect(stops[0].url).toBe(`${api}/saved-initial/output-runs/output-1/stop`);
    expect(stops[0].options.body).toEqual({});
    expect(sockets.flatMap(socket => socket.sent).filter(message => message.type === "input")).toEqual([]);
    const confirmedRequestCount = requests.length;
    viewer.value = { actorKey: "different-member" }; await Vue.nextTick();
    expect(controls.practiceBindingCurrent.value).toBe(false);
    await expect(controls.run({ id: "app", available: true })).resolves.toBe(false);
    expect(requests).toHaveLength(confirmedRequestCount);
    binding.value = { ...binding.value, sourceProjectSlug: "changed-row" };
    viewer.value = { actorKey: "member-42" }; await Vue.nextTick();
    expect(controls.practiceBindingCurrent.value).toBe(false);
    expect(controls.outputProjectSlug.value).toBe("exact-practice");
    await expect(controls.refresh()).resolves.toBeNull();
    expect(requests).toHaveLength(confirmedRequestCount);
    let working;
    const workingApp = renderer.createApp({ setup() {
      working = useVibe64OutputControls({ session: Vue.ref({ ...session.value, sessionId: "working-one", metadata: { ...session.value.metadata,
        source_path: "/controlled/working/sessions/active/working-one/source" } }) });
      return () => Vue.h("div");
    } });
    provideConversationFixture(workingApp, { on() {}, off() {} }, "local");
    workingApp.provide("jskit.shell-web.runtime.web-error.client", { dismiss() {}, report() { return { skipped: true }; } });
    workingApp.use(VueQueryPlugin, { queryClient }); workingApp.mount({});
    try {
      await vi.waitFor(() => expect(working.loading.value).toBe(false));
      await Vue.nextTick();
      working.terminal.applyTerminalSession({ id: "working-output", status: "running" });
      await expect(working.terminal.sendCtrlC()).resolves.toBe(true);
      expect(sockets.flatMap(socket => socket.sent).filter(message => message.type === "input"))
        .toEqual([{ type: "input", data: "\u0003" }]);
      expect(requests.filter(request => request.options.method === "POST")).toHaveLength(1);
    } finally { workingApp.unmount(); }
  } finally { app.unmount(); queryClient.clear(); resetHttpWebClientForTests(); vi.unstubAllGlobals(); }
});
