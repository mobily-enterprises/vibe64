import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useVibe64SessionCommandTerminal
} from "../../src/composables/useVibe64SessionCommandTerminal.js";

describe("useVibe64SessionCommandTerminal", () => {
  it("refreshes after command completion without locally advancing the session", async () => {
    const selectedSessionId = ref("session-1");
    const selectedSession = ref({
      actionResults: [
        {
          actionId: "run_checks",
          at: "9999-01-01T00:00:00.000Z",
          status: "completed",
          stepId: "step_a"
        }
      ],
      currentStep: "step_a",
      next: {
        enabled: true,
        stepId: "step_b",
        visible: true
      },
      revision: 1,
      sessionId: "session-1",
      status: "active",
      stepMachine: {
        status: "done",
        stepId: "step_a"
      }
    });
    const refreshSessionData = vi.fn(async () => {
      selectedSession.value = {
        ...selectedSession.value,
        revision: 2,
        updatedAt: "2026-05-25T00:00:00.000Z"
      };
    });
    const goNext = vi.fn();
    const terminal = useVibe64SessionCommandTerminal({
      currentNext: computed(() => selectedSession.value.next),
      goNext,
      refreshSessionData,
      selectedSession,
      selectedSessionId
    });

    terminal.start({
      advanceOnSuccess: true,
      id: "run_checks",
      label: "Run checks"
    });

    await terminal.finished({
      actionId: "run_checks",
      exitCode: 0,
      sessionId: "session-1"
    });

    expect(refreshSessionData).toHaveBeenCalledTimes(1);
    expect(goNext).not.toHaveBeenCalled();
    expect(terminal.running.value).toBe(false);
    expect(terminal.visible.value).toBe(true);
  });
});
