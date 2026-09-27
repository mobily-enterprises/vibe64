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

  it("lets confirmed delivery replace stale errors before and after history loads", async () => {
    const delivery = createAssistantMessageDelivery();
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => false });
    expect(chatTurnsWithRouting(delivery.turns([]), { ...request, status: "sent" })[0].optimistic)
      .toMatchObject({ status: "accepted", error: "" });
    const receipt = { turnId: "turn-1", user: { messageId: request.messageId, text: "Hello" } };
    const turns = chatTurnsWithRouting(delivery.turns([receipt]), { ...request, status: "uncertain", error: "Lost response." });
    expect(turns).toEqual([receipt]);
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => true });
    const [accepted] = chatTurnsWithRouting(delivery.turns([]), { ...request, status: "uncertain", error: "Stale error." });
    expect(accepted.optimistic).toMatchObject({ status: "accepted", error: "" });
    expect(accepted.system).toBeUndefined();
  });
});
