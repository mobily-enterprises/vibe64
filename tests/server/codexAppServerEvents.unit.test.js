import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexAppServerEvent,
  codexAppServerContextRefreshReason,
  codexAppServerErrorText,
  codexAppServerNotificationUsageLimitExceeded,
  codexAppServerOutputOwnerTurnId,
  codexAppServerProviderThreadAssistantSegments
} from "@jskit-ai/assistant-core/server/codex-events";

test("Codex output belongs to the active Vibe64 turn across internal provider turns", () => {
  assert.equal(codexAppServerOutputOwnerTurnId({
    notificationThreadId: "thread-1",
    notificationTurnId: "codex-internal-turn-2",
    trackedActive: true,
    trackedState: "active",
    trackedThreadId: "thread-1",
    trackedTurnId: "vibe64-provider-turn-1"
  }), "vibe64-provider-turn-1");

  assert.equal(codexAppServerOutputOwnerTurnId({
    notificationThreadId: "thread-1",
    notificationTurnId: "codex-goal-turn-3",
    trackedActive: true,
    trackedState: "finalizing",
    trackedThreadId: "thread-1",
    trackedTurnId: "vibe64-goal-successor-turn-2"
  }), "vibe64-goal-successor-turn-2");

  assert.equal(codexAppServerOutputOwnerTurnId({
    notificationThreadId: "thread-stale",
    notificationTurnId: "codex-stale-turn",
    trackedActive: true,
    trackedState: "active",
    trackedThreadId: "thread-current",
    trackedTurnId: "vibe64-current-turn"
  }), "codex-stale-turn");
});

test("Codex app-server errors retain structured provider details", () => {
  const notification = {
    method: "error",
    params: {
      error: {
        additionalDetails: JSON.stringify({
          error: {
            code: "invalid_value",
            message: "Invalid value: 'max'. Use 'medium'."
          },
          status: 400,
          type: "error"
        }),
        message: "Codex app-server turn failed."
      },
      threadId: "thread-1",
      turnId: "turn-1",
      willRetry: false
    }
  };
  assert.equal(
    codexAppServerErrorText(notification.params.error),
    "Codex app-server turn failed. Invalid value: 'max'. Use 'medium'."
  );
  assert.deepEqual(classifyCodexAppServerEvent(notification), {
    itemId: "",
    kind: "provider_error",
    source: "error",
    text: "Codex app-server turn failed. Invalid value: 'max'. Use 'medium'.",
    threadId: "thread-1",
    turnId: "turn-1"
  });
});

test("Codex usage-limit recovery relies on the structured provider error code", () => {
  assert.equal(codexAppServerNotificationUsageLimitExceeded({
    method: "turn/completed",
    params: {
      turn: {
        error: {
          codexErrorInfo: "usageLimitExceeded",
          message: "You've hit your usage limit. Try again at 10:30 AM."
        },
        status: "failed"
      }
    }
  }), true);
  assert.equal(codexAppServerNotificationUsageLimitExceeded({
    method: "turn/completed",
    params: {
      turn: {
        error: {
          message: "You've hit your usage limit."
        },
        status: "failed"
      }
    }
  }), false);
});

test("Codex app-server event classifier keeps final answers explicit", () => {
  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Working through the verification.",
          phase: "progress",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), {
    itemId: "",
    kind: "live_progress",
    source: "event_msg",
    text: "Working through the verification.",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Ambiguous assistant text must not become final.",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), {
    itemId: "",
    kind: "ignored",
    source: "event_msg",
    text: "",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.equal(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "Final result.",
          phase: "final_answer",
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }).kind, "final_assistant_result");
});

test("Codex app-server event classifier recognizes task completion final text", () => {
  assert.deepEqual(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        id: "task-complete-event-1",
        payload: {
          id: "task-complete-payload-1",
          last_agent_message: "Task complete final result.",
          turn_id: "turn-1"
        },
        type: "task_complete"
      },
      threadId: "thread-1"
    }
  }), {
    itemId: "task-complete-payload-1",
    kind: "final_assistant_result",
    source: "task_complete",
    text: "Task complete final result.",
    threadId: "thread-1",
    turnId: "turn-1"
  });

  assert.equal(classifyCodexAppServerEvent({
    method: "codex/event",
    params: {
      event: {
        id: "response-item-event-1",
        payload: {
          id: "assistant-item-1",
          phase: "final_answer",
          text: "Response item final result.",
          type: "agentMessage"
        },
        type: "response_item"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }).itemId, "assistant-item-1");

  assert.deepEqual(classifyCodexAppServerEvent({
    method: "task_complete",
    params: {
      lastAgentMessage: "Direct task completion final result.",
      thread_id: "thread-2",
      turn_id: "turn-2"
    }
  }), {
    itemId: "",
    kind: "final_assistant_result",
    source: "task_complete",
    text: "Direct task completion final result.",
    threadId: "thread-2",
    turnId: "turn-2"
  });
});

test("Codex app-server identifies native hook prompts without filtering assistant results", () => {
  const hookPrompt = {
    fragments: [{
      hookRunId: "stop:1",
      text: "This is an automatic cleanup follow-up."
    }],
    id: "hook-prompt-1",
    type: "hookPrompt"
  };
  assert.deepEqual(classifyCodexAppServerEvent({
    method: "item/completed",
    params: {
      item: hookPrompt,
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), {
    itemId: "hook-prompt-1",
    kind: "hook_prompt",
    source: "item/completed",
    text: "This is an automatic cleanup follow-up.",
    threadId: "thread-1",
    turnId: "turn-1"
  });
  assert.deepEqual(codexAppServerProviderThreadAssistantSegments({
    turns: [{
      id: "turn-1",
      items: [
        { id: "main-answer", phase: "final_answer", text: "Here is the answer.", type: "agentMessage" },
        hookPrompt,
        { id: "second-answer", phase: "final_answer", text: "Another answer.", type: "agentMessage" },
        { id: "cleanup", phase: "final_answer", text: "Cleanup corrected one helper.", type: "agentMessage" },
        { id: "summary", phase: "final_answer", text: "The requested change is complete and verified.", type: "agentMessage" }
      ]
    }]
  }, "turn-1"), [
    { itemId: "main-answer", text: "Here is the answer." },
    { itemId: "second-answer", text: "Another answer." },
    { itemId: "cleanup", text: "Cleanup corrected one helper." },
    { itemId: "summary", text: "The requested change is complete and verified." }
  ]);
});

test("Codex app-server context refresh classification uses structured protocol signals only", () => {
  assert.equal(codexAppServerContextRefreshReason({
    method: "codex/event",
    params: {
      event: {
        payload: {
          message: "This text mentions context_compacted but is not a protocol signal.",
          type: "status"
        },
        type: "event_msg"
      }
    }
  }), "");

  assert.equal(codexAppServerContextRefreshReason({
    method: "codex/event",
    params: {
      event: {
        payload: {
          reason: "token_budget",
          type: "context_compacted"
        },
        type: "context_compacted"
      }
    }
  }), "context_compacted");

  assert.equal(codexAppServerContextRefreshReason({
    method: "item/completed",
    params: {
      item: {
        id: "compaction-1",
        type: "contextCompaction"
      },
      threadId: "thread-1",
      turnId: "turn-1"
    }
  }), "context_compacted");

  assert.equal(codexAppServerContextRefreshReason({
    method: "codex/event",
    params: {
      event: {
        payload: {
          type: "context-refresh-required"
        },
        type: "event_msg"
      }
    }
  }), "context_refresh_required");
});
