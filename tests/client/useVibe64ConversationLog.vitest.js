import { describe, expect, it } from "vitest";

import {
  applyConversationLogPatch,
  conversationLogReadQuery,
  conversationLogRealtimePatch,
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  mergeConversationLogPages,
  normalizeConversationLog,
  normalizeConversationLogPage,
  sessionIsAwaitingCodex
} from "../../src/composables/useVibe64ConversationLog.js";
import {
  vibe64BrowserTabOriginId
} from "../../src/lib/vibe64BrowserTabOrigin.js";

describe("useVibe64ConversationLog", () => {
  it("builds conversation-log page queries from the shared page limit", () => {
    expect(conversationLogReadQuery()).toEqual({
      limit: "20"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005"
    })).toEqual({
      beforeTurnId: "000005",
      limit: "20"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005",
      limit: 2
    })).toEqual({
      beforeTurnId: "000005",
      limit: "2"
    });
  });

  it("normalizes and merges chronological conversation pages", () => {
    const olderPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: false,
        limit: 2,
        newestTurnId: "000002",
        oldestTurnId: "000001",
        totalTurnCount: 4
      }
    });
    const latestPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: true,
        limit: 2,
        newestTurnId: "000003",
        oldestTurnId: "000002",
        totalTurnCount: 4
      }
    });

    expect(olderPage.pagination.oldestTurnId).toBe("000001");
    expect(mergeConversationLogPages([
      olderPage,
      latestPage
    ])).toEqual({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ]
    });
  });

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
              text: "Thinking\nChecked the current form state."
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

  it("drops generic thinking headings from thinking output", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          thinking: [
            {
              role: "thinking",
              text: "Thinking..."
            },
            {
              role: "thinking",
              text: "Thinking:\nVerifying artifact and guide reading"
            },
            {
              role: "thinking",
              text: "Thinking about whether to use cached output."
            }
          ],
          turnId: "000001"
        }
      ]
    })[0].thinking.map((message) => message.text)).toEqual([
      "Verifying artifact and guide reading",
      "Thinking about whether to use cached output."
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
            text: "Session clone created."
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
            text: "Session clone created."
          }
        ],
        system: {
          at: "",
          role: "system",
          text: "Session clone created."
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
        reason: "codex-app-server-terminal-thinking-message",
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
        reason: "codex-app-server-final-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "assistant-response-bundle",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-steered",
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
    }, "session-1")).toBe(true);

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
    }, "session-1")).toBe(true);

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
        reason: "agent-terminal-closed",
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
      reason: "codex-app-server-terminal-thinking-message",
      sessionId: "session-1"
    })).toEqual({
      turn,
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          turnId: "000004",
          user: {
            role: "user",
            text: "Keep going."
          }
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-turn-steered",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        turnId: "000004",
        user: {
          role: "user",
          text: "Keep going."
        }
      },
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

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "Final answer."
          },
          thinking: [
            {
              role: "thinking",
              text: "Checked the result."
            }
          ],
          turnId: "000007"
        },
        type: "upsert-turn"
      },
      reason: "assistant-response-bundle",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        assistant: {
          role: "assistant",
          text: "Final answer."
        },
        thinking: [
          {
            role: "thinking",
            text: "Checked the result."
          }
        ],
        turnId: "000007"
      },
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "This must not arrive as live progress."
          },
          turnId: "000008"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-live-progress",
      sessionId: "session-1"
    })).toBe(null);

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          thinking: [
            {
              role: "thinking",
              text: "This is not a final answer."
            }
          ],
          turnId: "000009"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-final-assistant-message",
      sessionId: "session-1"
    })).toBe(null);

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          turnId: "000005",
          user: {
            role: "user",
            text: "Typed directly in the AI Terminal."
          }
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-terminal-user-message",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        turnId: "000005",
        user: {
          role: "user",
          text: "Typed directly in the AI Terminal."
        }
      },
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "Answered directly from the AI Terminal."
          },
          turnId: "000006"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-terminal-assistant-message",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        assistant: {
          role: "assistant",
          text: "Answered directly from the AI Terminal."
        },
        turnId: "000006"
      },
      type: "upsert-turn"
    });
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
      pagination: {
        beforeTurnId: "",
        count: 2,
        hasMoreBefore: false,
        limit: 0,
        newestTurnId: "000002",
        nextBeforeTurnId: "",
        oldestTurnId: "000001",
        totalTurnCount: 0
      },
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

  it("keeps realtime page patches inside the configured latest-page limit", () => {
    const trimmed = applyConversationLogPatch({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second."
          }
        }
      ],
      ok: true,
      pagination: {
        count: 2,
        hasMoreBefore: false,
        limit: 2,
        newestTurnId: "000002",
        oldestTurnId: "000001",
        totalTurnCount: 2
      }
    }, {
      turn: {
        turnId: "000003",
        user: {
          role: "user",
          text: "Third."
        }
      },
      type: "upsert-turn"
    }, {
      limit: 2
    });

    expect(trimmed.conversationLog.map((turn) => turn.turnId)).toEqual([
      "000002",
      "000003"
    ]);
    expect(trimmed.pagination).toMatchObject({
      count: 2,
      hasMoreBefore: true,
      newestTurnId: "000003",
      oldestTurnId: "000002"
    });
  });
});
