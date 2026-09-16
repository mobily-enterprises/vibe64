import { unmatchedOptimisticMessages } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { describe, expect, it } from "vitest";

import {
  chatMessagePayload,
  createChatMessageId
} from "../../src/lib/vibe64ChatMessage.js";

describe("direct chat messages", () => {
  it("builds a plain message payload", () => {
    expect(chatMessagePayload("  Tighten the tests.  ")).toEqual({
      displayMessage: "Tighten the tests.",
      message: "Tighten the tests."
    });
    expect(chatMessagePayload("   ")).toBeNull();
  });

  it("sends attachment references without trusting browser filesystem paths", () => {
    const attachmentId = "12345678-1234-4234-8234-123456789abc";
    const payload = chatMessagePayload("Please inspect [Image #1].", [{
      attachmentId,
      fileName: "screenshot.png",
      path: "/tmp/vibe64-attachments/session/screenshot.png",
      reference: "[Image #1]",
      size: 2048
    }]);

    expect(payload.displayMessage).toBe("Please inspect [Image #1].");
    expect(payload.displayAttachments).toEqual([{
      attachmentId,
      fileName: "screenshot.png",
      reference: "[Image #1]",
      size: 2048
    }]);
    expect(payload.attachmentIds).toEqual([attachmentId]);
    expect(payload.message).toBe("Please inspect [Image #1].");
    expect(JSON.stringify(payload)).not.toContain("/tmp/");
  });

  it("creates unique ids for one browser origin", () => {
    const first = createChatMessageId({
      now: 1234,
      originId: "tab:test",
      sequence: 1
    });
    const second = createChatMessageId({
      now: 1234,
      originId: "tab:test",
      sequence: 2
    });

    expect(first).toBe("message_tab_test_ya_1");
    expect(second).toBe("message_tab_test_ya_2");
  });

  it("removes optimistic messages when canonical conversation turns arrive", () => {
    const optimistic = {
      createdAtMs: Date.parse("2026-08-14T01:02:03.000Z"),
      id: "message:test",
      status: "pending",
      text: "Build it."
    };
    expect(unmatchedOptimisticMessages([{
      user: {
        at: "2026-08-14T01:02:04.000Z",
        text: "Build it."
      }
    }], [optimistic])).toEqual([]);
    expect(unmatchedOptimisticMessages([], [{
      ...optimistic,
      status: "failed"
    }])).toHaveLength(1);
    expect(unmatchedOptimisticMessages([{
      user: {
        at: "2026-08-14T01:03:00.000Z",
        messageId: "message:test",
        text: "Server-rendered text"
      }
    }], [{
      ...optimistic,
      status: "failed"
    }])).toEqual([]);
  });
});
