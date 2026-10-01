import { computed, createRenderer, h, onScopeDispose, reactive, ref, nextTick } from "vue";
import { describe, it, expect, vi, afterEach } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";
const mocks = vi.hoisted(() => ({ mounted: vi.fn(), log: vi.fn(), access: vi.fn(), request: vi.fn() }));
vi.mock("../../src/composables/useVibe64MountedSessionData.js", () => ({ useVibe64MountedSessionData: mocks.mounted }));
vi.mock("../../src/composables/useVibe64ConversationLog.js", () => ({ useVibe64ConversationLog: mocks.log }));
vi.mock("../../src/composables/useVibe64AssistantAccess.js", () => ({ useVibe64AssistantAccess: mocks.access }));
vi.mock("../../src/composables/useVibe64AgentSettings.js", () => ({ useVibe64AgentSettings: () => ({ settings: ref({ providerId: "codex" }) }) }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
import { useVibe64ConversationRuntime } from "../../src/composables/useVibe64ConversationRuntime.js";
import { createProjectVoiceBinding } from "../../packages/vibe64-voice/src/client/projectVoiceBinding.js";
const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
const releases = [];
afterEach(() => { releases.splice(0).reverse().forEach(release => release()); vi.clearAllMocks(); });
function fixture() {
  const disposed = [];
  const owners = [];
  mocks.mounted.mockImplementation(identity => {
    const value = { identity, session: ref({ sessionId: identity.sessionId, agentSession: { turn: {} } }),
      detailState: ref({}), agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) };
    owners.push(value); onScopeDispose(() => disposed.push(`${identity.projectSlug}/${identity.sessionId}`)); return value;
  });
  mocks.log.mockImplementation(() => ({ turns: ref([]) }));
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
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer); app.mount({});
  releases.push(() => app.unmount());
  return { app, runtime, selected, viewer, owners, disposed, access };
}

describe("retained project conversation ownership", () => {
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
    expect(mocks.request).toHaveBeenCalledWith("/api/app/one/vibe64/sessions/s1/agent-message", expect.objectContaining({ method: "POST", body: expect.objectContaining({ messageId: "voice-1", message: "Same conversation" }) }));
    binding.release();
    expect(f.disposed).toContain("one/s1");
    expect(original.available.value).toBe(false);
  });
  it("shares admission and canonical message receipts between text and voice without repeat submission", async () => {
    const f = fixture(); const runtime = f.runtime.value;
    const pending = Promise.withResolvers(); mocks.request.mockReturnValue(pending.promise);
    const sending = runtime.send({ message: "Check it" }, { messageId: "same-id" });
    expect(await runtime.send({ message: "Check it" }, { messageId: "same-id" })).toBe(false);
    runtime.conversationLog.turns = [{ user: { messageId: "same-id", text: "Check it" } }];
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
});
