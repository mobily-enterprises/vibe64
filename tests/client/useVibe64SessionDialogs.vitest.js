import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ useCommand: vi.fn(), save: vi.fn(), error: vi.fn(), success: vi.fn() }));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));
// The archive request: each send's payload and options go to `save`.
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => ({ save: (...args) => commandMocks.save(...args) })
}));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({ error: commandMocks.error, success: commandMocks.success })
}));
import { useVibe64SessionDialogs } from "../../src/composables/useVibe64SessionDialogs.js";

function dialogOptions(overrides = {}) {
  return {
    beginArchive: vi.fn(),
    finishArchive: vi.fn(),
    isSelectedSessionArchived: ref(false),
    refreshSessionData: vi.fn(async () => null),
    selectedSessionId: ref("session-1"),
    selectedSessionTitle: ref("Session one"),
    sessionsApiPath: ref("/api/app/project/example/vibe64/sessions"),
    ...overrides
  };
}

describe("useVibe64SessionDialogs", () => {
  beforeEach(() => {
    commandMocks.save.mockReset();
    commandMocks.save.mockResolvedValue({ ok: true });
    commandMocks.error.mockReset();
    commandMocks.success.mockReset();
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = await commandMocks.save(context);
        await options.onRunSuccess?.(response, { context });
        return response;
      })
    }));
  });

  it("opens and cancels the archive confirmation", () => {
    const dialogs = useVibe64SessionDialogs(dialogOptions());
    dialogs.request();
    expect(dialogs.open.value).toBe(true);
    expect(dialogs.sessionTitle.value).toBe("Session one");
    dialogs.cancel();
    expect(dialogs.open.value).toBe(false);
  });

  it("switches away before awaiting archival and refreshes after completion", async () => {
    const selectedSessionId = ref("session-1");
    const beginArchive = vi.fn(() => {
      selectedSessionId.value = "";
    });
    const refreshSessionData = vi.fn(async () => null);
    const dialogs = useVibe64SessionDialogs(dialogOptions({
      beginArchive,
      refreshSessionData,
      selectedSessionId
    }));

    dialogs.request();
    await dialogs.confirm();

    expect(beginArchive).toHaveBeenCalledOnce();
    expect(refreshSessionData).toHaveBeenCalledWith({
      reason: "archive-session"
    });
    expect(dialogs.archiving.value).toBe(false);
  });

  it("restores availability when archiving fails", async () => {
    commandMocks.save.mockRejectedValueOnce(new Error("Archive failed."));
    const beginArchive = vi.fn();
    const dialogs = useVibe64SessionDialogs(dialogOptions({ beginArchive }));

    dialogs.request();
    expect(await dialogs.confirm()).toBe(false);
    expect(beginArchive).toHaveBeenCalledOnce();
    expect(dialogs.archiving.value).toBe(false);
  });

  it("rejects a structured archive failure instead of reporting success", async () => {
    commandMocks.save.mockResolvedValueOnce({
      errors: [{ message: "The failed session could not be archived." }],
      ok: false
    });
    const beginArchive = vi.fn();
    const refreshSessionData = vi.fn(async () => null);
    const dialogs = useVibe64SessionDialogs(dialogOptions({
      beginArchive,
      refreshSessionData
    }));

    dialogs.request();
    expect(await dialogs.confirm()).toBe(false);
    expect(beginArchive).toHaveBeenCalledOnce();
    expect(refreshSessionData).toHaveBeenCalledOnce();
  });

  // A hosted workspace's edge ends a request after about a minute, and stopping a session's work and removing its
  // source can take longer.
  it("repeats an archive the server holds with the same request id until its outcome, showing one success", async () => {
    commandMocks.save
      .mockResolvedValueOnce({ ok: true, archiving: true, requestId: "held", waitingFor: "stopping" })
      .mockResolvedValueOnce({ ok: true, sessionId: "session-1", status: "archived" });
    const dialogs = useVibe64SessionDialogs(dialogOptions());
    dialogs.request();
    await expect(dialogs.confirm()).resolves.toMatchObject({ ok: true, status: "archived" });
    const [[first, firstOptions], [second]] = commandMocks.save.mock.calls;
    expect(first.requestId).toMatch(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u);
    expect(first.repeat).toBeUndefined();
    expect(firstOptions).toMatchObject({ method: "POST", path: "/api/app/project/example/vibe64/sessions/session-1/archive" });
    expect(second).toMatchObject({ requestId: first.requestId, repeat: true });
    expect(commandMocks.success).toHaveBeenCalledTimes(1);
    expect(commandMocks.error).not.toHaveBeenCalled();
  });

  it("says with the success that the session was archived without its turn checkpoints, and why", async () => {
    commandMocks.save.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-1",
      status: "archived",
      metadata: { source_recovery_checkpoint_backup_error: "Backing up the session's turn checkpoints took longer than 60 s." }
    });
    const dialogs = useVibe64SessionDialogs(dialogOptions());
    dialogs.request();
    await dialogs.confirm();
    expect(commandMocks.success).toHaveBeenCalledWith(
      "Vibe64 session archived without its turn checkpoints: Backing up the session's turn checkpoints took longer than 60 s."
    );
    expect(commandMocks.error).not.toHaveBeenCalled();
  });

  it.each([0, 502, 504])("repeats an archive whose answer was lost with status %s, and never shows that failure", async (status) => {
    vi.useFakeTimers();
    try {
      commandMocks.save
        .mockRejectedValueOnce(Object.assign(new Error(`Request failed with status ${status}.`), { status }))
        .mockResolvedValueOnce({ ok: true, sessionId: "session-1", status: "archived" });
      const dialogs = useVibe64SessionDialogs(dialogOptions());
      dialogs.request();
      const archiving = dialogs.confirm();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(archiving).resolves.toMatchObject({ ok: true });
      expect(commandMocks.save.mock.calls[1][0].repeat).toBe(true);
      expect(commandMocks.error).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
