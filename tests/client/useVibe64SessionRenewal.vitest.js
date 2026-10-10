import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renewalHarness = vi.hoisted(() => ({
  commandOptions: null,
  endpoint: null,
  feedbackErrors: null,
  patchRun: null,
  postRun: null,
  projectSlug: null
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => renewalHarness.endpoint
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options = {}) {
    renewalHarness.commandOptions.push(options);
    return {
      isRunning: false,
      run: async (context) => {
        try {
          const response = await (
            options.writeMethod === "PATCH"
              ? renewalHarness.patchRun(context)
              : renewalHarness.postRun(context)
          );
          return response && typeof response === "object" && !("viewerScope" in response)
            ? { ...response, viewerScope: `viewer-v1-${"1".repeat(32)}` }
            : response;
        } catch (error) {
          if (typeof options.onRunError === "function") {
            await options.onRunError(error, { context });
          }
          renewalHarness.feedbackErrors.push(error);
          throw error;
        }
      }
    };
  }
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => renewalHarness.projectSlug
}));

import {
  SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS,
  SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS,
  useVibe64SessionRenewal
} from "../../src/composables/useVibe64SessionRenewal.js";

const DRAFT_HASH = "a".repeat(64);
const SAVED_HASH = "b".repeat(64);
const VIEWER_SCOPE = `viewer-v1-${"1".repeat(32)}`;
const SECOND_VIEWER_SCOPE = `viewer-v1-${"2".repeat(32)}`;
const ASSISTANT_SELECTION = Object.freeze({
  agentId: "build",
  catalogRevision: `sha256:${"c".repeat(64)}`,
  engineId: "opencode",
  modelId: "glm-4.7-flash",
  modelProviderId: "zai",
  variantId: ""
});

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value))
  };
}

function renewalState(overrides = {}) {
  return {
    draft: {
      hash: DRAFT_HASH,
      revision: 1,
      text: "Generated handover",
      updatedAt: "2026-08-24T01:00:00.000Z"
    },
    operationKey: "renewal:session-1:one",
    renewalId: "renewal-one",
    revision: 1,
    sessionId: "session-1",
    stage: "draft_ready",
    status: "review",
    updatedAt: "2026-08-24T01:00:00.000Z",
    ...overrides
  };
}

function mountRenewal(overrides = {}) {
  const scope = effectScope();
  const active = overrides.active || ref(true);
  const draftStorage = Object.hasOwn(overrides, "draftStorage")
    ? overrides.draftStorage
    : memoryStorage();
  const focusSession = overrides.focusSession || vi.fn(async () => true);
  const refreshSessionData = overrides.refreshSessionData || vi.fn(async () => null);
  const selectSession = overrides.selectSession || vi.fn();
  const selectedSession = overrides.selectedSession || ref({
    assistantSelection: ASSISTANT_SELECTION,
    renewalAdvisory: {
      reason: "Consider renewal.",
      recommended: true,
      severity: "consider"
    },
    sessionId: "session-1",
    status: "active"
  });
  const selectedSessionId = overrides.selectedSessionId || ref("session-1");
  const controller = scope.run(() => useVibe64SessionRenewal({
    active,
    draftStorage,
    focusSession,
    refreshSessionData,
    selectSession,
    selectedSession,
    selectedSessionId,
    sessionsApiPath: ref("/api/app/project/example/vibe64/sessions")
  }));
  return {
    active,
    controller,
    focusSession,
    refreshSessionData,
    scope,
    selectedSession,
    selectedSessionId,
    selectSession
  };
}

beforeEach(() => {
  renewalHarness.commandOptions = [];
  renewalHarness.feedbackErrors = [];
  renewalHarness.projectSlug = ref("example");
  renewalHarness.endpoint = {
    data: ref({ ok: true, renewal: null, viewerScope: VIEWER_SCOPE }),
    isInitialLoading: ref(false),
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => renewalHarness.endpoint.data.value)
  };
  renewalHarness.patchRun = vi.fn();
  renewalHarness.postRun = vi.fn();
});

describe("useVibe64SessionRenewal", () => {
  it("hydrates an editable review immediately from warm resource data", () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const { controller, scope } = mountRenewal();

    expect(controller.phase.value).toBe("review");
    expect(controller.draftText.value).toBe("Generated handover");
    expect(controller.canConfirm.value).toBe(true);
    expect(controller.advisoryPresentation.value).toMatchObject({
      attention: true,
      label: "Consider renewal"
    });

    scope.stop();
  });

  it("does not confirm an untouched manual handover template", () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        manualRequired: true,
        manualTemplateHash: DRAFT_HASH
      })
    };
    const { controller, scope } = mountRenewal();

    expect(controller.canConfirm.value).toBe(false);
    expect(controller.draftError.value).toBe(
      "Complete every handover section before creating the fresh session."
    );

    controller.setDraftText("Completed manual handover");
    expect(controller.canConfirm.value).toBe(true);
    expect(controller.draftError.value).toBe("");

    scope.stop();
  });

  it("keeps the predecessor actionable and presents background lifecycle status", async () => {
    const selectedSession = ref({
      sessionId: "session-1",
      status: "active"
    });
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 2,
        stage: "successor_setup",
        status: "running"
      })
    };
    const { controller, scope } = mountRenewal({ selectedSession });

    expect(controller.visible.value).toBe(true);
    expect(controller.actionPresentation.value).toEqual({
      attention: true,
      color: "primary",
      label: "Renewal in progress",
      reason: "Preparing the fresh workspace…"
    });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        error: { message: "Fresh-session activation needs attention.", retryable: true },
        revision: 3,
        stage: "successor_activating",
        status: "failed"
      })
    };
    await nextTick();

    expect(controller.visible.value).toBe(true);
    expect(controller.actionPresentation.value).toEqual({
      attention: true,
      color: "error",
      label: "Renewal needs attention",
      reason: "Fresh-session activation needs attention."
    });
    controller.request();
    expect(controller.open.value).toBe(true);

    scope.stop();
  });

  it("orders renewal snapshots by durable revision instead of timestamp", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 4,
        updatedAt: "2026-08-24T01:00:00.000Z"
      })
    };
    const { controller, scope } = mountRenewal();

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 5,
        stage: "old_quiescing",
        status: "running",
        updatedAt: "2026-08-24T01:00:00.000Z"
      })
    };
    await nextTick();
    expect(controller.renewal.value).toMatchObject({
      revision: 5,
      status: "running"
    });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 4,
        stage: "completed",
        status: "completed",
        successor: { sessionId: "stale-session" },
        updatedAt: "2026-08-24T01:10:00.000Z"
      })
    };
    await nextTick();
    expect(controller.renewal.value).toMatchObject({
      revision: 5,
      status: "running"
    });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 5,
        stage: "completed",
        status: "completed",
        successor: { sessionId: "same-revision-stale-session" },
        updatedAt: "2026-08-24T01:10:00.000Z"
      })
    };
    await nextTick();
    expect(controller.renewal.value).toMatchObject({
      revision: 5,
      status: "running"
    });

    scope.stop();
  });

  it("keeps unsaved handovers isolated by authenticated viewer in one tab", async () => {
    const draftStorage = memoryStorage();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const { controller, scope } = mountRenewal({ draftStorage });
    controller.setDraftText("Private edit for viewer one");

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: SECOND_VIEWER_SCOPE,
      renewal: renewalState()
    };
    await nextTick();
    expect(controller.draftText.value).toBe("Generated handover");
    expect(controller.draftDirty.value).toBe(false);
    controller.setDraftText("Private edit for viewer two");

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    await nextTick();
    expect(controller.draftText.value).toBe("Private edit for viewer one");

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: SECOND_VIEWER_SCOPE,
      renewal: renewalState()
    };
    await nextTick();
    expect(controller.draftText.value).toBe("Private edit for viewer two");

    scope.stop();
  });

  it("does not hydrate a handover response without a server viewer scope", () => {
    renewalHarness.endpoint.data.value = { ok: true, renewal: renewalState() };
    const { controller, scope } = mountRenewal();

    expect(controller.renewal.value).toBeNull();
    expect(controller.phase.value).toBe("intro");

    scope.stop();
  });

  it("opens first, then starts one durable handover operation", async () => {
    renewalHarness.postRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: undefined,
        stage: "draft_generating",
        status: "running"
      })
    });
    const { controller, scope } = mountRenewal();

    controller.request();
    expect(controller.open.value).toBe(true);
    await controller.requestDraft();

    expect(renewalHarness.postRun).toHaveBeenCalledOnce();
    expect(renewalHarness.postRun.mock.calls[0][0].path).toBe(
      "/api/app/project/example/vibe64/sessions/session-1/renewal/draft"
    );
    expect(renewalHarness.postRun.mock.calls[0][0].body.operationKey).toMatch(
      /^renewal:session-1:/u
    );
    expect(controller.phase.value).toBe("progress");

    scope.stop();
  });

  it("owns source operations only while renewal can contend with the selected session", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    let finishConfirm;
    renewalHarness.postRun.mockImplementation(() => new Promise((resolve) => {
      finishConfirm = resolve;
    }));
    const { controller, scope, selectedSession, selectedSessionId } = mountRenewal();

    expect(controller.sourceOperationsSuspended.value).toBe(false);
    const confirmation = controller.confirm();
    expect(controller.pendingAction.value).toBe("confirm");
    expect(controller.sourceOperationsSuspended.value).toBe(true);

    finishConfirm({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        error: { message: "The predecessor was restored.", retryable: true },
        revision: 2,
        stage: "old_quiescing",
        status: "failed"
      })
    });
    await confirmation;
    expect(controller.sourceOperationsSuspended.value).toBe(false);

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        error: { message: "The predecessor still needs restoration.", retryable: true },
        revision: 3,
        stage: "failure_restoring",
        status: "failed"
      })
    };
    await nextTick();
    expect(controller.sourceOperationsSuspended.value).toBe(true);

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 4,
        stage: "successor_setup",
        status: "running"
      })
    };
    await nextTick();
    expect(controller.sourceOperationsSuspended.value).toBe(true);

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 5,
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" }
      })
    };
    await nextTick();
    expect(controller.sourceOperationsSuspended.value).toBe(true);

    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();
    expect(controller.sourceOperationsSuspended.value).toBe(false);

    scope.stop();
  });

  it("restores a connected dialog trigger once after the close transition", () => {
    const { controller, scope } = mountRenewal();
    const trigger = {
      focus: vi.fn(),
      isConnected: true
    };

    controller.request({ returnFocusTarget: { $el: trigger } });
    expect(controller.open.value).toBe(true);
    expect(controller.restoreTriggerFocus()).toBe(false);

    controller.close();
    expect(controller.restoreTriggerFocus()).toBe(true);
    expect(trigger.focus).toHaveBeenCalledOnce();
    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(controller.restoreTriggerFocus()).toBe(false);
    expect(trigger.focus).toHaveBeenCalledOnce();

    scope.stop();
  });

  it("drops disconnected and prior-session dialog trigger references", async () => {
    const { controller, scope, selectedSession, selectedSessionId } = mountRenewal();
    const disconnectedTrigger = {
      focus: vi.fn(),
      isConnected: false
    };

    controller.request({ returnFocusTarget: disconnectedTrigger });
    controller.close();
    expect(controller.restoreTriggerFocus()).toBe(false);
    expect(disconnectedTrigger.focus).not.toHaveBeenCalled();

    const priorSessionTrigger = {
      focus: vi.fn(),
      isConnected: true
    };
    controller.request({ returnFocusTarget: priorSessionTrigger });
    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();

    expect(controller.restoreTriggerFocus()).toBe(false);
    expect(priorSessionTrigger.focus).not.toHaveBeenCalled();

    scope.stop();
  });

  it("admits only one handover command when its action is pressed twice", async () => {
    let finishDraft;
    renewalHarness.postRun.mockImplementation(() => new Promise((resolve) => {
      finishDraft = resolve;
    }));
    const { controller, scope } = mountRenewal();

    const first = controller.requestDraft();
    const second = controller.requestDraft();
    expect(renewalHarness.postRun).toHaveBeenCalledOnce();
    expect(controller.sourceOperationsSuspended.value).toBe(true);
    await expect(second).resolves.toBeNull();

    finishDraft({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({ stage: "draft_generating", status: "running" })
    });
    await expect(first).resolves.toMatchObject({ status: "running" });
    expect(controller.sourceOperationsSuspended.value).toBe(true);
    scope.stop();
  });

  it("saves an edited draft before confirming the exact returned revision", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    renewalHarness.patchRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: SAVED_HASH,
          revision: 2,
          text: "Reviewed handover",
          updatedAt: "2026-08-24T01:01:00.000Z"
        },
        revision: 2,
        updatedAt: "2026-08-24T01:01:00.000Z"
      })
    });
    renewalHarness.postRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: SAVED_HASH,
          revision: 2,
          text: "Reviewed handover",
          updatedAt: "2026-08-24T01:01:00.000Z"
        },
        revision: 3,
        stage: "old_quiescing",
        status: "running",
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    });
    const { controller, scope } = mountRenewal();
    controller.draftText.value = "Reviewed handover";

    await controller.confirm("codex");

    expect(renewalHarness.patchRun).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        draft: "Reviewed handover",
        expectedHash: DRAFT_HASH,
        expectedRevision: 1
      })
    }));
    expect(renewalHarness.postRun).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        workflowEngineId: "codex",
        expectedHash: SAVED_HASH,
        expectedRevision: 2
      }),
      path: expect.stringMatching(/\/renewal\/confirm$/u)
    }));
    expect(controller.phase.value).toBe("progress");

    scope.stop();
  });

  it("keeps the old session selected on failure and retries the same operation", async () => {
    const failed = renewalState({
      error: { message: "Save this session first.", retryable: true },
      stage: "old_quiescing",
      status: "failed"
    });
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: failed
    };
    renewalHarness.postRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: {
        ...failed,
        revision: failed.revision + 1,
        status: "running",
        updatedAt: "2026-08-24T01:03:00.000Z"
      }
    });
    const { controller, scope, selectSession } = mountRenewal();

    await controller.retry();

    expect(renewalHarness.postRun).toHaveBeenCalledWith(expect.objectContaining({
      body: { operationKey: failed.operationKey },
      path: expect.stringMatching(/\/renewal\/retry$/u)
    }));
    expect(selectSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("refreshes the list and selects only the acknowledged completed successor", async () => {
    const refreshSessionData = vi.fn(async () => null);
    const selectSession = vi.fn();
    const { focusSession, scope } = mountRenewal({ refreshSessionData, selectSession });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" },
        updatedAt: "2026-08-24T01:04:00.000Z"
      })
    };
    await nextTick();
    await nextTick();

    expect(refreshSessionData).toHaveBeenCalledWith({
      includeList: true,
      reason: "session-renewal-successor-available"
    });
    expect(selectSession).toHaveBeenCalledWith("session-2");
    expect(focusSession).toHaveBeenCalledWith("session-2");

    scope.stop();
  });

  it("does not expose a successor until the durable renewal commit", async () => {
    const refreshSessionData = vi.fn(async () => null);
    const selectSession = vi.fn();
    const { focusSession, scope } = mountRenewal({ refreshSessionData, selectSession });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "successor_activating",
        status: "running",
        successor: {
          availableAt: "2026-08-24T01:04:00.000Z",
          sessionId: "session-2"
        },
        updatedAt: "2026-08-24T01:04:01.000Z"
      })
    };
    await nextTick();
    await nextTick();

    expect(refreshSessionData).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
    expect(focusSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("keeps completed cleanup failure visible and retries the same operation", async () => {
    const completed = renewalState({
      maintenance: {
        error: {
          message: "The old preview process did not stop.",
          retryable: true
        },
        status: "failed"
      },
      stage: "completed",
      status: "completed",
      successor: { sessionId: "session-2" }
    });
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: completed
    };
    renewalHarness.postRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: completed
    });
    const { controller, scope } = mountRenewal();

    expect(controller.phase.value).toBe("completed");
    expect(controller.maintenanceNeedsRetry.value).toBe(true);
    expect(controller.maintenanceError.value).toBe(
      "The old preview process did not stop."
    );
    expect(controller.actionPresentation.value).toMatchObject({
      color: "warning",
      label: "Cleanup needs retry"
    });

    await controller.retry();

    expect(renewalHarness.postRun).toHaveBeenCalledWith(expect.objectContaining({
      body: { operationKey: completed.operationKey },
      path: expect.stringMatching(/\/renewal\/retry$/u)
    }));

    scope.stop();
  });

  it("keeps authoritative completion recovery alive after the progress dialog closes", async () => {
    vi.useFakeTimers();
    const calls = [];
    const refreshSessionData = vi.fn(async (options) => {
      calls.push(["list", options]);
      return null;
    });
    const selectSession = vi.fn((successorId) => {
      calls.push(["select", successorId]);
    });
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 2,
        stage: "successor_setup",
        status: "running"
      })
    };
    renewalHarness.endpoint.reload.mockImplementation(async () => {
      renewalHarness.endpoint.data.value = {
        ok: true,
        viewerScope: VIEWER_SCOPE,
        renewal: renewalState({
          revision: 3,
          stage: "completed",
          status: "completed",
          successor: { sessionId: "successor-for-session-1" }
        })
      };
      return renewalHarness.endpoint.data.value;
    });
    const mounted = mountRenewal({ refreshSessionData, selectSession });

    try {
      expect(mounted.controller.open.value).toBe(false);
      await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS - 1);
      expect(renewalHarness.endpoint.reload).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await nextTick();
      await nextTick();

      expect(renewalHarness.endpoint.reload).toHaveBeenCalledOnce();
      expect(refreshSessionData).toHaveBeenCalledWith({
        includeList: true,
        reason: "session-renewal-successor-available"
      });
      expect(selectSession).toHaveBeenCalledWith("successor-for-session-1");
      expect(calls).toEqual([
        ["list", {
          includeList: true,
          reason: "session-renewal-successor-available"
        }],
        ["select", "successor-for-session-1"]
      ]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      mounted.scope.stop();
      vi.useRealTimers();
    }
  });

  it("bounds background renewal polling to one request and stops on selection, terminal state, or unmount", async () => {
    vi.useFakeTimers();
    const runningResponse = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        revision: 2,
        stage: "successor_setup",
        status: "running"
      })
    };
    renewalHarness.endpoint.data.value = runningResponse;
    let finishReload;
    renewalHarness.endpoint.reload.mockImplementation(() => new Promise((resolve) => {
      finishReload = resolve;
    }));
    const first = mountRenewal();

    try {
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS);
      expect(renewalHarness.endpoint.reload).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS * 3);
      expect(renewalHarness.endpoint.reload).toHaveBeenCalledOnce();
      finishReload(runningResponse);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);

      first.selectedSessionId.value = "session-2";
      await nextTick();
      expect(vi.getTimerCount()).toBe(0);
      first.scope.stop();

      renewalHarness.endpoint.reload.mockReset();
      renewalHarness.endpoint.data.value = runningResponse;
      const second = mountRenewal();
      expect(vi.getTimerCount()).toBe(1);
      renewalHarness.endpoint.data.value = {
        ok: true,
        viewerScope: VIEWER_SCOPE,
        renewal: renewalState({
          error: { message: "Paused safely.", retryable: true },
          revision: 3,
          stage: "successor_setup",
          status: "failed"
        })
      };
      await nextTick();
      expect(vi.getTimerCount()).toBe(0);
      second.scope.stop();

      renewalHarness.endpoint.data.value = runningResponse;
      const third = mountRenewal();
      expect(vi.getTimerCount()).toBe(1);
      third.scope.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      first.scope.stop();
      vi.useRealTimers();
    }
  });

  it("polls visible post-commit maintenance until cleanup completes", async () => {
    vi.useFakeTimers();
    const failedMaintenance = renewalState({
      maintenance: {
        error: { message: "Cleanup needs retry.", retryable: true },
        status: "failed"
      },
      revision: 2,
      stage: "completed",
      status: "completed",
      successor: { sessionId: "session-2" }
    });
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: failedMaintenance
    };
    renewalHarness.endpoint.reload.mockImplementation(async () => {
      renewalHarness.endpoint.data.value = {
        ok: true,
        viewerScope: VIEWER_SCOPE,
        renewal: {
          ...failedMaintenance,
          maintenance: {
            error: null,
            status: "completed"
          },
          revision: 3
        }
      };
      return renewalHarness.endpoint.data.value;
    });
    const mounted = mountRenewal();

    try {
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS);
      await nextTick();

      expect(renewalHarness.endpoint.reload).toHaveBeenCalledOnce();
      expect(mounted.controller.maintenanceNeedsRetry.value).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      mounted.scope.stop();
      vi.useRealTimers();
    }
  });

  it("never redirects from a completed renewal owned by an inactive mounted host", async () => {
    const active = ref(false);
    const refreshSessionData = vi.fn(async () => null);
    const selectSession = vi.fn();
    const { scope } = mountRenewal({ active, refreshSessionData, selectSession });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" },
        updatedAt: "2026-08-24T01:04:00.000Z"
      })
    };
    await nextTick();
    await nextTick();
    expect(refreshSessionData).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();

    active.value = true;
    await nextTick();
    await nextTick();
    expect(refreshSessionData).toHaveBeenCalledOnce();
    expect(selectSession).toHaveBeenCalledWith("session-2");

    scope.stop();
  });

  it("does not redirect when its mounted host becomes inactive during list refresh", async () => {
    const active = ref(true);
    let finishRefresh;
    const refreshSessionData = vi.fn(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const selectSession = vi.fn();
    const { scope } = mountRenewal({ active, refreshSessionData, selectSession });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" },
        updatedAt: "2026-08-24T01:04:00.000Z"
      })
    };
    await nextTick();
    expect(refreshSessionData).toHaveBeenCalledOnce();

    active.value = false;
    finishRefresh(null);
    await nextTick();
    await nextTick();
    expect(selectSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("keeps completed-session opening retryable after a resolved query error", async () => {
    const listError = new Error("Session list is temporarily unavailable.");
    const refreshSessionData = vi.fn()
      .mockResolvedValueOnce({
        error: listError,
        isError: true,
        status: "error"
      })
      .mockResolvedValueOnce(null);
    const selectSession = vi.fn();
    const { controller, focusSession, scope } = mountRenewal({
      refreshSessionData,
      selectSession
    });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" },
        updatedAt: "2026-08-24T01:04:00.000Z"
      })
    };
    await nextTick();
    await nextTick();

    expect(controller.successorSelectionError.value).toBe(
      listError.message
    );
    expect(controller.open.value).toBe(true);
    expect(selectSession).not.toHaveBeenCalled();

    await expect(controller.openSuccessor()).resolves.toBe(true);
    expect(refreshSessionData).toHaveBeenCalledTimes(2);
    expect(selectSession).toHaveBeenCalledWith("session-2");
    expect(focusSession).toHaveBeenCalledWith("session-2");
    expect(controller.successorSelectionError.value).toBe("");

    scope.stop();
  });

  it("preserves local edits and requires an explicit choice when a newer remote draft arrives", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const { controller, scope } = mountRenewal();
    controller.draftText.value = "My unsaved edit";

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    await nextTick();
    expect(controller.draftText.value).toBe("My unsaved edit");

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: SAVED_HASH,
          revision: 2,
          text: "Changed in another tab",
          updatedAt: "2026-08-24T01:02:00.000Z"
        },
        revision: 2,
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    };
    await nextTick();
    expect(controller.draftText.value).toBe("My unsaved edit");
    expect(controller.draftConflict.value).toMatchObject({
      identity: `2:${SAVED_HASH}`,
      text: "Changed in another tab"
    });
    expect(controller.canConfirm.value).toBe(false);
    expect(controller.canSaveDraft.value).toBe(false);

    controller.acceptLatestDraft();
    expect(controller.draftText.value).toBe("Changed in another tab");
    expect(controller.draftConflict.value).toBeNull();
    expect(controller.canConfirm.value).toBe(true);

    scope.stop();
  });

  it("keeps local edits only after rebasing their save guard onto the latest remote draft", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    renewalHarness.patchRun.mockResolvedValue({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: "c".repeat(64),
          revision: 3,
          text: "My local version",
          updatedAt: "2026-08-24T01:03:00.000Z"
        },
        revision: 3,
        updatedAt: "2026-08-24T01:03:00.000Z"
      })
    });
    const { controller, scope } = mountRenewal();
    controller.draftText.value = "My local version";

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: SAVED_HASH,
          revision: 2,
          text: "Remote version",
          updatedAt: "2026-08-24T01:02:00.000Z"
        },
        revision: 2,
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    };
    await nextTick();
    controller.keepLocalDraft();

    expect(controller.draftText.value).toBe("My local version");
    expect(controller.canSaveDraft.value).toBe(true);
    await controller.saveDraft();
    expect(renewalHarness.patchRun).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({
        draft: "My local version",
        expectedHash: SAVED_HASH,
        expectedRevision: 2
      })
    }));
    expect(controller.draftConflict.value).toBeNull();

    scope.stop();
  });

  it("keeps unsaved review edits in this browser tab across close and remount", () => {
    const draftStorage = memoryStorage();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const first = mountRenewal({ draftStorage });

    first.controller.setDraftText("A local handover edit kept for later");
    first.controller.close();
    first.scope.stop();

    const second = mountRenewal({ draftStorage });
    expect(second.controller.draftText.value).toBe("A local handover edit kept for later");
    expect(second.controller.draftDirty.value).toBe(true);
    expect(second.controller.canSaveDraft.value).toBe(true);

    second.scope.stop();
  });

  it("keeps each session handover isolated while switching with warm resource state", async () => {
    const draftStorage = memoryStorage();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const {
      controller,
      scope,
      selectedSession,
      selectedSessionId
    } = mountRenewal({ draftStorage });
    controller.setDraftText("Unsaved edit for session one");

    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        operationKey: "renewal:session-2:two",
        renewalId: "renewal-two",
        sessionId: "session-2"
      })
    };
    await nextTick();
    expect(controller.draftText.value).toBe("Generated handover");
    controller.setDraftText("Unsaved edit for session two");

    selectedSessionId.value = "session-1";
    selectedSession.value = { sessionId: "session-1", status: "active" };
    await nextTick();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    await nextTick();
    expect(controller.draftText.value).toBe("Unsaved edit for session one");

    scope.stop();
  });

  it("turns a restored edit into an explicit conflict when the server draft advanced", () => {
    const draftStorage = memoryStorage();
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const first = mountRenewal({ draftStorage });
    first.controller.setDraftText("My local handover");
    first.scope.stop();

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        draft: {
          hash: SAVED_HASH,
          revision: 2,
          text: "Newer handover from another tab",
          updatedAt: "2026-08-24T01:02:00.000Z"
        },
        revision: 2,
        updatedAt: "2026-08-24T01:02:00.000Z"
      })
    };
    const second = mountRenewal({ draftStorage });

    expect(second.controller.draftText.value).toBe("My local handover");
    expect(second.controller.draftConflict.value).toMatchObject({
      identity: `2:${SAVED_HASH}`,
      text: "Newer handover from another tab"
    });
    expect(second.controller.canConfirm.value).toBe(false);

    second.scope.stop();
  });

  it("shows handover validation beside the draft and clears it on edit", async () => {
    const validationError = new Error("The Saved source commit must match exactly.");
    validationError.code = "vibe64_session_renewal_handover_source_mismatch";
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    renewalHarness.postRun.mockRejectedValue(validationError);
    const { controller, scope } = mountRenewal();

    await expect(controller.confirm()).resolves.toBeNull();
    expect(controller.draftError.value).toBe(validationError.message);
    expect(controller.canConfirm.value).toBe(false);
    expect(renewalHarness.feedbackErrors).toEqual([]);

    controller.setDraftText("Corrected handover");
    expect(controller.draftError.value).toBe("");
    expect(controller.canConfirm.value).toBe(true);

    scope.stop();
  });

  it("leaves transient command failures to shared action feedback", async () => {
    const transientError = new Error("Network temporarily unavailable.");
    transientError.code = "vibe64_request_failed";
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    renewalHarness.postRun.mockRejectedValue(transientError);
    const { controller, scope } = mountRenewal();

    await expect(controller.confirm()).rejects.toBe(transientError);
    expect(controller.draftError.value).toBe("");
    expect(renewalHarness.feedbackErrors).toEqual([transientError]);

    scope.stop();
  });

  it("keeps the last durable snapshot and local draft through transient read errors", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const { controller, scope } = mountRenewal();
    controller.draftText.value = "My unsaved review";

    renewalHarness.endpoint.loadError.value = "Network temporarily unavailable.";
    renewalHarness.endpoint.isLoading.value = true;
    renewalHarness.endpoint.data.value = { ok: false, renewal: null };
    await nextTick();

    expect(controller.phase.value).toBe("review");
    expect(controller.renewal.value).toMatchObject({
      renewalId: "renewal-one",
      status: "review"
    });
    expect(controller.draftText.value).toBe("My unsaved review");
    expect(controller.refreshError.value).toBe("Network temporarily unavailable.");

    scope.stop();
  });

  it("rejects a late resource snapshot belonging to the previous session", async () => {
    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState()
    };
    const {
      controller,
      scope,
      selectedSession,
      selectedSessionId,
      selectSession
    } = mountRenewal();

    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();
    expect(controller.renewal.value).toBeNull();

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-3" },
        updatedAt: "2026-08-24T01:10:00.000Z"
      })
    };
    await nextTick();
    await nextTick();

    expect(controller.renewal.value).toBeNull();
    expect(controller.phase.value).toBe("intro");
    expect(selectSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("rejects a command response when selection changes before it returns", async () => {
    let resolvePost;
    renewalHarness.postRun.mockImplementation(() => new Promise((resolve) => {
      resolvePost = resolve;
    }));
    const {
      controller,
      scope,
      selectedSession,
      selectedSessionId,
      selectSession
    } = mountRenewal();

    const pending = controller.requestDraft();
    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();
    resolvePost({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-3" },
        updatedAt: "2026-08-24T01:10:00.000Z"
      })
    });

    await expect(pending).resolves.toBeNull();
    expect(controller.renewal.value).toBeNull();
    expect(controller.busy.value).toBe(false);
    expect(selectSession).not.toHaveBeenCalled();

    scope.stop();
  });

  it("keeps command pending state scoped to the session that owns it", async () => {
    let resolveFirst;
    let resolveSecond;
    renewalHarness.postRun
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));
    const {
      controller,
      scope,
      selectedSession,
      selectedSessionId
    } = mountRenewal();

    const first = controller.requestDraft();
    expect(controller.busy.value).toBe(true);
    expect(controller.pendingAction.value).toBe("draft");

    selectedSessionId.value = "session-2";
    selectedSession.value = { sessionId: "session-2", status: "active" };
    await nextTick();
    expect(controller.busy.value).toBe(false);

    const second = controller.requestDraft();
    expect(controller.busy.value).toBe(true);
    resolveFirst({ ok: true, renewal: renewalState() });
    await expect(first).resolves.toBeNull();
    expect(controller.busy.value).toBe(true);

    resolveSecond({
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        operationKey: "renewal:session-2:two",
        renewalId: "renewal-two",
        sessionId: "session-2"
      })
    });
    await expect(second).resolves.toMatchObject({ sessionId: "session-2" });
    expect(controller.busy.value).toBe(false);
    expect(controller.renewal.value).toMatchObject({ sessionId: "session-2" });

    scope.stop();
  });

  it("does not redirect when selection changes during completed-session refresh", async () => {
    let finishRefresh;
    const refreshSessionData = vi.fn(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));
    const selectSession = vi.fn();
    const {
      scope,
      selectedSession,
      selectedSessionId
    } = mountRenewal({ refreshSessionData, selectSession });

    renewalHarness.endpoint.data.value = {
      ok: true,
      viewerScope: VIEWER_SCOPE,
      renewal: renewalState({
        stage: "completed",
        status: "completed",
        successor: { sessionId: "session-2" },
        updatedAt: "2026-08-24T01:04:00.000Z"
      })
    };
    await nextTick();
    expect(refreshSessionData).toHaveBeenCalledOnce();

    selectedSessionId.value = "session-3";
    selectedSession.value = { sessionId: "session-3", status: "active" };
    await nextTick();
    finishRefresh(null);
    await nextTick();
    await nextTick();

    expect(selectSession).not.toHaveBeenCalled();
    scope.stop();
  });
});
