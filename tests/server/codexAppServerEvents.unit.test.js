import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCodexAppServerEvent,
  codexAppServerContextRefreshReason
} from "../../packages/vibe64-terminals/src/server/codexAppServerEvents.js";

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
    itemId: "",
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
  }).itemId, "");

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
