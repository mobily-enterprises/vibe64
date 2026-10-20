import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, markRaw, nextTick, reactive, ref } from "vue";

const surfaceHost = vi.hoisted(() => ({ outputs: null, projectSlug: null }));
vi.mock("@/composables/useVibe64OutputControls.js", async original => ({
  ...await original(), useVibe64OutputControls: () => surfaceHost.outputs
}));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => surfaceHost.projectSlug }));

import {
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
} from "../../packages/vibe64-terminals/src/shared/launchPreviewProtocol.js";
import {
  defaultPreviewIdentitySelection,
  launchPreviewAddressNavigationUrl,
  launchPreviewEmptyText,
  launchPreviewFrameUrl,
  isPreviewBridgeReadyMessage,
  previewFrameLifecycleIdentity,
  previewIdentityFromExchange,
  previewIdentityLabelText,
  previewIdentityLifecycleIdentity,
  previewIdentityTitleText,
  previewLoadingOverlayShouldShow,
  launchPreviewIssue,
  launchPreviewInFlightText,
  launchPreviewNotice,
  launchPreviewStatusText,
  launchToolbarDockShouldShow,
  normalizeConfiguredPreviewIdentities,
  previewAddressDisplayText,
  previewOpeningOverlayVisible,
  previewRouteFromUrl,
  previewUrlForRoute,
  redactPreviewDebugDetails,
  useVibe64OutputControlsSurface
} from "../../src/composables/useVibe64OutputControlsSurface.js";

describe("Vibe64 launch controls surface", () => {
  it("keeps launch lifecycle text stable during background polling", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      launchStarting: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      launchStarting: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      previewState: "starting"
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true,
      terminalIsRunning: true
    })).toBe("Preparing preview.");

    expect(launchPreviewEmptyText({
      loading: true
    })).toBe("Checking preview status.");

    expect(launchPreviewEmptyText({
      previewManualStartAvailable: true
    })).toBe("Preview is not running. Start it to see the app.");
  });

  it("explains non-web outputs without waiting for a web server", () => {
    expect(launchPreviewEmptyText({ nonWebOutputsAvailable: true }))
      .toBe("This project has no web preview. Use Run to choose an output; terminal output and downloads appear here.");
    expect(launchPreviewEmptyText({ nonWebOutputsAvailable: true, previewStartUnavailableReason: "Set API_TOKEN in Env." }))
      .toBe("Set API_TOKEN in Env.");
    expect(launchPreviewEmptyText({ nonWebOutputsAvailable: true, terminalIsRunning: true }))
      .toBe("Preparing preview.");
  });

  it("does not call idle auto-start placeholders preparing preview", () => {
    expect(launchPreviewEmptyText({
      previewAutoStartPreparing: true
    })).toBe("Preview will appear here when it is ready.");
  });

  it("surfaces server preview failures before generic loading state", () => {
    expect(launchPreviewEmptyText({
      loading: true,
      previewMessage: "No launch preview proxy port is available.",
      previewState: "failed"
    })).toBe("No launch preview proxy port is available.");
  });

  it("describes launch status loading and failures with attempt numbers", () => {
    expect(launchPreviewStatusText({
      attempt: 2,
      loading: true
    })).toBe("Checking preview status (attempt 2).");

    expect(launchPreviewStatusText({
      attempt: 3,
      loadError: "Log in to Vibe64."
    })).toBe("Preview status request failed (attempt 3).");

    expect(launchPreviewEmptyText({
      launchStatusText: "Preview status request failed (attempt 3).",
      loading: true
    })).toBe("Preview status request failed (attempt 3).");
  });

  it("clears the opening overlay after the iframe load marks the preview URL ready", () => {
    expect(previewOpeningOverlayVisible({
      previewFrameRequestId: 1,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 1,
      previewUrl: "https://preview.example.test/home"
    })).toBe(false);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 2,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);

    expect(previewOpeningOverlayVisible({
      loadedFrameRequestId: 1,
      previewFrameRequestId: 2,
      previewUrl: ""
    })).toBe(false);
  });

  it("recognizes the preview bridge ready handshake without treating navigation as readiness", () => {
    expect(isPreviewBridgeReadyMessage({
      type: PREVIEW_BRIDGE_READY_MESSAGE_TYPE
    })).toBe(true);

    expect(isPreviewBridgeReadyMessage({
      reason: "ready",
      type: "vibe64:preview-location"
    })).toBe(false);

    expect(isPreviewBridgeReadyMessage({
      type: "vibe64:preview-identity-response"
    })).toBe(false);
  });

  it("treats a starting server state as preparing preview", () => {
    expect(launchPreviewEmptyText({
      loading: false,
      previewState: "starting"
    })).toBe("Preparing preview.");
  });

  it("uses neutral copy when no launch state is available yet", () => {
    expect(launchPreviewEmptyText()).toBe("Preview will appear here when it is ready.");
  });

  it("explains an idle preview after output discovery proves there is nothing to run", () => {
    expect(launchPreviewEmptyText({
      outputTargetsUnavailable: true,
      previewMessage: "Run an output target first."
    })).toBe("No runnable output is declared. You can continue working in the conversation.");
  });

  it("surfaces a manual start state when an embedded target can be launched", () => {
    expect(launchPreviewEmptyText({
      previewManualStartAvailable: true
    })).toBe("Preview is not running. Start it to see the app.");
  });

  it("does not call unavailable embedded launch targets ready to start", () => {
    expect(launchPreviewEmptyText({
      previewManualStartAvailable: false,
      previewStartUnavailableReason: "Install dependencies before running the app."
    })).toBe("Install dependencies before running the app.");
  });

  it("describes the exact embedded preview operation while it is in flight", () => {
    expect(launchPreviewInFlightText({
      launchWaiting: true,
      loading: true
    })).toBe("Waiting for the current workspace operation to finish. Preview will retry automatically.");

    expect(launchPreviewInFlightText({
      embeddedStartTarget: {
        id: "dev",
        label: "Run app"
      },
      launchStarting: true
    })).toBe("Starting preview: Run app.");

    expect(launchPreviewInFlightText({
      activeOutputTarget: {
        id: "dev",
        label: "Run app"
      },
      terminalIsRunning: true
    })).toBe("Waiting for preview URL from Run app.");

    expect(launchPreviewInFlightText({
      previewDisplayedAddress: "/dashboard",
      previewLoadingOverlayVisible: true,
      previewUrl: "https://preview.example.test/dashboard"
    })).toBe("Loading preview page: /dashboard. The server is ready; the browser is still loading the app.");

    expect(launchPreviewInFlightText({
      previewEmbedUnavailableReason: "HTTP previews cannot be embedded from HTTPS Studio."
    })).toBe("HTTP previews cannot be embedded from HTTPS Studio.");
  });

  it("uses exact in-flight copy ahead of generic preview placeholders", () => {
    expect(launchPreviewEmptyText({
      launchStarting: true,
      previewInFlightText: "Starting preview: Run app."
    })).toBe("Starting preview: Run app.");
  });

  it("surfaces server restart preview recovery", () => {
    expect(launchPreviewNotice({
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      state: "failed"
    })).toEqual({
      message: "Preview state was lost after a server restart. Restart preview to recover.",
      title: "Preview could not be opened"
    });
  });

  it("surfaces launch request failures before server preview state exists", () => {
    const launchError = "Runtime config is missing required dev value(s) for preview, server: VIBE64_PUBLIC_SOURCE_ROOT.";

    expect(launchPreviewIssue({
      launchError,
      state: "idle"
    })).toEqual({
      message: launchError,
      title: "Preview could not be started"
    });
    expect(launchPreviewNotice({
      launchError,
      state: "idle"
    })).toEqual({
      message: launchError,
      title: "Preview could not be started"
    });
  });

  it("surfaces stale server-side preview recovery as non-blocking attention", () => {
    expect(launchPreviewNotice({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      state: "stale"
    })).toBeNull();

    expect(launchPreviewIssue({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      state: "stale"
    })).toEqual({
      message: "Server-side app files changed after this preview started. Restart preview to run the current code.",
      title: "Preview may be stale"
    });
  });

  it("surfaces stopped preview processes as diagnostics", () => {
    expect(launchPreviewNotice({
      message: "The preview process exited with code 1.",
      state: "failed"
    })).toEqual({
      message: "The preview process exited with code 1.",
      title: "Preview could not be opened"
    });
  });

  it("shows a recovered preview after an overlapping start request failed", () => {
    const launchError = "Another assistant operation is starting. Try again in a moment.";
    expect(launchPreviewIssue({ launchError, state: "idle" })).toEqual({
      message: launchError,
      title: "Preview could not be started"
    });
    expect(launchPreviewIssue({ launchError, state: "ready" })).toBeNull();
    expect(launchPreviewNotice({ launchError, state: "ready" })).toBeNull();
    expect(launchPreviewIssue({ state: "failed", message: "Process exited" })).toEqual({
      message: "Process exited",
      title: "Preview could not be opened"
    });
  });

  it("routes stopped preview processes through toolbar attention", () => {
    expect(launchPreviewIssue({
      message: "The preview process exited with code 0.",
      state: "stopped"
    })).toEqual({
      message: "The preview process exited with code 0.",
      title: "Preview stopped"
    });
  });

  it("does not duplicate embedded preview diagnostics with the toolbar dock", () => {
    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      previewIssueVisible: true,
      terminalVisible: true
    })).toBe(true);

    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      embeddedTerminalVisible: true,
      terminalVisible: true
    })).toBe(true);

    expect(launchToolbarDockShouldShow({
      embeddedPreview: false,
      terminalDockVisible: true,
      terminalVisible: true
    })).toBe(true);
  });

  it("keeps the toolbar dock available for preview attention", () => {
    expect(launchToolbarDockShouldShow({
      embeddedPreview: true,
      previewIssueVisible: true
    })).toBe(true);
  });

  it("builds one immutable frame URL for the current route", () => {
    expect(launchPreviewFrameUrl({
      baseUrl: "http://127.0.0.1:4188/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      visitedUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files"
    })).toBe("http://127.0.0.1:4188/jobs/42?tab=docs#files");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://preview.example.test/home",
      displayBaseUrl: "https://preview.example.test/home",
      visitedUrl: "https://preview.example.test/settings?tab=users#invite"
    })).toBe("https://preview.example.test/settings?tab=users#invite");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://new-preview.example.test/home",
      displayBaseUrl: "https://new-preview.example.test/home",
      visitedUrl: "https://old-preview.example.test/admin/jobs/42?tab=docs#files"
    })).toBe("https://new-preview.example.test/admin/jobs/42?tab=docs#files");

    expect(launchPreviewFrameUrl({
      baseUrl: "https://preview.example.test/home?vibe64_preview_token=abc",
      displayBaseUrl: "https://app.example.test/home",
      visitedUrl: "https://app.example.test/jobs/42?tab=docs#files"
    })).toBe("https://preview.example.test/jobs/42?tab=docs&vibe64_preview_token=abc#files");
  });

  it("keeps preview lifecycle identity stable across output-only proxy token changes", () => {
    const lifecycle = {
      outputTargetId: "dev",
      sessionId: "session-1",
      terminalSessionId: "terminal-1"
    };

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=second"
    }));

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).not.toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?tab=users&vibe64_preview_token=first"
    }));

    expect(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first"
    })).not.toBe(previewFrameLifecycleIdentity({
      ...lifecycle,
      src: "https://preview.example.test/settings?vibe64_preview_token=first",
      terminalSessionId: "terminal-2"
    }));
  });

  it("resets preview identity state only when its project, session, terminal, or app route changes", () => {
    const lifecycle = {
      outputTargetId: "dev",
      previewBaseUrl: "https://preview.example.test/settings?vibe64_preview_token=first",
      projectSlug: "catalog",
      sessionId: "session-1",
      terminalSessionId: "terminal-1"
    };

    expect(previewIdentityLifecycleIdentity(lifecycle)).toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      previewBaseUrl: "https://preview.example.test/settings?vibe64_preview_token=second"
    }));
    expect(previewIdentityLifecycleIdentity(lifecycle)).not.toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      terminalSessionId: "terminal-2"
    }));
    expect(previewIdentityLifecycleIdentity(lifecycle)).not.toBe(previewIdentityLifecycleIdentity({
      ...lifecycle,
      sessionId: "session-2"
    }));
  });

  it("presents confirmed, switching, guest, and recoverable failure identity states", () => {
    const configuredIdentity = {
      email: "ada@example.com",
      mode: "identity",
      name: "admin"
    };
    expect(previewIdentityLabelText({ identity: configuredIdentity })).toBe("admin — ada@example.com");
    expect(previewIdentityLabelText({ identity: { mode: "guest" } })).toBe("Guest");
    expect(previewIdentityLabelText({
      identity: {
        email: "grace@example.com",
        mode: "identity",
        name: "worker",
        username: "Grace"
      }
    })).toBe("worker — grace@example.com");
    expect(previewIdentityTitleText({ busy: true })).toBe("Switching preview identity…");
    expect(previewIdentityTitleText({
      error: "User not found.",
      identity: { mode: "guest" }
    })).toBe("Preview identity failed: User not found.");
    expect(previewLoadingOverlayShouldShow({
      identityBusy: true,
      loadedFrameRequestId: 4,
      previewFrameRequestId: 4,
      previewUrl: "https://preview.example.test/home"
    })).toBe(true);
    expect(defaultPreviewIdentitySelection({
      capability: {
        defaultIdentityName: "admin",
        defaultMode: "identity"
      }
    })).toEqual({
      identityName: "admin",
      mode: "identity"
    });
    expect(defaultPreviewIdentitySelection({
      capability: { defaultMode: "guest" }
    })).toEqual({
      mode: "guest"
    });
  });

  it("normalizes configured identity names across app-owned selector types", () => {
    expect(normalizeConfiguredPreviewIdentities([
      { name: "admin", type: "email", value: " GRACE@EXAMPLE.COM " },
      { name: "worker", type: "login", value: "merc" },
      { name: "auditor", type: "user-id", value: "user-7" },
      { name: "worker", type: "email", value: "duplicate@example.com" },
      { name: "", type: "email", value: "invalid@example.com" }
    ])).toEqual([
      {
        name: "admin",
        selector: { type: "email", value: "grace@example.com" },
        type: "email",
        value: "grace@example.com"
      },
      {
        name: "worker",
        selector: { type: "login", value: "merc" },
        type: "login",
        value: "merc"
      },
      {
        name: "auditor",
        selector: { type: "user-id", value: "user-7" },
        type: "user-id",
        value: "user-7"
      }
    ]);
  });

  it("uses the application's canonical identity after exchange without changing the selected mode", () => {
    expect(previewIdentityFromExchange({
      identity: {
        email: " ADA@EXAMPLE.COM ",
        selector: {
          type: "email",
          value: "ada@example.com"
        },
        userId: "user-7",
        username: "Ada"
      }
    }, {
      selector: {
        type: "email",
        value: "requested@example.com"
      },
      mode: "identity",
      name: "admin"
    })).toEqual({
      displayName: "Ada",
      email: "ada@example.com",
      login: "",
      mode: "identity",
      name: "admin",
      selector: {
        type: "email",
        value: "ada@example.com"
      },
      userId: "user-7",
      username: "Ada"
    });
    expect(previewIdentityFromExchange({}, {
      mode: "guest"
    })).toEqual({
      mode: "guest"
    });
  });

  it("stores preview location as a host-independent route", () => {
    expect(previewRouteFromUrl("https://old-preview.example.test/admin/jobs/42?tab=docs#files"))
      .toBe("/admin/jobs/42?tab=docs#files");
    expect(previewRouteFromUrl("/settings/users?tab=access"))
      .toBe("/settings/users?tab=access");

    expect(previewUrlForRoute(
      "/admin/jobs/42?tab=docs#files",
      "https://new-preview.example.test/home"
    )).toBe("https://new-preview.example.test/admin/jobs/42?tab=docs#files");
  });

  it("shows same-app preview addresses as clean routes", () => {
    expect(previewAddressDisplayText(
      "http://127.0.0.1:4100/?vibe64_preview_token=abc",
      {
        previewBaseUrl: "http://127.0.0.1:4100/?vibe64_preview_token=abc"
      }
    )).toBe("/");

    expect(previewAddressDisplayText(
      "http://127.0.0.1:4100/jobs/42?tab=docs&vibe64_preview_token=abc#files",
      {
        displayBaseUrl: "http://127.0.0.1:4100/"
      }
    )).toBe("/jobs/42?tab=docs#files");

    expect(previewAddressDisplayText(
      "https://example.test/jobs?vibe64_preview_token=abc",
      {
        displayBaseUrl: "http://127.0.0.1:4100/"
      }
    )).toBe("https://example.test/jobs");
  });

  it("redacts preview bearer tokens from nested debug details", () => {
    const redacted = redactPreviewDebugDetails({
      frame: "https://preview.example.test/home?vibe64_preview_token=secret&tab=one",
      nested: ["/home?vibe64_preview_token=secret#section"]
    });

    expect(JSON.stringify(redacted)).not.toContain("secret");
    expect(redacted.frame).toBe("https://preview.example.test/home?tab=one");
    expect(redacted.nested).toEqual(["/home#section"]);
  });

  it("maps entered preview addresses from display URLs to embedded proxy URLs", () => {
    expect(launchPreviewAddressNavigationUrl({
      address: "/jobs/42?tab=docs#files",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/jobs/42?tab=docs#files"
    });

    expect(launchPreviewAddressNavigationUrl({
      address: "settings/users",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    }).previewUrl).toBe("http://127.0.0.1:4188/settings/users");

    expect(launchPreviewAddressNavigationUrl({
      address: "/jobs/42?tab=docs#files",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home?vibe64_preview_token=abc"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/jobs/42?tab=docs#files",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/jobs/42?tab=docs&vibe64_preview_token=abc#files"
    });
  });

  it("allows proxy-origin preview addresses but rejects external origins", () => {
    expect(launchPreviewAddressNavigationUrl({
      address: "http://127.0.0.1:4188/admin",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    })).toEqual({
      displayUrl: "http://127.0.0.1:4103/admin",
      error: "",
      ok: true,
      previewUrl: "http://127.0.0.1:4188/admin"
    });

    expect(launchPreviewAddressNavigationUrl({
      address: "https://example.com/",
      currentUrl: "http://127.0.0.1:4103/home",
      displayBaseUrl: "http://127.0.0.1:4103/home",
      previewBaseUrl: "http://127.0.0.1:4188/home"
    })).toEqual({
      displayUrl: "",
      error: "Preview URL must stay inside this app.",
      ok: false,
      previewUrl: ""
    });
  });
});


const mountedSurfaces = [];

it("keeps the same preview frame usable during edits, interruptions and goals", async () => {
  const f = mountPreviewSurface();
  const generation = f.state.previewFrameRequestId.value;
  f.props.busy = true;
  expect(f.state.previewWorkNotice.value).toBe("Work in progress");
  expect(f.state.previewFrameRequestId.value).toBe(generation);
  expect(f.state.previewFrame.value).toBe(f.frame);
  f.props.previewGoalState = { enabled: true, pending: false, goal: { status: "active" } };
  f.props.session.agentSession = { turn: { state: "interrupted" } };
  f.props.busy = false;
  await nextTick();
  expect(f.state.previewWorkNotice.value).toBe("");
  expect(f.state.previewFrameRequestId.value).toBe(generation);
  f.props.sourceOperationsSuspended = true;
  expect(f.state.previewWorkNotice.value).toBe("Work in progress");
  f.props.sourceOperationsSuspended = false;
  expect(f.state.previewWorkNotice.value).toBe("");
});

it("queues generic preview recovery until edits stop, including an interruption", async () => {
  const f = mountPreviewSurface();
  f.outputs.terminalCanRestart.value = true;
  f.props.busy = true;
  f.outputs.previewState.value = "failed";
  await nextTick();
  expect(f.state.previewWorkNotice.value).toBe("Server will be restarted soon");
  expect(f.outputs.run).not.toHaveBeenCalled();
  expect(f.state.previewNoticeVisible.value).toBe(false);
  f.props.session.agentSession = { turn: { state: "interrupted" } };
  f.props.sourceOperationsSuspended = true;
  f.props.busy = false;
  await nextTick();
  expect(f.outputs.run).not.toHaveBeenCalled();
  f.props.sourceOperationsSuspended = false;
  await nextTick(); await nextTick(); await nextTick();
  expect(f.outputs.run).toHaveBeenCalledTimes(1);
  expect(f.outputs.run).toHaveBeenCalledWith(expect.objectContaining({ id: "app" }),
    expect.objectContaining({ forceRestart: true }));
});

it("does not loop after a failed recovery or interfere with managed browser tests", async () => {
  const f = mountPreviewSurface();
  f.outputs.terminalCanRestart.value = true;
  f.outputs.run.mockResolvedValue(false);
  f.outputs.previewState.value = "failed";
  await vi.waitFor(() => {
    expect(f.outputs.run).toHaveBeenCalledTimes(1);
    expect(f.state.previewWorkNotice.value).toBe("");
  });
  expect(f.state.previewNoticeVisible.value).toBe(true);
  f.outputs.previewMessage.value = "Still unavailable";
  await nextTick();
  expect(f.outputs.run).toHaveBeenCalledTimes(1);
  f.outputs.previewState.value = "ready";
  f.outputs.previewTestNotice.value = { title: "Test Preview", message: "Browser tests in progress" };
  await nextTick();
  f.outputs.previewState.value = "failed";
  await nextTick();
  expect(f.outputs.run).toHaveBeenCalledTimes(1);
});

it.each(["resourceAdmissionId", "testApproval"])("leaves %s recovery to its original controls", async field => {
  const f = mountPreviewSurface();
  f.outputs.terminalCanRestart.value = true;
  f.outputs[field].value = field === "resourceAdmissionId" ? "held-admission" : { state: "waiting" };
  f.outputs.previewState.value = "failed";
  await nextTick(); await nextTick();
  expect(f.outputs.refresh).not.toHaveBeenCalled();
  expect(f.outputs.run).not.toHaveBeenCalled();
  expect(f.state.previewWorkNotice.value).toBe("");
});

it.each(["ready", "starting"])("keeps a %s preview found by the fresh recovery read", async state => {
  const f = mountPreviewSurface();
  f.outputs.terminalCanRestart.value = true;
  f.outputs.refresh.mockImplementation(async () => { f.outputs.previewState.value = state; });
  f.outputs.previewState.value = "failed";
  await vi.waitFor(() => expect(f.outputs.refresh).toHaveBeenCalledTimes(1));
  await nextTick(); await nextTick();
  expect(f.outputs.run).not.toHaveBeenCalled();
  expect(f.state.previewWorkNotice.value).toBe("");
});

it.each(["project", "session"])("does not recover a changed %s after the fresh status read", async scope => {
  const f = mountPreviewSurface();
  const read = Promise.withResolvers();
  const successorRead = Promise.withResolvers();
  f.outputs.terminalCanRestart.value = true;
  f.outputs.refresh.mockReturnValueOnce(read.promise).mockReturnValue(successorRead.promise);
  f.outputs.previewState.value = "failed";
  await vi.waitFor(() => expect(f.outputs.refresh).toHaveBeenCalledTimes(1));
  if (scope === "project") surfaceHost.projectSlug.value = "another-project";
  else f.props.session.sessionId = "session-b";
  read.resolve();
  await nextTick(); await nextTick(); await nextTick();
  expect(f.outputs.run).not.toHaveBeenCalled();
  // A new session owns a separate refresh; the retired read cannot start it.
  f.outputs.previewState.value = "ready";
  successorRead.resolve();
  await nextTick(); await nextTick();
  expect(f.outputs.run).not.toHaveBeenCalled();
});
afterEach(() => {
  for (const fixture of mountedSurfaces.splice(0)) fixture.dispose();
  vi.unstubAllGlobals();
});
function mountPreviewSurface() {
  // Supply the existing output owner's read state, not an alternate bridge.
  const outputs = Object.fromEntries([
    "launchButtonsDisabled", "loading", "loadError", "operationBusy", "launchError", "launchStarting", "launchWaiting",
    "outputTargetsLoaded", "terminalDisplayed", "terminalDockVisible", "terminalExpanded", "terminalCanRestart",
    "terminalCanRetry", "terminalCanStart", "terminalError", "terminalStatus", "terminalTitle", "terminalSubtitle",
    "terminalCommandPreview", "terminalIndicatorLabel", "terminalIndicatorState", "terminalVisible", "terminalIsRunning",
    "terminalPreviewRequiresProxy", "terminalWindowVisible", "terminalWindowStorageKey", "previewCanRestart", "previewCanShowLog",
    "previewCanStart", "previewStoppedIntent", "previewMessage", "previewIdentity", "outputExecution", "outputResults", "outputRuns", "visible", "launchStatusAttempt"
  ].map(name => [name, ref(false)]));
  const target = { id: "app", presentation: { kind: "web" } };
  Object.assign(outputs, { activeOutputTarget: ref(target), outputTargets: ref([target]), previewState: ref("ready"),
    previewTestNotice: ref(null), resourceAdmissionId: ref(""), testApproval: ref(null), run: vi.fn(async () => ({ ok: true })),
    terminal: ref({ metadata: { outputTargetId: "app" } }), terminalSessionId: ref("terminal-a"),
    launchActions: ref([{ href: "https://preview.example.test/" }]), requestPreviewIdentityGrant: vi.fn(), publishPreviewState: vi.fn(), publishPreviewDiagnostic: vi.fn(async () => true), refresh: vi.fn(async () => {}), restartTerminal: vi.fn(async () => ({ ok: true })) });
  surfaceHost.outputs = outputs;
  surfaceHost.projectSlug = ref("project-a");
  const windowListeners = new Map();
  const documentListeners = new Map();
  const windowObject = { innerWidth: 1280, innerHeight: 800, location: { href: "https://studio.example.test/app" },
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    removeEventListener(type) { windowListeners.delete(type); } };
  const documentObject = { visibilityState: "visible", addEventListener(type, handler) { documentListeners.set(type, handler); },
    removeEventListener(type) { documentListeners.delete(type); } };
  vi.stubGlobal("window", windowObject);
  vi.stubGlobal("document", documentObject);
  const props = reactive({ embeddedPreview: true, previewDisplayed: true, windowDisplayed: true,
    session: { sessionId: "session-a" } });
  let state;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() {
    state = useVibe64OutputControlsSurface(props); return () => null;
  } });
  app.mount({});
  const posts = [];
  const frame = markRaw({ dataset: { previewFrameRequestId: String(state.previewFrameRequestId.value) },
    contentWindow: { postMessage(data, origin) { posts.push({ data, origin }); } } });
  state.previewFrame.value = frame;
  function announce(data, source = frame.contentWindow, origin = "https://preview.example.test") {
    windowListeners.get("message")({ data, source, origin, ports: [] });
  }
  function load() {
    state.handlePreviewFrameLoad({ currentTarget: frame });
  }
  const fixture = { state, props, outputs, posts, frame, windowListeners, documentListeners,
    documentObject, windowObject, announce, load,
    dispose() {
      vi.stubGlobal("window", windowObject);
      vi.stubGlobal("document", documentObject);
      app.unmount();
      expect(windowListeners.size).toBe(0);
      expect(documentListeners.size).toBe(0);
    } };
  mountedSurfaces.push(fixture);
  return fixture;
}

it("opt-in Preview diagnostics capture each failed module and retry without accepting a foreign iframe", async () => {
  vi.useFakeTimers();
  const f = mountPreviewSurface();
  const failure = { type: PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION,
    kind: "script", href: "https://preview.example.test/src/jobs.js?token=secret" };
  f.announce(failure);
  expect(f.outputs.publishPreviewDiagnostic).not.toHaveBeenCalled();
  f.windowObject.location.href += "?vibe64_preview_debug";
  f.announce({ ...failure, recover: false }, {}, "https://preview.example.test");
  f.announce({ ...failure, recover: false }, f.frame.contentWindow, "https://untrusted.example");
  expect(f.outputs.publishPreviewDiagnostic).not.toHaveBeenCalled();
  f.announce({ ...failure, recover: false });
  expect(f.outputs.publishPreviewDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: "resource.failed", resourceKind: "script" }));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(f.outputs.publishPreviewDiagnostic.mock.calls.some(([entry]) => entry.event === "resource.retry")).toBe(true);
  vi.useRealTimers();
});


it("suspends only its own frame, cancels retries and resumes the same route and app identity", async () => {
  vi.useFakeTimers();
  try {
    const f = mountPreviewSurface();
    const other = mountPreviewSurface();
    f.load();
    f.state.previewIdentityCurrent.value = { mode: "identity", name: "operator" };
    f.state.previewAddressDraft.value = "/jobs?status=open#today";
    f.state.submitPreviewAddress();
    const route = f.state.previewUrl.value;
    const otherUrl = other.state.previewUrl.value;
    f.announce({ type: PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE, kind: "script", href: "/app.js" });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    f.state.suspendPreview();
    expect(f.state.previewSuspended.value).toBe(true);
    expect(f.state.previewUrl.value).toBe("");
    expect(f.state.previewLoadingOverlayVisible.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    f.props.previewDisplayed = false; // Dashboard does not reset the person's choice.
    f.outputs.previewState.value = "starting";
    f.outputs.previewState.value = "ready";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.state.previewUrl.value).toBe("");
    f.props.previewDisplayed = true;
    await nextTick();
    expect(f.state.previewUrl.value).toBe("");
    expect(await f.state.reloadPreview()).toBe(false);
    expect(other.state.previewUrl.value).toBe(otherUrl);
    expect(other.state.previewSuspended.value).toBe(false);
    expect(f.outputs.run).not.toHaveBeenCalled();
    expect(f.outputs.restartTerminal).not.toHaveBeenCalled();
    expect(await f.state.resumePreview()).toBe(true);
    expect(f.state.previewUrl.value).toBe(route);
    expect(f.state.previewIdentityCurrent.value).toEqual({ mode: "identity", name: "operator" });
    expect(f.state.previewSuspended.value).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("does not resurrect a suspended frame from nested or retired bridge messages", () => {
  const f = mountPreviewSurface();
  f.load();
  f.state.suspendPreview();
  const frameId = f.state.previewFrameRequestId.value;
  f.announce({ type: PREVIEW_BRIDGE_READY_MESSAGE_TYPE, version: PREVIEW_BRIDGE_VERSION }, {});
  f.announce({ type: PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE, kind: "script", href: "/old.js" });
  f.load();
  expect(f.state.previewFrameRequestId.value).toBe(frameId);
  expect(f.state.previewUrl.value).toBe("");
  expect(f.state.previewFrameLoaded.value).toBe(false);
});

it("rejects an old Resume result after the selected session changes", async () => {
  const f = mountPreviewSurface();
  f.state.suspendPreview();
  let release;
  f.outputs.refresh.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const resumed = f.state.resumePreview();
  f.props.session = { sessionId: "session-b" };
  release();
  expect(await resumed).toBe(false);
  expect(f.state.previewSuspended.value).toBe(false);
  expect(f.state.previewUrl.value).toBe("");
});


it("retires an in-flight identity grant when the displayed preview is suspended", async () => {
  const f = mountPreviewSurface();
  let grant;
  f.outputs.requestPreviewIdentityGrant.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  f.outputs.previewIdentity.value = { available: true, identities: [{ name: "operator" }], defaultIdentity: "operator" };
  f.load();
  await nextTick();
  expect(f.outputs.requestPreviewIdentityGrant).toHaveBeenCalledTimes(1);
  f.state.suspendPreview();
  grant({ ok: true, grant: "unused-grant" });
  await nextTick(); await nextTick();
  expect(f.state.previewUrl.value).toBe("");
  expect(f.state.previewIdentityBusy.value).toBe(false);
  expect(f.state.previewIdentityError.value).toBe("");
  expect(f.posts.some(post => post.data.grant === "unused-grant")).toBe(false);
});


it("keeps ordinary Reload recoverable when it retires a pending identity grant", async () => {
  const f = mountPreviewSurface();
  let grant;
  f.outputs.requestPreviewIdentityGrant.mockImplementation(() => new Promise(resolve => { grant = resolve; }));
  f.outputs.previewIdentity.value = { available: true, identities: [{ name: "operator" }] };
  f.load();
  await nextTick();
  await f.state.reloadPreview();
  grant({ ok: true, grant: "retired-grant" });
  await nextTick(); await nextTick();
  expect(f.state.previewIdentityBusy.value).toBe(false);
  expect(f.state.previewIdentityError.value).toBe("");
  expect(f.posts.some(post => post.data.grant === "retired-grant")).toBe(false);
});

it("a page from a preview that stopped running is removed rather than left looking alive", async () => {
  const f = mountPreviewSurface();
  f.outputs.outputTargetsLoaded.value = true;
  expect(f.state.previewUrl.value).toMatch(/^https:\/\/preview\.example\.test\//u);
  f.outputs.previewState.value = "stale";
  expect(f.state.previewUrl.value, "a stale preview still runs").not.toBe("");
  f.outputs.previewState.value = "idle";
  expect(f.state.previewUrl.value).toBe("");
});
