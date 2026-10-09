import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { chatTurnsWithRouting } from "../../src/lib/vibe64ChatDelivery.js";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: defineComponent({ setup: (_props, { attrs, slots }) => () => h("button", attrs, slots.default?.()) })
}));
import ConversationStatus from "../../src/components/studio/vibe64-session/Vibe64ConversationStatus.vue";

const request = { messageId: "message-1", status: "sending", input: { message: "Hello" }, assignments: {} };

describe("routed chat delivery presentation", () => {
  it("keeps ordinary sends pending, including after a local transport error", async () => {
    const delivery = createAssistantMessageDelivery();
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => false });
    for (const attemptedMessageId of [undefined, request.messageId]) {
      const turns = chatTurnsWithRouting(delivery.turns([]), { ...request, attemptedMessageId });
      expect(turns).toHaveLength(1);
      expect(turns[0].optimistic).toMatchObject({ status: "pending", error: "" });
      expect(turns[0].system.delivery).toBeUndefined();
    }
  });

  it("shows one unconfirmed message with Check delivery and no failure/edit/cancel controls", async () => {
    const [turn] = chatTurnsWithRouting([], { ...request, status: "uncertain", error: "Connection closed." });
    expect(turn.optimistic.status).toBe("uncertain");
    expect(turn.system.text).toContain("Delivery unconfirmed");
    const html = await renderToString(createSSRApp(ConversationStatus, { message: turn.system }));
    expect(html).toContain("Check delivery");
    expect(html).toContain("Connection closed.");
    expect(html).not.toMatch(/Failed:|Retry|Cancel|Edit/);
    const [checking] = chatTurnsWithRouting([], { ...request, status: "uncertain" }, true);
    const pendingHtml = await renderToString(createSSRApp(ConversationStatus, { message: checking.system }));
    expect(pendingHtml).toContain("disabled");
    expect(pendingHtml).toContain("Checking delivery…");
  });

  it("preserves an actual rejection and its reason", () => {
    const [turn] = chatTurnsWithRouting([], { ...request, status: "failed", error: "Access denied." });
    expect(turn.optimistic).toMatchObject({ status: "failed", error: "Access denied." });
    expect(turn.system.delivery).toBeUndefined();
  });

  it("keeps a restored provisional authored row unconfirmed without duplicating it", () => {
    const provisional = { turnId: "saved", user: { messageId: request.messageId, text: "Hello", receipt: false } };
    const turns = chatTurnsWithRouting([provisional], { ...request, status: "uncertain", error: "Native receipt unavailable." });
    expect(turns).toHaveLength(1);
    expect(turns[0].user).toEqual(provisional.user);
    expect(turns[0].optimistic.status).toBe("uncertain");
    expect(turns[0].system.delivery.messageId).toBe(request.messageId);
  });

  it("lets confirmed delivery replace stale errors before and after history loads", async () => {
    const delivery = createAssistantMessageDelivery();
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => false });
    for (const status of ["sent", "implementation_pending", "implementation_sending", "implementation_uncertain"]) {
      expect(chatTurnsWithRouting(delivery.turns([]), { ...request, status })[0].optimistic)
        .toMatchObject({ status: "accepted", error: "" });
    }
    const receipt = { turnId: "turn-1", user: { messageId: request.messageId, text: "Hello" } };
    const turns = chatTurnsWithRouting(delivery.turns([receipt]), { ...request, status: "uncertain", error: "Lost response." });
    expect(turns).toEqual([receipt]);
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => true });
    const [accepted] = chatTurnsWithRouting(delivery.turns([]), { ...request, status: "uncertain", error: "Stale error." });
    expect(accepted.optimistic).toMatchObject({ status: "accepted", error: "" });
    expect(accepted.system).toBeUndefined();
  });
});

it("shows restored review explanations as one system chat message without rewriting or duplicating history", () => {
  const receipt = { turnId: "accepted", user: { messageId: request.messageId, text: "Hello" } };
  const routed = { ...request, status: "reviewing", outcome: { decision: "review", explanation: "The work is ready for review.", nextStep: "" } };
  const original = structuredClone(receipt);
  const turns = chatTurnsWithRouting([receipt], routed);
  expect(turns).toHaveLength(2);
  expect(turns[1].system).toMatchObject({ role: "system", text: "Ready for Senior review.\n\nThe work is ready for review." });
  expect(receipt).toEqual(original);
  expect(chatTurnsWithRouting(turns, routed)).toEqual(turns);
  expect(chatTurnsWithRouting(turns, { ...routed, stopped: true })).toEqual(turns);
  expect(chatTurnsWithRouting([], { ...routed, stopped: true })).toEqual([]);
});

it("puts continuation and waiting explanations in chat, preserving the next step and original message", () => {
  for (const decision of ["continue", "wait"]) {
    const turns = chatTurnsWithRouting([], { ...request, status: "done", outcome: {
      decision, reason: "blocked", explanation: "A required check remains.", nextStep: decision === "continue" ? "Run the focused check." : ""
    } });
    expect(turns).toHaveLength(1);
    expect(turns[0].system.text).toContain("A required check remains.");
    expect(turns[0].system.text.includes("Next step: Run the focused check.")).toBe(decision === "continue");
  }
});
