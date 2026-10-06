import { computed, createRenderer, h, onScopeDispose, reactive, ref, nextTick } from "vue";
import { describe, it, expect, vi, afterEach } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";
const mocks = vi.hoisted(() => ({ mounted: vi.fn(), log: vi.fn(), access: vi.fn(), request: vi.fn(), read: vi.fn() }));
vi.mock("../../src/composables/useVibe64MountedSessionData.js", () => ({ useVibe64MountedSessionData: mocks.mounted }));
vi.mock("../../src/composables/useVibe64ConversationLog.js", () => ({ useVibe64ConversationLog: mocks.log }));
vi.mock("../../src/composables/useVibe64AssistantAccess.js", () => ({ useVibe64AssistantAccess: mocks.access }));
vi.mock("../../src/composables/useVibe64AgentSettings.js", () => ({ useVibe64AgentSettings: () => ({ settings: ref({ providerId: "codex" }), requestSettings: ref(null) }) }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: (url, options) => options?.method === "GET" ? mocks.read(url, options) : mocks.request(url, options) }) }));
import { useVibe64ConversationRuntime } from "../../src/composables/useVibe64ConversationRuntime.js";
import { createProjectVoiceBinding } from "../../packages/vibe64-voice/src/client/projectVoiceBinding.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { VIBE64_SESSION_CHANGED_EVENT } from "../../src/lib/vibe64SessionRequestConfig.js";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { createConversationFixtureSocket, provideConversationFixture } from "./helpers/conversationRuntimeFixture.js";
const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
const releases = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); vi.clearAllMocks(); });
function fixture({ readGoal = () => null } = {}) {
  const disposed = [];
  const owners = [];
  mocks.mounted.mockImplementation(identity => {
    const value = { identity, session: ref({ sessionId: identity.sessionId, agentSession: { turn: {} } }),
      detailState: ref({}), agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) };
    owners.push(value); onScopeDispose(() => disposed.push(`${identity.projectSlug}/${identity.sessionId}`)); return value;
  });
  const states = new Map();
  function read(id) {
    if (!states.has(id)) states.set(id, reactive({ id, segmentId: "native-thread", status: "ready",
      capabilities: { steering: true, attachments: true }, conversationLog: [] }));
    return states.get(id);
  }
  const socket = createConversationFixtureSocket(read);
  mocks.read.mockImplementation(url => url.endsWith("/goal") ? readGoal() : read(decodeURIComponent(url.split("/conversations/")[1])));
  mocks.log.mockImplementation(({ conversation }) => ({ turns: conversation.turns }));
  const access = { canUseChat: ref(true), restrictionMessage: ref(""), accessError: ref("") };
  mocks.access.mockReturnValue(access);
  mocks.request.mockResolvedValue({ ok: true });
  const viewer = ref({ actorKey: "owner" });
  const selected = reactive({ sessionId: "s1", projectSlug: "one" });
  let runtime;
  const app = renderer.createApp({ setup() {
    runtime = useVibe64ConversationRuntime({ sessionId: computed(() => selected.sessionId), projectSlug: computed(() => selected.projectSlug), sessionsApiPath: "/api/vibe64/sessions" });
    return () => h("div");
  } });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  provideConversationFixture(app, socket, "owner"); app.mount({});
  releases.push(() => app.unmount());
  return { app, runtime, selected, viewer, owners, disposed, access, socket,
    receipt(identity, turn) {
      const id = mainConversationId(identity);
      const saved = { turnId: `fixture-${turn.user.messageId}`, ...turn };
      read(id).conversationLog.push(saved);
      socket.notify({ type: "transcript", patch: { type: "upsert-turn", turn: saved } }, id);
    } };
}

describe("retained project conversation ownership", () => {
  it("refreshes a pinned foreign goal through the same binding on scoped product invalidations", async () => {
    let view = { status: "available", goal: { id: "pinned", objective: "Plain objective", status: "paused" },
      target: { segmentId: "foreign-goal", capabilities: { goals: true, goalBudgets: false,
        goalCommands: { resume: { delivery: "message", interruptsTurn: false } } } },
      routing: { mode: "senior", selection: { engineId: "claude" } } };
    const f = fixture({ readGoal: () => structuredClone(view) });
    const runtime = f.runtime.value;
    await vi.waitFor(() => {
      expect(runtime.goalView.value).toEqual(view);
      expect(runtime.goalState.value.pending).toBe(false);
    });
    const reads = () => mocks.read.mock.calls.filter(([url]) => url.endsWith("/goal"));
    const before = reads().length;
    f.socket.publish(VIBE64_SESSION_CHANGED_EVENT, { projectSlug: "other", sessionId: "s1", reason: "claude-goal" });
    f.socket.publish(VIBE64_SESSION_CHANGED_EVENT, { projectSlug: "one", sessionId: "s2", reason: "claude-goal" });
    await nextTick();
    expect(reads()).toHaveLength(before);
    view = { ...view, goal: { ...view.goal, status: "active" } };
    f.socket.publish(VIBE64_SESSION_CHANGED_EVENT, { projectSlug: "one", sessionId: "s1", reason: "claude-goal" });
    await vi.waitFor(() => expect(runtime.goalView.value.goal.status).toBe("active"));
    const retained = runtime.retain(); releases.push(retained.release);
    f.app.unmount();
    view = { ...view, goal: { ...view.goal, status: "paused" } };
    f.socket.publish(VIBE64_ACCOUNTS_CHANGED_EVENT, {});
    await vi.waitFor(() => expect(runtime.goalView.value.goal.status).toBe("paused"));
    expect(runtime.goalView.value.target.segmentId).toBe("foreign-goal");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(reads().every(([url]) => url.startsWith("/api/assistant/app/conversations/") && !url.includes("/agent-goal"))).toBe(true);
  });
  it("keeps the original target after navigation and text-screen unmount, then disposes its last reader", async () => {
    const f = fixture(); const original = f.runtime.value;
    const binding = createProjectVoiceBinding(original);
    binding.retain(); releases.push(() => binding.release());
    const context = binding.captureContext();
    f.selected.projectSlug = "two"; f.selected.sessionId = "s2";
    await nextTick();
    expect(f.disposed).not.toContain("one/s1");
    f.app.unmount();
    expect(original.available.value).toBe(true);
    await binding.submitText("Same conversation", { messageId: "voice-1", context });
    expect(mocks.request).toHaveBeenCalledWith(`/api/assistant/app/conversations/${encodeURIComponent(mainConversationId({ projectSlug: "one", sessionId: "s1" }))}/messages`, expect.objectContaining({ method: "POST", body: expect.objectContaining({ messageId: "voice-1", text: "Same conversation" }) }));
    binding.release();
    expect(f.disposed).toContain("one/s1");
    expect(original.available.value).toBe(false);
  });
  it("shares admission and canonical message receipts between text and voice without repeat submission", async () => {
    const f = fixture(); const runtime = f.runtime.value;
    const pending = Promise.withResolvers(); mocks.request.mockReturnValue(pending.promise);
    const sending = runtime.send({ message: "Check it" }, { messageId: "same-id" });
    expect(await runtime.send({ message: "Check it" }, { messageId: "same-id" })).toBe(false);
    f.receipt(runtime.identity, { user: { messageId: "same-id", text: "Check it" } });
    expect(await sending).toEqual({ ok: true });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(runtime.delivery.state.messages).toEqual([]);
    pending.reject(new Error("The HTTP receipt was lost")); await nextTick();
  });
  it("revokes the old actor before a pending HTTP request can acknowledge delivery", async () => {
    const f = fixture(); const runtime = f.runtime.value; const retained = runtime.retain(); releases.push(retained.release);
    mocks.request.mockReturnValue(new Promise(() => {}));
    const sending = runtime.send({ message: "Private request" }, { messageId: "owner-request" });
    f.viewer.value = { actorKey: "member" }; await nextTick();
    expect(runtime.available.value).toBe(false); expect(await sending).toBe(false);
    await expect(runtime.send({ message: "Another" })).rejects.toThrow("no longer available");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rechecks current authorization and refuses a mismatched utterance context", async () => {
    const f = fixture(); const binding = createProjectVoiceBinding(f.runtime.value);
    const context = binding.captureContext(); f.access.canUseChat.value = false; f.access.restrictionMessage.value = "Connection unavailable";
    await expect(binding.submitText("Send", { messageId: "denied", context })).rejects.toThrow("Connection unavailable");
    expect(() => binding.submitText("Send", { context: { ...context, projectSlug: "other" } })).toThrow("another conversation");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("refuses voice submission after its retained project session is archived", async () => {
    const f = fixture(); const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    binding.retain(); releases.push(() => binding.release());
    const context = binding.captureContext();
    f.owners[0].session.value.status = "archived";
    await nextTick();
    expect(binding.available).toBe(false);
    await expect(binding.submitText("Late words", { messageId: "archived-voice", context }))
      .rejects.toThrow("no longer available");
    expect(runtime.draft.value).toBe("");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("aborts only the captured pending message through the supplied Send owner", async () => {
    const f = fixture();
    let signal;
    mocks.request.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
    }));
    const runtime = f.runtime.value;
    const sending = runtime.send({ message: "Routing this exact request" }, { messageId: "pending-router" });
    expect(runtime.cancelMessage("another-message")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(runtime.cancelMessage("pending-router")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(await sending).toBe(false);
    expect(runtime.cancelMessage("pending-router")).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
