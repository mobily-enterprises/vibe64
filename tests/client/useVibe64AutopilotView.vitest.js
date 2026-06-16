import { describe, expect, it } from "vitest";

import {
  createRemoteComposerOptimisticTurn
} from "../../src/lib/vibe64ComposerOptimisticTurn.js";

describe("createRemoteComposerOptimisticTurn", () => {
  it("builds a remote pending chat turn from a submit-start payload", () => {
    const turn = createRemoteComposerOptimisticTurn({
      control: {
        id: "talk_to_codex"
      },
      fields: {
        conversationRequest: "This is a test"
      },
      id: "remote-composer-1",
      payload: {
        updatedAt: "2026-06-16T02:03:04.000Z"
      },
      text: "This is a test"
    });

    expect(turn).toEqual({
      control: {
        id: "talk_to_codex"
      },
      createdAt: "2026-06-16T02:03:04.000Z",
      createdAtMs: Date.parse("2026-06-16T02:03:04.000Z"),
      error: "",
      id: "remote-composer-1",
      options: {
        fields: {
          conversationRequest: "This is a test"
        }
      },
      remote: true,
      status: "pending",
      text: "This is a test",
      values: {
        conversationRequest: "This is a test"
      }
    });
  });

  it("does not create a remote pending turn without visible text", () => {
    expect(createRemoteComposerOptimisticTurn({
      fields: {
        conversationRequest: ""
      }
    })).toBeNull();
  });
});
