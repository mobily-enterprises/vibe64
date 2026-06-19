import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runError: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

import {
  runActionSuccessShouldRefreshSession
} from "../../src/composables/useVibe64SessionActions.js";
import {
  useVibe64SessionActions
} from "../../src/composables/useVibe64SessionActions.js";

describe("useVibe64SessionActions refresh ownership", () => {
  beforeEach(() => {
    commandMocks.runError = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        if (options.placementSource === "vibe64.sessions.intent" && commandMocks.runError) {
          try {
            await options.onRunError?.(commandMocks.runError, {
              context
            });
          } catch (error) {
            throw error;
          }
          throw commandMocks.runError;
        }
        return {
          ok: true
        };
      })
    }));
  });

  it("leaves successful action refresh to realtime", () => {
    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "done"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "saved"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);
  });

  it("refreshes session data when an intent result is stale", async () => {
    commandMocks.runError = {
      code: "vibe64_action_not_available",
      operationOutcome: "stale_operation",
      refreshRecommended: true,
      status: 409
    };
    const refreshSessionData = vi.fn(async () => null);
    const actions = useVibe64SessionActions({
      commandBusy: () => false,
      commandTerminal: {
        clear: vi.fn()
      },
      refreshSessionData,
      selectedSession: ref({
        currentStep: "changes_accepted",
        stepMachine: {
          status: "ready"
        }
      }),
      selectedSessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/example/vibe64/sessions")
    });

    await expect(actions.runIntentById({
      intentId: "accept_review"
    })).rejects.toMatchObject({
      code: "vibe64_action_not_available",
      ok: false,
      stale: true,
      status: 409
    });
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });
});
