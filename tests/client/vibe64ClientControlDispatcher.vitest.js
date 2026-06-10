import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/vibe64PresentationControls.js";
import {
  runVibe64ClientControl
} from "../../src/lib/vibe64ClientControlDispatcher.js";
import {
  ensureVibe64CodexThread
} from "@/lib/vibe64SessionApi.js";

vi.mock("@/lib/vibe64SessionApi.js", () => ({
  ensureVibe64CodexThread: vi.fn()
}));

describe("vibe64ClientControlDispatcher", () => {
  beforeEach(() => {
    vi.mocked(ensureVibe64CodexThread).mockReset();
  });

  it("dispatches the open diff control through the shared action contract", async () => {
    const openDialog = vi.fn();

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF
      }
    }, {
      diff: {
        openDialog
      }
    })).resolves.toBe(true);

    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("opens the right-pane diff surface when the caller provides one", async () => {
    const openDialog = vi.fn();
    const openDiffPane = vi.fn(() => true);

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF
      }
    }, {
      diff: {
        openDialog
      },
      openDiffPane
    })).resolves.toBe(true);

    expect(openDiffPane).toHaveBeenCalledTimes(1);
    expect(openDialog).not.toHaveBeenCalled();
  });

  it("dispatches Codex retry controls through app-server thread preparation", async () => {
    const refreshSessionData = vi.fn();
    vi.mocked(ensureVibe64CodexThread).mockResolvedValue({
      ok: true
    });

    await expect(runVibe64ClientControl({
      control: {
        action: VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
      }
    }, {
      refreshSessionData,
      sessionId: "session_123"
    })).resolves.toBe(true);

    expect(ensureVibe64CodexThread).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });

});
