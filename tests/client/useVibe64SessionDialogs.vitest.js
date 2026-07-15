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
});
