import { readFileSync } from "node:fs";
import { createApp, createRenderer, createSSRApp, effectScope, h, nextTick, reactive, ref, ssrContextKey } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attachConversationRuntime } from "./helpers/conversationRuntimeFixture.js";

const mocks = vi.hoisted(() => ({
  feedback: { report: vi.fn() },
  request: vi.fn(),
  data: null,
  reload: vi.fn(),
  realtime: [],
  resourceOptions: null
}));
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => mocks.feedback }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    mocks.resourceOptions = options;
    return { data: mocks.data, loadError: ref(""), reload: mocks.reload };
  }
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: (options) => { mocks.realtime.push(options); }
}));
const route = reactive({ path: "/app/project/chat-test/dashboard/env" });
vi.mock("vue-router", () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref: vueRef } = await import("vue");
  return { useVibe64ProjectSlug: () => vueRef("chat-test") };
});
vi.mock("@/lib/vibe64AsyncComponent.js", () => ({ defineVibe64AsyncComponent: () => ({ name: "Async" }) }));
vi.mock("@local/vibe64-accounts/client", () => ({ useVibe64Accounts: () => ({ status: ref(null) }) }));

import Vibe64MainChatApprovals from "../../src/components/studio/vibe64-session/Vibe64MainChatApprovals.vue";
import { useVibe64MainChatApprovals } from "../../src/composables/useVibe64MainChatApprovals.js";

const at = "2026-10-23T10:41:00.000Z";
const ana = { id: "ana", username: "ana", displayName: "Ana" };
const tony = { id: "tony", username: "tony", displayName: "Tony" };
const waiting = (extra = {}) => ({ id: "approval-1", sender: ana, text: "Can you add a dark mode toggle?", steer: true,
  status: "waiting", revision: 1, createdAt: at, updatedAt: at, messageId: "approval:approval-1", error: "", ...extra });
const decidedAt = () => new Date().toISOString();

function approvalsState({ owner = false, viewerId = "ana", entries = [] } = {}) {
  const open = entries.filter((entry) => ["waiting", "sending"].includes(entry.status));
  const decided = entries.filter((entry) => !["waiting", "sending"].includes(entry.status));
  return reactive({ loaded: true, isOwner: owner, memberMode: !owner, ownerName: "Tony", viewerId, entries, open,
    waitingCount: open.length, recentDecided: decided, earlierDecided: [], pending: {}, sending: false,
    own: (entry) => entry.sender.id === viewerId,
    send: vi.fn(async () => true), edit: vi.fn(async () => true), withdraw: vi.fn(async () => true),
    decline: vi.fn(async () => true), approve: vi.fn(async () => true) });
}

async function render(approvals, phone = false) {
  const instance = createSSRApp(Vibe64MainChatApprovals, { approvals, phone });
  instance.use(createVuetify());
  return (await renderToString(instance)).replace(/<!--[^>]*-->/gu, "").replace(/&#39;/gu, "'").replace(/\s+/gu, " ");
}

let mounted;
function mountState(approvals) {
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode() {}, nextSibling() {} });
  const component = { ...Vibe64MainChatApprovals, render: () => null };
  const instance = ref();
  mounted = renderer.createApp({ render: () => h(component, { approvals, ref: instance }) });
  mounted.provide(ssrContextKey, { modules: new Set() });
  mounted.mount({});
  return instance.value.$.setupState;
}

beforeEach(() => {
  mocks.feedback.report.mockReset();
  mocks.request.mockReset().mockResolvedValue({ ok: true });
  mocks.reload.mockReset();
  mocks.realtime = [];
  mocks.data = ref({ ok: true, owner: false, viewer: ana, ownerName: "Tony", entries: [] });
});
afterEach(() => { mounted?.unmount(); mounted = null; vi.unstubAllGlobals(); });

describe("approval cards", () => {
  it("shows the sender their waiting message with Edit and Withdraw", async () => {
    const html = await render(approvalsState({ entries: [waiting()] }));
    expect(html).toContain("You");
    expect(html).toContain("Waiting for Tony to approve");
    expect(html).toContain("Can you add a dark mode toggle?");
    expect(html).toContain("Sent while the assistant was working. It joins the current turn if it's still running when Tony approves.");
    expect(html).toMatch(/>\s*Edit\s*</u);
    expect(html).toMatch(/>\s*Withdraw\s*</u);
    expect(html).not.toContain("Approve &amp; send");
  });

  it("gives the owner Approve & send, Edit then send and Decline", async () => {
    const html = await render(approvalsState({ owner: true, viewerId: "tony", entries: [waiting()] }));
    expect(html).toContain("Ana wants to send");
    expect(html).toContain("Approve &amp; send");
    expect(html).toContain("Edit then send");
    expect(html).toMatch(/>\s*Decline\s*</u);
    expect(html).not.toContain("Waiting for Tony to approve");
    expect(html).not.toMatch(/>\s*Withdraw\s*</u);
  });

  it("shows other members the message without actions", async () => {
    const html = await render(approvalsState({ viewerId: "bob", entries: [waiting()] }));
    expect(html).toContain("Ana");
    expect(html).toContain("Waiting for Tony to approve");
    expect(html).not.toMatch(/>\s*(Edit|Withdraw|Decline)\s*</u);
    expect(html).not.toContain("Approve &amp; send");
  });

  it("shows sending and a failed send to the owner", async () => {
    const state = approvalsState({ owner: true, viewerId: "tony", entries: [waiting({ error: "The assistant started another turn." })] });
    let html = await render(state);
    expect(html).toContain("Couldn't send: The assistant started another turn. Try again.");
    state.pending["approval-1"] = "approve";
    html = await render(state);
    expect(html).toContain("Sending…");
    expect(html).not.toContain("Couldn't send");
    state.pending["approval-1"] = undefined;
    state.open[0].status = "sending";
    html = await render(state);
    expect(html).toContain("Send again");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*?Edit then send/u);
  });

  it("keeps decided messages as one-line rows with the decline note", async () => {
    const entries = [
      waiting({ id: "sent-1", status: "sent", decidedBy: tony, decidedAt: decidedAt(), originalText: "Can you add a toggel?" }),
      waiting({ id: "declined-1", status: "declined", decidedBy: tony, decidedAt: decidedAt(), note: "Not now, I'm deploying." }),
      waiting({ id: "withdrawn-1", status: "withdrawn", decidedBy: ana, decidedAt: decidedAt(), text: "Rename the header" })
    ];
    const html = await render(approvalsState({ entries }));
    expect(html).toMatch(/<p class="vibe64-approvals__excerpt[^>]*>Can you add a dark mode toggle\?<\/p>/u);
    expect(html).toMatch(/<summary[^>]*aria-label="Message: Rename the header"[^>]*>Rename the header<\/summary>/u);
    expect(html).toMatch(/Sent by Tony · [^·]+ · Edited by Tony/u);
    expect(html).toContain("Show in chat");
    expect(html).toMatch(/Declined by Tony · /u);
    expect(html).toContain("“Not now, I'm deploying.”");
    expect(html).toMatch(/Withdrawn by you · /u);
    const owner = await render(approvalsState({ owner: true, viewerId: "tony", entries }));
    expect(owner).toMatch(/Ana · Sent by you · /u);
  });

  it("hides older decisions behind Show earlier", async () => {
    const entries = ["a", "b", "c", "d"].map((id) => waiting({ id: `old-${id}`, status: "sent", decidedBy: tony, decidedAt: decidedAt() }));
    const html = await render(approvalsState({ entries }));
    expect(html.match(/Sent by Tony/gu)).toHaveLength(3);
    expect(html).toContain("Show earlier (1)");
  });

  it("collapses to a bar on a phone", async () => {
    const html = await render(approvalsState({ owner: true, viewerId: "tony", entries: [waiting(), waiting({ id: "approval-2" })] }), true);
    expect(html).toContain("2 messages waiting for approval");
    expect(html).toContain("vibe64-approvals__bar");
  });

  it("edits, approves with edits, and declines with a note through the queue", async () => {
    const approvals = approvalsState({ owner: true, viewerId: "tony", entries: [waiting()] });
    const state = mountState(approvals);
    const [entry] = approvals.open;
    state.openDraft(entry, "approve");
    expect(state.draft.text).toBe("Can you add a dark mode toggle?");
    state.draft.text = "Add a dark mode toggle in Settings.";
    await state.saveDraft(entry);
    expect(approvals.approve).toHaveBeenCalledWith(entry, "Add a dark mode toggle in Settings.");
    expect(state.draft.id).toBe("");
    state.openDraft(entry, "decline");
    expect(state.draft.text).toBe("");
    state.draft.text = "Not now.";
    await state.saveDraft(entry);
    expect(approvals.decline).toHaveBeenCalledWith(entry, "Not now.");
  });
});

describe("approval queue reader", () => {
  function reader(options = {}) {
    const scope = effectScope();
    const app = createApp({});
    const value = app.runWithContext(() => scope.run(() => useVibe64MainChatApprovals({
      projectSlug: "chat-test", projectLabel: "Hello Node", sessionId: "session-1", sessionsApiPath: "/api/sessions", ...options
    })));
    return { value, scope };
  }

  it("reads one chat's queue and sends a member's message for approval", async () => {
    const { value, scope } = reader();
    expect(mocks.resourceOptions.path.value).toBe("/api/sessions/session-1/main-chat-approvals");
    expect(mocks.resourceOptions.realtime.matches({ payload: { sessionId: "session-1", reason: "main-chat-approval-sent" } })).toBe(true);
    expect(mocks.resourceOptions.realtime.matches({ payload: { sessionId: "session-1", reason: "session-agent-message-accepted" } })).toBe(false);
    expect(value.memberMode.value).toBe(true);
    expect(await value.send("Add dark mode")).toBe(true);
    const [path, request] = mocks.request.mock.calls[0];
    expect(path).toBe("/api/sessions/session-1/agent-message");
    expect(request.body.message).toBe("Add dark mode");
    expect(request.body.messageId).toMatch(/^[0-9a-f-]{36}$/u);
    mocks.request.mockResolvedValueOnce({ ok: false, error: "You have 5 messages waiting." });
    expect(await value.send("Another")).toBe(false);
    expect(mocks.feedback.report).toHaveBeenLastCalledWith(expect.objectContaining({ message: "You have 5 messages waiting." }));
    scope.stop();
  });

  it("never queues a member's own lesson, which runs on the team AI", () => {
    mocks.data.value = { ok: true, owner: false, practice: true, viewer: ana, ownerName: "Tony", entries: [] };
    const { value, scope } = reader();
    expect([value.memberMode.value, value.lessonTeamAi.value]).toEqual([false, true]);
    scope.stop();
  });

  it("acts on an entry at its revision", async () => {
    const { value, scope } = reader();
    const entry = waiting({ revision: 3 });
    await value.approve(entry, "Edited");
    await value.decline(entry, "Not now");
    await value.edit(entry, "Better");
    await value.withdraw(entry);
    expect(mocks.request.mock.calls.map(([path, { method, body }]) => [path.replace("/api/sessions/session-1", ""), method, body])).toEqual([
      ["/main-chat-approvals/approval-1/approve", "POST", { expectedRevision: 3, text: "Edited" }],
      ["/main-chat-approvals/approval-1/decline", "POST", { expectedRevision: 3, note: "Not now" }],
      ["/main-chat-approvals/approval-1", "PATCH", { text: "Better", expectedRevision: 3 }],
      ["/main-chat-approvals/approval-1/withdraw", "POST", { expectedRevision: 3 }]
    ]);
    scope.stop();
  });

  it("tells the sender when the owner decides", async () => {
    mocks.data.value = { ok: true, owner: false, viewer: ana, ownerName: "Tony", entries: [waiting()] };
    const { scope } = reader();
    mocks.data.value = { ...mocks.data.value, entries: [waiting({ status: "sent", decidedBy: tony })] };
    await nextTick();
    expect(mocks.feedback.report).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Tony approved and sent your message" }));
    mocks.data.value = { ...mocks.data.value, entries: [waiting({ status: "sent", decidedBy: tony }), waiting({ id: "approval-2" })] };
    await nextTick();
    mocks.data.value = { ...mocks.data.value, entries: [waiting({ status: "sent", decidedBy: tony }),
      waiting({ id: "approval-2", status: "declined", decidedBy: tony })] };
    await nextTick();
    expect(mocks.feedback.report).toHaveBeenLastCalledWith(expect.objectContaining({ message: "Tony declined your message" }));
    expect(mocks.feedback.report).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("notifies the owner of new messages in the project and counts them in the tab title", async () => {
    mocks.data.value = { ok: true, owner: true, viewer: tony, ownerName: "Tony", entries: [waiting(), waiting({ id: "approval-2" })] };
    vi.stubGlobal("document", { title: "Hello Node" });
    const onReview = vi.fn();
    const { value, scope } = reader({ onReview });
    await nextTick();
    expect(document.title).toBe("(2) Hello Node");
    const notice = mocks.realtime.find((options) => options.event === "vibe64.session.summary.changed");
    expect(notice.matches({ payload: { reason: "main-chat-approval-queued", projectSlug: "chat-test" } })).toBe(true);
    expect(notice.matches({ payload: { reason: "main-chat-approval-queued", projectSlug: "other" } })).toBe(false);
    notice.onEvent({ payload: { sessionId: "session-2", approvalSender: "Ana", approvalId: "approval-3" } });
    const report = mocks.feedback.report.mock.calls.at(-1)[0];
    expect(report.message).toBe("Ana sent a message for your approval in Hello Node");
    report.action.handler();
    expect(onReview).toHaveBeenCalledWith("session-2");
    expect(value.memberMode.value).toBe(false);
    scope.stop();
    expect(document.title).toBe("Hello Node");
  });
});

describe("member composer", () => {
  it("sends main-chat messages for approval with the owner's name", async () => {
    const { useVibe64AutopilotView } = await import("../../src/composables/useVibe64AutopilotView.js");
    const approvals = approvalsState();
    const props = reactive({ active: true, agentConnectionStatus: "connected", conversationLog: { turns: [] }, page: {},
      projectContext: {}, projectPane: "dashboard", session: { agentSession: { turn: { active: true } }, metadata: {}, sessionId: "session-1" },
      sessionArchive: {}, sessionSelectionArchived: false, sessionsApiPath: "/api/sessions", sessionToolbar: {}, workState: {} });
    const scope = effectScope();
    const view = createApp({}).runWithContext(() => scope.run(() => {
      attachConversationRuntime(props);
      return useVibe64AutopilotView(props, vi.fn(), { mainChatApprovals: approvals, assistantCanUseAi: ref(false) });
    }));
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerAttachmentsSupported.value).toBe(false);
    expect(view.composerSubmitMode.value).toBe("approval");
    expect(view.composerSubmitAriaLabel.value).toBe("Send to Tony for approval");
    expect(view.composerPlaceholder.value).toBe("Message main chat — Tony approves before it's sent");
    expect(view.composerHint.value).toBe("Main chat runs on Tony's AI. Tony approves each message.");
    expect(view.composerCanSubmit.value).toBe(false);
    view.composerDraft.value = "Add dark mode";
    expect(view.composerCanSubmit.value).toBe(true);
    expect(await view.submitComposerMessage()).toBe(true);
    expect(approvals.send).toHaveBeenCalledWith("Add dark mode");
    expect(view.composerDraft.value).toBe("");
    expect(props.sendAgentMessage).toBeUndefined();
    scope.stop();
  });

  it("sends a member's lesson message straight to its team AI and names that AI", async () => {
    const { useVibe64AutopilotView } = await import("../../src/composables/useVibe64AutopilotView.js");
    const approvals = reactive({ ...approvalsState(), memberMode: false, lessonTeamAi: true });
    const assistantSelection = { schema: "vibe64.assistant-selection.v1", engineId: "claude", modelProviderId: "deepseek",
      modelId: "deepseek-v4-pro", agentId: "claude", variantId: "high", modelLabel: "DeepSeek V4 Pro" };
    const props = reactive({ active: true, agentConnectionStatus: "connected", conversationLog: { turns: [] }, page: {},
      projectContext: {}, projectPane: "dashboard", session: { agentSession: { turn: { active: false } }, metadata: {}, sessionId: "session-1", assistantSelection },
      sessionArchive: {}, sessionSelectionArchived: false, sessionsApiPath: "/api/sessions", sessionToolbar: {}, workState: {} });
    const scope = effectScope();
    const view = createApp({}).runWithContext(() => scope.run(() => {
      attachConversationRuntime(props);
      return useVibe64AutopilotView(props, vi.fn(), { mainChatApprovals: approvals, assistantCanUseAi: ref(true) });
    }));
    expect(view.composerSubmitMode.value).not.toBe("approval");
    expect(view.composerAttachmentsSupported.value).toBe(true);
    expect(view.composerPlaceholder.value).toMatch(/^Message your lesson's AI — .*deepseek.* \(team AI\)$/iu);
    expect(view.composerHint.value).toMatch(/^This lesson runs on the team AI: .*deepseek.*\. Only you see this chat\.$/iu);
    scope.stop();
  });

  it("puts the queue above the composer, the waiting chip in the chat header and the approval send button", () => {
    const source = readFileSync(new URL("../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url), "utf8");
    expect(source).toMatch(/v-if="mainChatApprovals.isOwner && mainChatApprovals.waitingCount"[\s\S]*?\{\{ mainChatApprovals.waitingCount \}\} waiting/u);
    expect(source).toMatch(/data-vibe64-guide="chat"[\s\S]*?<Vibe64MainChatApprovals/u);
    expect(source).toMatch(/v-if="approvalMode"[\s\S]*?Send for approval/u);
    const log = readFileSync(new URL("../../src/components/studio/vibe64-session/Vibe64ConversationLog.vue", import.meta.url), "utf8");
    expect(log).toContain("{{ turn.metadata.sender.displayName }} · approved by {{ turn.metadata.sender.approvedBy }}");
  });
});
