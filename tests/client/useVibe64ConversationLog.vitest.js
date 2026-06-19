import { describe, expect, it } from "vitest";

import {
  applyConversationLogPatch,
  conversationLogRealtimeLiveProgressMessage,
  conversationLogRealtimePatch,
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  mergeConversationLogLiveProgressMessages,
  normalizeConversationLog,
  sessionIsAwaitingCodex
} from "../../src/composables/useVibe64ConversationLog.js";
import {
  vibe64BrowserTabOriginId
} from "../../src/lib/vibe64BrowserTabOrigin.js";

describe("useVibe64ConversationLog", () => {
  it("normalizes durable conversation turns and ignores empty messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          assistant: {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          },
          thinking: [
            {
              at: "2026-05-25T01:02:30.000Z",
              role: "thinking",
              text: "Checked the current form state."
            }
          ],
          turnId: "000001",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Please check this."
          }
        },
        {
          assistant: null,
          turnId: "000002",
          user: {
            role: "user",
            text: "   "
          }
        }
      ]
    })).toEqual([
      {
        assistant: {
          at: "2026-05-25T01:03:00.000Z",
          role: "assistant",
          text: "Done."
        },
        messages: [
          {
            at: "2026-05-25T01:02:00.000Z",
            role: "user",
            text: "Please check this."
          },
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          },
          {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          }
        ],
        thinking: [
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          }
        ],
        turnId: "000001",
        user: {
          at: "2026-05-25T01:02:00.000Z",
          role: "user",
          text: "Please check this."
        }
      }
    ]);
  });

  it("marks only the latest user-only turn as pending while Codex is awaited", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Please revise this."
          }
        },
        {
          assistant: {
            role: "assistant",
            text: "Done."
          },
          turnId: "000002",
          user: {
            role: "user",
            text: "One more tweak."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: true
    }).map((turn) => [
      turn.turnId,
      turn.pending === true
    ])).toEqual([
      ["000001", false],
      ["000002", false],
      ["000003", true]
    ]);
  });

  it("leaves user-only turns settled when the session is not awaiting Codex", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: false
    })).toEqual([
      {
        assistant: null,
        messages: [
          {
            at: "",
            role: "user",
            text: "Make the file name lower case."
          }
        ],
        thinking: [],
        turnId: "000001",
        user: {
          at: "",
          role: "user",
          text: "Make the file name lower case."
        }
      }
    ]);
  });

  it("keeps system turns distinct from user and assistant messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          system: {
            role: "system",
            text: "Worktree created."
          },
          turnId: "000001"
        }
      ]
    })).toEqual([
      {
        assistant: null,
        messages: [
          {
            at: "",
            role: "system",
            text: "Worktree created."
          }
        ],
        system: {
          at: "",
          role: "system",
          text: "Worktree created."
        },
        thinking: [],
        turnId: "000001",
        user: null
      }
    ]);
  });

  it("derives pending state from the step machine status", () => {
    expect(sessionIsAwaitingCodex({
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(true);
    expect(sessionIsAwaitingCodex({
      stepMachine: {
        status: "confirm_files"
      }
    })).toBe(false);
  });

  it("builds a stable recovery key from canonical session state", () => {
    expect(conversationLogRecoveryStateKey({
      currentStep: "maintenance_conversation",
      nextStepId: "local_session_finished",
      presentation: {
        auto: {
          nextOperation: {
            actionId: "send_message",
            id: "operation-1"
          }
        },
        step: {
          nextStepId: "local_session_finished",
          status: "ready"
        }
      },
      sessionId: "session-1",
      status: "active",
      stepMachine: {
        nextStepId: "local_session_finished",
        status: "awaiting_agent_result"
      },
      stepStatus: "ready"
    })).toBe("session-1|active|maintenance_conversation|local_session_finished|ready|awaiting_agent_result|local_session_finished|ready|local_session_finished|operation-1|send_message");
  });

  it("refreshes only for selected-session events that can change durable chat text", () => {
    const ownOriginId = vibe64BrowserTabOriginId();

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-user-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-reasoning-summary",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-live-progress",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-prompt-injected",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-action-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        originId: ownOriginId,
        reason: "session-action-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        originId: "other-tab",
        reason: "session-action-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-intent-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-rewound",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        originId: ownOriginId,
        reason: "session-intent-run",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-active",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-advanced",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-terminal-closed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });

  it("extracts realtime reasoning-summary patches from durable chat events", () => {
    const turn = {
      thinking: [
        {
          role: "thinking",
          text: "Checking database setup."
        }
      ],
      turnId: "000003"
    };

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-reasoning-summary",
      sessionId: "session-1"
    })).toEqual({
      turn,
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-agent-result",
      sessionId: "session-1"
    })).toBe(null);
  });

  it("normalizes live app-server progress as transient thinking activity", () => {
    const progress = conversationLogRealtimeLiveProgressMessage({
      codexLiveProgress: {
        at: "2026-06-18T04:20:00.000Z",
        id: "progress-1",
        replace: true,
        text: "I am checking the generated app."
      },
      reason: "codex-app-server-live-progress",
      sessionId: "session-1"
    });

    expect(progress).toEqual({
      appearance: "thinking",
      at: "2026-06-18T04:20:00.000Z",
      id: "progress-1",
      label: "Codex",
      replace: true,
      text: "I am checking the generated app."
    });

    expect(mergeConversationLogLiveProgressMessages([
      {
        appearance: "thinking",
        id: "progress-1",
        label: "Codex",
        text: "Old text."
      }
    ], {
      appearance: "thinking",
      id: "progress-1",
      label: "Codex",
      text: "New text."
    })).toEqual([
      {
        appearance: "thinking",
        id: "progress-1",
        label: "Codex",
        text: "New text."
      }
    ]);

    expect(mergeConversationLogLiveProgressMessages([
      {
        appearance: "thinking",
        id: "progress-1",
        label: "Codex",
        text: "Previous status."
      }
    ], {
      appearance: "thinking",
      id: "progress-2",
      label: "Codex",
      text: "Latest status."
    })).toEqual([
      {
        appearance: "thinking",
        id: "progress-2",
        label: "Codex",
        text: "Latest status."
      }
    ]);

    expect(conversationLogRealtimeLiveProgressMessage({
      codexLiveProgress: {
        id: "progress-2",
        text: "Ignored."
      },
      reason: "codex-app-server-agent-result",
      sessionId: "session-1"
    })).toBe(null);
  });

  it("applies realtime conversation-log turn patches without a full reload", () => {
    const originalPayload = {
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Start."
          }
        },
        {
          thinking: [
            {
              role: "thinking",
              text: "Old thought."
            }
          ],
          turnId: "000002",
          user: {
            role: "user",
            text: "Continue."
          }
        }
      ],
      ok: true,
      revision: 3
    };
    const updatedTurn = {
      thinking: [
        {
          role: "thinking",
          text: "Updated thought."
        }
      ],
      turnId: "000002",
      user: {
        role: "user",
        text: "Continue."
      }
    };

    expect(applyConversationLogPatch(originalPayload, {
      turn: updatedTurn,
      type: "upsert-turn"
    })).toEqual({
      conversationLog: [
        originalPayload.conversationLog[0],
        updatedTurn
      ],
      ok: true,
      revision: 3
    });

    const appendedTurn = {
      thinking: [
        {
          role: "thinking",
          text: "New thought."
        }
      ],
      turnId: "000003"
    };
    expect(applyConversationLogPatch(originalPayload, {
      turn: appendedTurn,
      type: "upsert-turn"
    })?.conversationLog).toEqual([
      ...originalPayload.conversationLog,
      appendedTurn
    ]);
  });
});
