import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ useCommand: vi.fn() }));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
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
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = { ok: true };
        await options.onRunSuccess?.(response, { context });
        return response;
      })
    }));
  });

  it("opens and cancels the archive confirmation", () => {
    const dialogs = useVibe64SessionDialogs(dialogOptions());
    dialogs.archive.request();
    expect(dialogs.archive.open.value).toBe(true);
    expect(dialogs.archive.sessionTitle.value).toBe("Session one");
    dialogs.archive.cancel();
    expect(dialogs.archive.open.value).toBe(false);
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

    dialogs.archive.request();
    await dialogs.archive.confirm();

    expect(beginArchive).toHaveBeenCalledOnce();
    expect(refreshSessionData).toHaveBeenCalledWith({
      includeList: true,
      reason: "archive-session"
    });
    expect(dialogs.archive.archiving.value).toBe(false);
  });

  it("restores availability when archiving fails", async () => {
    commandMocks.useCommand.mockImplementationOnce(() => ({
      isRunning: false,
      message: "Archive failed.",
      run: vi.fn(async () => {
        throw new Error("Archive failed.");
      })
    }));
    const beginArchive = vi.fn();
    const dialogs = useVibe64SessionDialogs(dialogOptions({ beginArchive }));

    dialogs.archive.request();
    expect(await dialogs.archive.confirm()).toBe(false);
    expect(beginArchive).toHaveBeenCalledOnce();
    expect(dialogs.archive.archiving.value).toBe(false);
  });

  it("rejects a structured archive failure instead of reporting success", async () => {
    commandMocks.useCommand.mockImplementationOnce((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = {
          errors: [{ message: "The failed session could not be archived." }],
          ok: false
        };
        await options.onRunSuccess?.(response, { context });
        return response;
      })
    }));
    const beginArchive = vi.fn();
    const refreshSessionData = vi.fn(async () => null);
    const dialogs = useVibe64SessionDialogs(dialogOptions({
      beginArchive,
      refreshSessionData
    }));

    dialogs.archive.request();
    expect(await dialogs.archive.confirm()).toBe(false);
    expect(beginArchive).toHaveBeenCalledOnce();
    expect(refreshSessionData).toHaveBeenCalledOnce();
  });
});


describe("explicit session archive eligibility", () => {
  it("refuses an ineligible active session without claiming it is archived and retains ordinary eligibility when enabled", () => {
    commandMocks.useCommand.mockImplementation(() => ({ isRunning: false, run: vi.fn(async () => ({ ok: true })) }));
    const archiveAllowed = ref(false);
    const options = dialogOptions({ archiveAllowed: () => archiveAllowed.value });
    const dialogs = useVibe64SessionDialogs(options);
    dialogs.archive.request();
    expect(options.isSelectedSessionArchived.value).toBe(false);
    expect(dialogs.archive.open.value).toBe(false);
    expect(dialogs.archive.sessionId.value).toBe("");
    expect(dialogs.archive.command.run).not.toHaveBeenCalled();
    archiveAllowed.value = true;
    dialogs.archive.request();
    expect(options.isSelectedSessionArchived.value).toBe(false);
    expect(dialogs.archive.open.value).toBe(true);
    expect(dialogs.archive.sessionId.value).toBe("session-1");
    dialogs.archive.cancel();
    const denied = useVibe64SessionDialogs(dialogOptions({ archiveAllowed: false }));
    denied.archive.request();
    expect(denied.archive.open.value).toBe(false);
  });
});
