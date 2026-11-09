import { describe, expect, it } from "vitest";
import { conversationTurnPresentation } from "../../src/lib/vibe64ConversationPresentation.js";

describe("main chat turn presentation", () => {
  it("shows a note Vibe64 steered into a working turn as a system row, not as the person's message", () => {
    const note = "Vibe64 saved this session's work as it was when Save started, including unfinished changes.";
    const user = { role: "user", text: note, messageId: "note-1", at: "2026-11-09T01:00:00.000Z" };
    const shown = conversationTurnPresentation({
      turnId: "000007",
      metadata: { actorDisplayName: "Vibe64", actorId: "app", vibe64Note: true },
      user,
      messages: [user]
    });
    expect(shown.user).toBeNull();
    expect(shown.system).toMatchObject({ role: "system", text: note, messageId: "note-1" });

    const typed = conversationTurnPresentation({ turnId: "000008", metadata: { actorId: "person" }, user, messages: [user] });
    expect(typed.user).toMatchObject({ role: "user", text: note });
    expect(typed.system).toBeUndefined();
  });
});
