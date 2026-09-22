import { createSSRApp, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { createVuetify } from "vuetify";
import { describe, expect, it } from "vitest";
import Panel from "../../src/components/studio/vibe64-session/Vibe64AssistantAccessPanel.vue";

const request = {
  id: "request-1", status: "pending", author: { displayName: "Grace" },
  message: "Please review the customer screen.",
  attachmentIds: ["11111111-1111-4111-8111-111111111111"],
  displayAttachments: [{ attachmentId: "11111111-1111-4111-8111-111111111111", fileName: "customer.png", size: 100 }]
};

function renderPanel(props = {}) {
  const app = createSSRApp({ render: () => h(Panel, { sessionId: "session-1", pendingSuggestions: [request], ...props }) });
  app.use(createVuetify());
  return renderToString(app);
}

describe("message request review", () => {
  it("shows the owner the author, full message, attachment and direct approval", async () => {
    const html = await renderPanel({ canManage: true });
    expect(html).toContain("Ready for your approval");
    expect(html).toContain("Grace");
    expect(html).toContain(request.message);
    expect(html).toContain("customer.png");
    expect(html).toContain("Approve &amp; send");
    expect(html).toContain("Decline");
    expect(html).not.toContain("Withdraw request");
  });

  it("gives members withdrawal and a visible approval outcome without owner controls", async () => {
    const html = await renderPanel({ recentSuggestions: [{ ...request, id: "sent-request", status: "delivered" }] });
    expect(html).toContain("Waiting for the owner");
    expect(html).toContain("Withdraw request");
    expect(html).toContain("Approved and sent");
    expect(html).not.toContain("Approve &amp; send");
    expect(html).not.toContain(">Decline<");
  });

  it("keeps attached requests waiting while the AI works and exposes delivery retries", async () => {
    const busy = await renderPanel({ canManage: true, assistantBusy: true });
    expect(busy).toContain("You can send this request with its files when it finishes.");
    expect(busy).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Approve &amp; send/u);
    const failed = await renderPanel({ canManage: true, pendingSuggestions: [{ ...request, lastDeliveryError: "Connection lost." }] });
    expect(failed).toContain("This request hasn’t been sent. Connection lost.");
    expect(failed).toContain("Retry sending");
  });
});
