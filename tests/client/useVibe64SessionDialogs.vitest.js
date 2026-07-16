import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@/composables/useVibe64DiffDialog.js", () => ({
  useVibe64DiffDialog: () => ({
    clearDiffDialog: vi.fn(),
    closeDiffDialog: vi.fn(),
    diffDialogOpen: ref(false),
    diffError: ref(""),
    diffLoading: ref(false),
    diffPayload: ref(null),
    loadDiff: vi.fn(),
    loadFullDiff: vi.fn(),
    openDiffDialog: vi.fn()
  })
}));

import {
  useVibe64SessionDialogs
} from "../../src/composables/useVibe64SessionDialogs.js";

describe("useVibe64SessionDialogs", () => {
  beforeEach(() => {
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = {
          ok: true
        };
        await options.onRunSuccess?.(response, {
          context
        });
        return response;
      })
    }));
  });

  it("dismisses confirmation and exposes the closing session while abandon is in flight", async () => {
    let finishRequest;
    const requestPending = new Promise((resolve) => {
      finishRequest = resolve;
    });
    commandMocks.useCommand.mockImplementationOnce((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        await requestPending;
        const response = {
          ok: true
        };
        await options.onRunSuccess?.(response, {
          context
        });
        return response;
      })
    }));
    const selectedSessionId = ref("session-1");
    const dialogs = useVibe64SessionDialogs({
      activeActionId: ref(""),
      clearSelectedSession: vi.fn(() => {
        selectedSessionId.value = "";
      }),
      isSelectedSessionClosed: ref(false),
      refreshSessionData: vi.fn(async () => null),
      runActionCommand: {
        run: vi.fn()
      },
      selectedSessionId,
      selectedSessionTitle: ref("Session one"),
      sessionsApiPath: ref("/api/app/project/example/vibe64/sessions")
    });

    dialogs.abandon.request();
    const abandonPromise = dialogs.abandon.confirm();

    expect(dialogs.abandon.open.value).toBe(false);
    expect(dialogs.abandon.closing.value).toBe(true);
    expect(dialogs.abandon.closingSessionId.value).toBe("session-1");
    expect(dialogs.abandon.closingSessionTitle.value).toBe("Session one");
    expect(selectedSessionId.value).toBe("session-1");

    finishRequest();
    await abandonPromise;

    expect(dialogs.abandon.closing.value).toBe(false);
    expect(dialogs.abandon.closingSessionId.value).toBe("");
    expect(dialogs.abandon.closingSessionTitle.value).toBe("");
  });

  it("restores the session pane when abandon fails", async () => {
    const failure = new Error("Abandon request failed.");
    commandMocks.useCommand.mockImplementationOnce(() => ({
      isRunning: false,
      message: "Vibe64 session could not be abandoned.",
      run: vi.fn(async () => {
        throw failure;
      })
    }));
    const selectedSessionId = ref("session-1");
    const clearSelectedSession = vi.fn();
    const dialogs = useVibe64SessionDialogs({
      activeActionId: ref(""),
      clearSelectedSession,
      isSelectedSessionClosed: ref(false),
      refreshSessionData: vi.fn(async () => null),
      runActionCommand: {
        run: vi.fn()
      },
      selectedSessionId,
      selectedSessionTitle: ref("Session one"),
      sessionsApiPath: ref("/api/app/project/example/vibe64/sessions")
    });

    dialogs.abandon.request();
    await expect(dialogs.abandon.confirm()).rejects.toThrow("Abandon request failed.");

    expect(dialogs.abandon.open.value).toBe(false);
    expect(dialogs.abandon.closing.value).toBe(false);
    expect(selectedSessionId.value).toBe("session-1");
    expect(clearSelectedSession).not.toHaveBeenCalled();
  });

  it("clears the abandoned selection before waiting for the session-list refresh", async () => {
    const events = [];
    const selectedSessionId = ref("session-1");
    let finishRefresh;
    const refreshSessionData = vi.fn(() => new Promise((resolve) => {
      events.push("refresh");
      finishRefresh = resolve;
    }));
    const clearSelectedSession = vi.fn(() => {
      events.push("clear-selection");
      selectedSessionId.value = "";
    });
    const dialogs = useVibe64SessionDialogs({
      activeActionId: ref(""),
      clearSelectedSession,
      isSelectedSessionClosed: ref(false),
      onAbandoned() {
        events.push("abandoned");
      },
      refreshSessionData,
      runActionCommand: {
        run: vi.fn()
      },
      selectedSessionId,
      selectedSessionTitle: ref("Session one"),
      sessionsApiPath: ref("/api/app/project/example/vibe64/sessions")
    });

    dialogs.abandon.request();
    expect(dialogs.abandon.open.value).toBe(true);

    const abandonPromise = dialogs.abandon.confirm();
    await vi.waitFor(() => {
      expect(refreshSessionData).toHaveBeenCalledTimes(1);
    });

    expect(dialogs.abandon.open.value).toBe(false);
    expect(clearSelectedSession).toHaveBeenCalledTimes(1);
    expect(selectedSessionId.value).toBe("");
    expect(events).toEqual([
      "clear-selection",
      "abandoned",
      "refresh"
    ]);

    finishRefresh();
    await abandonPromise;
  });

  it("refreshes independent source safety before showing abandon confirmation", () => {
    const refreshSourceSafety = vi.fn(async () => null);
    const dialogs = useVibe64SessionDialogs({
      activeActionId: ref(""),
      clearSelectedSession: vi.fn(),
      isSelectedSessionClosed: ref(false),
      refreshSessionData: vi.fn(async () => null),
      runActionCommand: {
        run: vi.fn()
      },
      selectedSessionId: ref("session-1"),
      selectedSessionTitle: ref("Session one"),
      sessionsApiPath: ref("/api/app/project/example/vibe64/sessions"),
      sourceSafety: ref({
        refresh: refreshSourceSafety,
        unsafe: true
      })
    });

    dialogs.abandon.request();

    expect(dialogs.abandon.open.value).toBe(true);
    expect(refreshSourceSafety).toHaveBeenCalledTimes(1);
    expect(dialogs.abandon.sourceSafety.value.unsafe).toBe(true);
  });
});
