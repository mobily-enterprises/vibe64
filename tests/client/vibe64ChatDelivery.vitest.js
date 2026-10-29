import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageDelivery } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { chatTurnsWithRouting, routedChatMessage, trackRoutedMessage } from "../../src/lib/vibe64ChatDelivery.js";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: defineComponent({ setup: (_props, { attrs, slots }) => () => h("button", attrs, slots.default?.()) })
}));
import ConversationStatus from "../../src/components/studio/vibe64-session/Vibe64ConversationStatus.vue";

const request = { schemaVersion: 5, messageId: "message-1", status: "working", delivery: "sending", stage: "implementation", input: { message: "Hello" }, assignments: {} };

describe("routed chat delivery presentation", () => {
  it.each(["failed", "uncertain"])("shows a same-ID retry as Pending while the server still reports %s", async status => {
    const delivery = createAssistantMessageDelivery();
    const oldRoute = { ...request, delivery: status, error: "Previous send failed." };
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => false });
    const pending = Promise.withResolvers();
    const retry = delivery.send({ message: "Hello" }, {
      messageId: request.messageId, deliver: () => pending.promise
    });
    const [turn] = chatTurnsWithRouting(delivery.turns([]), oldRoute);
    expect(turn.optimistic).toMatchObject({ status: "pending", error: "" });
    expect(turn.system).toBeUndefined();
    expect(routedChatMessage(oldRoute, delivery.find(request.messageId)).status).toBe("pending");

    pending.resolve({ ok: false, error: "New attempt failed." });
    await retry;
    const newRoute = { ...oldRoute, delivery: "failed", error: "New attempt failed." };
    expect(chatTurnsWithRouting(delivery.turns([]), newRoute)[0].optimistic)
      .toMatchObject({ status: "failed", error: "New attempt failed." });
    expect(routedChatMessage(newRoute, delivery.find(request.messageId)).status).toBe("failed");
  });

  it("tracks a message shown only from its route so Cancel can wait for the server, and shows it until the route stops", () => {
    const delivery = createAssistantMessageDelivery();
    const route = { ...request, status: "waiting", delivery: "failed", error: "Refused." };
    const [shown] = chatTurnsWithRouting(delivery.turns([]), route);
    trackRoutedMessage(delivery, routedChatMessage(route), []);
    expect(delivery.find(request.messageId)).toMatchObject({ text: "Hello", status: "uncertain" });
    trackRoutedMessage(delivery, routedChatMessage(route), []);
    expect(delivery.state.messages).toHaveLength(1);
    expect(chatTurnsWithRouting(delivery.turns([]), route)).toHaveLength(1);
    expect(shown.user.text).toBe("Hello");
    // Only the server's answer ends it: its route stops and the delivery drops it.
    const stopped = { ...route, stopped: true, cancelled: true };
    expect(chatTurnsWithRouting(delivery.turns([]), stopped)).toHaveLength(1);
    delivery.remove(request.messageId);
    expect(chatTurnsWithRouting(delivery.turns([]), stopped)).toEqual([]);
    // Accepted history is never tracked for Cancel.
    trackRoutedMessage(delivery, { id: request.messageId, text: "Hello", payload: { message: "Hello" } },
      [{ turnId: "saved", user: { messageId: request.messageId, text: "Hello" } }]);
    expect(delivery.state.messages).toEqual([]);
  });

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

  it("shows one unconfirmed message with Retry and no failure/edit/cancel controls", async () => {
    const [turn] = chatTurnsWithRouting([], { ...request, status: "waiting", delivery: "uncertain", error: "Connection closed." });
    expect(turn.optimistic.status).toBe("uncertain");
    expect(turn.system.text).toContain("Delivery unconfirmed");
    const html = await renderToString(createSSRApp(ConversationStatus, { message: turn.system }));
    expect(html).toContain("Retry delivery check");
    expect(html).toContain("Connection closed.");
    expect(html).not.toMatch(/Failed:|Cancel|Edit/);
    const [checking] = chatTurnsWithRouting([], { ...request, status: "waiting", delivery: "uncertain" }, true);
    const pendingHtml = await renderToString(createSSRApp(ConversationStatus, { message: checking.system }));
    expect(pendingHtml).toContain("disabled");
    expect(pendingHtml).toContain("Checking…");
  });

  it("preserves an actual rejection and its reason", () => {
    const [turn] = chatTurnsWithRouting([], { ...request, status: "waiting", delivery: "failed", error: "Access denied." });
    expect(turn.optimistic).toMatchObject({ status: "failed", error: "Access denied." });
    expect(turn.system.delivery).toBeUndefined();
  });

  it("keeps a restored provisional authored row unconfirmed without duplicating it", () => {
    const provisional = { turnId: "saved", user: { messageId: request.messageId, text: "Hello", receipt: false } };
    const turns = chatTurnsWithRouting([provisional], { ...request, status: "waiting", delivery: "uncertain", error: "Native receipt unavailable." });
    expect(turns).toHaveLength(1);
    expect(turns[0].user).toEqual(provisional.user);
    expect(turns[0].optimistic.status).toBe("uncertain");
    expect(turns[0].system.delivery.messageId).toBe(request.messageId);
  });

  it("lets confirmed delivery replace stale errors before and after history loads", async () => {
    const delivery = createAssistantMessageDelivery();
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => false });
    for (const routing of [
      { status: "working", delivery: "accepted" },
      { status: "working", delivery: "pending", followup: {} },
      { status: "working", delivery: "sending", followup: {} },
      { status: "waiting", delivery: "uncertain", followup: {} }
    ]) {
      expect(chatTurnsWithRouting(delivery.turns([]), { ...request, ...routing })[0].optimistic)
        .toMatchObject({ status: "accepted", error: "" });
    }
    const receipt = { turnId: "turn-1", user: { messageId: request.messageId, text: "Hello" } };
    const turns = chatTurnsWithRouting(delivery.turns([receipt]), { ...request, status: "waiting", delivery: "uncertain", error: "Lost response." });
    expect(turns).toEqual([receipt]);
    await delivery.send({ message: "Hello" }, { messageId: request.messageId, deliver: async () => true });
    const [accepted] = chatTurnsWithRouting(delivery.turns([]), { ...request, status: "waiting", delivery: "uncertain", error: "Stale error." });
    expect(accepted.optimistic).toMatchObject({ status: "accepted", error: "" });
    expect(accepted.system).toBeUndefined();
  });
});

it("shows restored review explanations as one system chat message without rewriting or duplicating history", () => {
  const receipt = { turnId: "accepted", user: { messageId: request.messageId, text: "Hello" } };
  const routed = { ...request, status: "working", delivery: "accepted", stage: "review", followup: {}, outcome: { turnId: "implementation-1", decision: "handoff", explanation: "The work is ready for review." } };
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
    const turns = chatTurnsWithRouting([], { ...request, status: "waiting", delivery: "accepted", outcome: {
      turnId: "implementation-1", decision, explanation: `A required check remains.${decision === "continue" ? "\n\nNext step: Run the focused check." : ""}`
    } });
    expect(turns).toHaveLength(1);
    expect(turns[0].system.text).toContain("A required check remains.");
    expect(turns[0].system.text.includes("Next step: Run the focused check.")).toBe(decision === "continue");
  }
});

it("clears the delivery warning when the same routing request becomes accepted", () => {
  const uncertain = chatTurnsWithRouting([], { ...request, delivery: "uncertain", error: "Old failure" });
  const [accepted] = chatTurnsWithRouting(uncertain, { ...request, delivery: "accepted" });
  expect(accepted.optimistic.status).toBe("accepted");
  expect(accepted.system?.delivery).toBeUndefined();
  expect(accepted.user.messageId).toBe(request.messageId);
});

it("collapses saved and projected workflow explanations without changing history", async () => {
  for (const decision of ["wait", "continue", "handoff", "complete"]) {
    const message = { messageId: `assistant-routing-outcome:request:turn:${decision}`, blocks: [{ type: "paragraph", text: "The exact reason remains available." }] };
    const original = structuredClone(message);
    const html = await renderToString(createSSRApp(ConversationStatus, { message }));
    expect(html).toContain("Workflow details"); expect(html).toContain("The exact reason remains available.");
    expect(html).toMatch(/<details[^>]*>[\s\S]*The exact reason remains available.[\s\S]*<\/details>/u);
    expect(html).not.toMatch(/<details[^>]*\bopen/u); expect(message).toEqual(original);
  }
  const html = await renderToString(createSSRApp(ConversationStatus, { message: { messageId: "recovery-error", blocks: [{ type: "paragraph", text: "Recovery failed." }] } }));
  expect(html).toContain("Recovery failed."); expect(html).not.toContain("<details");
});
