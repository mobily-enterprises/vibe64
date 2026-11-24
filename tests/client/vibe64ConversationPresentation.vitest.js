import { describe, expect, it } from "vitest";
import { conversationTurnPresentation } from "../../src/lib/vibe64ConversationPresentation.js";
import { temporaryAiTranscript } from "../../src/lib/vibe64TemporaryAiTasks.js";
import { aiTaskTranscript } from "../../src/lib/vibe64AiTaskConversation.js";

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

  it("gives a turn interruption's system row its red entry in Main chat, temporary chats and AI tasks' Chat", () => {
    const entry = { cause: "crash", at: "2026-11-24T04:18:05.000Z", outcome: "resumed", crashMessage: "read ECONNRESET" };
    const system = { role: "system", text: "Vibe64 crashed at 04:18 UTC: read ECONNRESET.\nResumed after Vibe64 restarted at 04:18 UTC.",
      messageId: "vibe64-turn-interrupted:m:t:resumed", at: "2026-11-24T04:18:30.000Z" };
    const turn = { turnId: "000009", metadata: { vibe64TurnInterruption: entry }, system, messages: [system] };
    expect(conversationTurnPresentation(turn).system).toEqual({ ...system, turnInterruption: entry });
    const adapter = { conversation: { turns: [turn] }, delivery: null, actions: {} };
    const options = { routingRequest: null, working: false, scrollKey: "x", actions: {} };
    expect(temporaryAiTranscript(adapter, options).conversation.turns[0].system.turnInterruption).toEqual(entry);
    expect(aiTaskTranscript(adapter, options).conversation.turns[0].system.turnInterruption).toEqual(entry);
    // Any other system row is Vibe64's ordinary status.
    expect(conversationTurnPresentation({ ...turn, metadata: {} }).system).toEqual(system);
  });
});
