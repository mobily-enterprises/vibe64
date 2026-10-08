import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { computed, createRenderer, h, onScopeDispose, reactive, ref, nextTick, ssrContextKey } from "vue";
import { describe, it, expect, vi, afterEach } from "vitest";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_TRAINING_LEARNER_GESTURE_KEY, VIBE64_COLLEAGUE_BODY_KEY, VIBE64_COLLEAGUE_VIEW_KEY, VIBE64_COLLEAGUE_LAYOUT_KEY } from "../../src/lib/vibe64AssistantHost.js";
const mocks = vi.hoisted(() => ({ mounted: vi.fn(), log: vi.fn(), access: vi.fn(), request: vi.fn(), read: vi.fn() }));
vi.mock("../../src/composables/useVibe64MountedSessionData.js", () => ({ useVibe64MountedSessionData: mocks.mounted }));
vi.mock("../../src/composables/useVibe64ConversationLog.js", () => ({ useVibe64ConversationLog: mocks.log }));
vi.mock("../../src/composables/useVibe64AssistantAccess.js", () => ({ useVibe64AssistantAccess: mocks.access }));
vi.mock("../../src/composables/useVibe64AgentSettings.js", () => ({ useVibe64AgentSettings: () => ({ settings: ref({ providerId: "codex" }), requestSettings: ref(null) }) }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: (url, options) => url.includes("/training/presentation") ? Promise.resolve({ ok: true, navigation: null, cue: null }) : options?.method === "GET" ? mocks.read(url, options) : mocks.request(url, options) }) }));
// Same feedback resource interface; original tests have no practical commands.
vi.mock("@jskit-ai/shell-web/client/error", () => ({ useShellWebErrorRuntime: () => ({ report: vi.fn() }) }));
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
function fixture({ readGoal = () => null, status = "ready", steering = true,
  learningAttemptId, learnerId, noExercise, sourceProjectSlug, projectSlug = "one", sessionId = "s1", sessionsApiPath = "/api/vibe64/sessions", beforeMount } = {}) {
  const disposed = [];
  const owners = [];
  mocks.mounted.mockImplementation(identity => {
    const value = { identity, session: ref({ sessionId: identity.sessionId, agentSession: { turn: {} } }),
      detailState: ref({}), agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) };
    owners.push(value); onScopeDispose(() => disposed.push(`${identity.projectSlug}/${identity.sessionId}`)); return value;
  });
  const states = new Map();
  function read(id) {
    if (!states.has(id)) states.set(id, reactive({ id, segmentId: "native-thread", status,
      capabilities: { steering, attachments: true }, conversationLog: [] }));
    return states.get(id);
  }
  const socket = createConversationFixtureSocket(read);
  mocks.read.mockImplementation(url => url.endsWith("/goal") ? readGoal() : read(decodeURIComponent(url.split("/conversations/")[1])));
  mocks.log.mockImplementation(({ conversation }) => ({ turns: conversation.turns }));
  const access = { canUseChat: ref(true), restrictionMessage: ref(""), accessError: ref("") };
  mocks.access.mockReturnValue(access);
  mocks.request.mockResolvedValue({ ok: true });
  const viewer = ref({ actorKey: "owner" });
  const selected = reactive({ sessionId, projectSlug, learningAttemptId, learnerId, noExercise, sourceProjectSlug, sessionsApiPath });
  let runtime;
  const app = renderer.createApp({ setup() {
    runtime = useVibe64ConversationRuntime({ sessionId: computed(() => selected.sessionId), projectSlug: computed(() => selected.projectSlug), sessionsApiPath: computed(() => selected.sessionsApiPath),
      learningAttemptId: computed(() => selected.learningAttemptId), learnerId: computed(() => selected.learnerId), noExercise: computed(() => selected.noExercise), sourceProjectSlug: computed(() => selected.sourceProjectSlug) });
    return () => h("div");
  } });
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  provideConversationFixture(app, socket, "owner");
  if (!beforeMount) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    app.use(VueQueryPlugin, { queryClient });
    releases.push(() => queryClient.clear());
  }
  beforeMount?.(app, { socket, read, selected }); app.mount({});
  releases.push(() => app.unmount());
  return { app, runtime, selected, viewer, owners, disposed, access, socket,
    snapshot(identity, fields) {
      const id = mainConversationId(identity);
      Object.assign(read(id), fields);
      socket.notify({ type: "phase" }, id);
    },
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
    expect(binding.conversationId).toBe(mainConversationId(original.identity));
    expect(binding.showAvatar).toBeUndefined();
    expect(binding.id).toBe(JSON.stringify(["project", "owner", "one", "s1"]));
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
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    f.receipt(runtime.identity, { user: { messageId: "same-id", text: "Check it" } });
    expect(await sending).toEqual({ ok: true });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(runtime.delivery.state.messages).toEqual([]);
    pending.reject(new Error("The HTTP receipt was lost")); await nextTick();
  });
  it("forwards Main's provisional voice transcript through the live host view without changing the retained conversation", async () => {
    const f = fixture();
    const runtime = f.runtime.value;
    const first = vi.fn();
    const view = { onTranscript: first };
    const binding = createProjectVoiceBinding(runtime, view);
    binding.retain(); releases.push(() => binding.release());
    const transcript = { id: "recording-one", text: "Still speaking while Main works" };
    binding.onTranscript(transcript);
    expect(first).toHaveBeenCalledWith(transcript);
    binding.onTranscript(null);
    expect(first).toHaveBeenLastCalledWith(null);
    const next = vi.fn();
    view.onTranscript = next;
    binding.onTranscript({ ...transcript, text: "Updated words" });
    expect(next).toHaveBeenCalledWith({ ...transcript, text: "Updated words" });
    expect(first).toHaveBeenCalledTimes(2);
    expect(binding.conversationId).toBe(mainConversationId(runtime.identity));
    expect(runtime.conversationLog.turns).toEqual([]);
    expect(runtime.draft.value).toBe("");
    expect(runtime.delivery.state.messages).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("revokes the old actor before a pending HTTP request can acknowledge delivery", async () => {
    const f = fixture(); const runtime = f.runtime.value; const retained = runtime.retain(); releases.push(retained.release);
    mocks.request.mockReturnValue(new Promise(() => {}));
    const sending = runtime.send({ message: "Private request" }, { messageId: "owner-request" });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
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
  it("retains both spoken followers of a nonsteerable Main turn until each canonical ready boundary", async () => {
    const f = fixture({ status: "working", steering: false });
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    const context = binding.captureContext();
    f.owners[0].session.value.agentSession.turn = { active: true, id: "opencode-turn", state: "active" };
    f.snapshot(runtime.identity, { status: "working", capabilities: { steering: false, attachments: true } });
    await vi.waitFor(() => expect(runtime.steerable.value).toBe(false));
    runtime.draft.value = "Keep this independent typed draft";
    const first = binding.submitText("First spoken follow-up", { messageId: "speech-a", context });
    const second = binding.submitText("Second spoken follow-up", { messageId: "speech-b", context });
    await vi.waitFor(() => expect(runtime.delivery.state.messages.map(message => message.id)).toEqual(["speech-a", "speech-b"]));
    expect(mocks.request).not.toHaveBeenCalled();
    for (const message of runtime.delivery.state.messages) {
      expect(message.status).toBe("pending");
      expect(message.payload.submissionKind).toBe("send");
      expect(message.payload.request.steer).toBeUndefined();
    }
    mocks.request.mockImplementation(async (_url, { body }) => {
      f.snapshot(runtime.identity, { status: "working" });
      f.receipt(runtime.identity, { user: { messageId: body.messageId, text: body.text } });
      return { ok: true };
    });
    f.snapshot(runtime.identity, { status: "ready" });
    expect(await first).toEqual({ ok: true });
    await vi.waitFor(() => expect(runtime.delivery.state.messages.map(message => message.id)).toEqual(["speech-b"]));
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].body).toEqual({ text: "First spoken follow-up", data: { originId: expect.stringMatching(/^tab:/) }, messageId: "speech-a" });
    const authoredOrigin = mocks.request.mock.calls[0][1].body.data.originId;
    f.snapshot(runtime.identity, { status: "ready" });
    expect(await second).toEqual({ ok: true });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][1].body).toEqual({ text: "Second spoken follow-up", data: { originId: authoredOrigin }, messageId: "speech-b" });
    expect(runtime.delivery.state.messages).toEqual([]);
    expect(runtime.draft.value).toBe("Keep this independent typed draft");
    expect(runtime.conversationLog.turns.map(turn => turn.user.messageId)).toEqual(["speech-a", "speech-b"]);
  });
  it("keeps Codex steering immediate and never converts a failed authored steer into an ordinary follower", async () => {
    const f = fixture();
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    const context = binding.captureContext();
    f.owners[0].session.value.agentSession.turn = { active: true, id: "codex-turn", state: "active" };
    f.snapshot(runtime.identity, { status: "working" });
    await vi.waitFor(() => expect(runtime.steerable.value).toBe(true));
    mocks.request.mockResolvedValue({ ok: false, error: "That turn finished", code: "conversation_not_steerable" });
    await expect(binding.submitText("Original spoken steering", { messageId: "steer-a", context })).rejects.toThrow("That turn finished");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const request = runtime.delivery.find("steer-a").payload.request;
    const authored = { ...request, data: { ...request.data } };
    expect(authored).toEqual({ text: "Original spoken steering", data: { originId: expect.stringMatching(/^tab:/) }, steer: true });
    f.snapshot(runtime.identity, { status: "working", capabilities: { steering: false, attachments: true } });
    await vi.waitFor(() => expect(runtime.steerable.value).toBe(false));
    expect(await binding.submitText("Different words must not replace retry", { messageId: "steer-a", context })).toBe(false);
    expect(runtime.delivery.find("steer-a").payload.request).toEqual(authored);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("retains an uncertain authored steering request without turning it into a new send", async () => {
    const f = fixture({ status: "working" });
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    const context = binding.captureContext();
    f.owners[0].session.value.agentSession.turn = { active: true, id: "codex-turn", state: "active" };
    mocks.request.mockRejectedValue(new Error("The HTTP receipt was lost"));
    expect(await binding.submitText("Keep these exact words", { messageId: "unknown-steer", context })).toBe(false);
    const message = runtime.delivery.find("unknown-steer");
    expect(message.status).toBe("uncertain");
    const authored = { ...message.payload.request, data: { ...message.payload.request.data } };
    expect(authored.steer).toBe(true);
    f.snapshot(runtime.identity, { status: "working", capabilities: { steering: false, attachments: true } });
    await vi.waitFor(() => expect(runtime.steerable.value).toBe(false));
    expect(await binding.submitText("Do not replace these words", { messageId: "unknown-steer", context })).toBe(false);
    expect(await binding.submitText("Do not bypass uncertainty", { messageId: "new-speech", context })).toBe(false);
    expect(runtime.delivery.find("unknown-steer").payload.request).toEqual(authored);
    expect(runtime.delivery.find("unknown-steer").status).toBe("uncertain");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("preserves native turn and connection guards when the canonical conversation advertises steering", async () => {
    const f = fixture({ status: "working" });
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    const owner = f.owners[0];
    for (const turn of [
      { active: true, id: "native-turn", state: "active", status: "observation_lost" },
      { active: true, state: "active" },
      { active: true, id: "native-turn", state: "stopping" }
    ]) {
      owner.session.value.agentSession.turn = turn;
      await expect(binding.submitText("Unsafe native steering", { messageId: "unsafe-steer", context: binding.captureContext() }))
        .rejects.toThrow("Wait for this turn to finish or stop it before sending.");
    }
    owner.session.value.agentSession.turn = { active: true, id: "native-turn", state: "active" };
    owner.agentConnectionStatus.value = "disconnected";
    await expect(binding.submitText("Disconnected native steering", { messageId: "unsafe-steer", context: binding.captureContext() }))
      .rejects.toThrow("Wait for this turn to finish or stop it before sending.");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(runtime.delivery.state.messages).toEqual([]);
  });
  it("cancels only the exact deferred speech and retires an undispatched follower on actor change", async () => {
    const f = fixture({ status: "working", steering: false });
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    const context = binding.captureContext();
    f.snapshot(runtime.identity, { status: "working", capabilities: { steering: false, attachments: true } });
    await nextTick();
    const first = binding.submitText("Cancel these words", { messageId: "deferred-a", context });
    const second = binding.submitText("Never cross accounts", { messageId: "deferred-b", context });
    await vi.waitFor(() => expect(runtime.delivery.state.messages).toHaveLength(2));
    expect(runtime.cancelMessage("unrelated")).toBe(false);
    expect(runtime.cancelMessage("deferred-a")).toBe(true);
    expect(await first).toBe(false);
    f.viewer.value = { actorKey: "member" };
    await nextTick();
    expect(await second).toBe(false);
    expect(runtime.available.value).toBe(false);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("stops both undispatched spoken followers through the original conversation Stop owner", async () => {
    const f = fixture({ status: "working", steering: false });
    const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime);
    f.snapshot(runtime.identity, { status: "working", capabilities: { steering: false, attachments: true } });
    await nextTick();
    const first = binding.submitText("First waiting words", { messageId: "stop-a", context: binding.captureContext() });
    const second = binding.submitText("Second waiting words", { messageId: "stop-b", context: binding.captureContext() });
    await vi.waitFor(() => expect(runtime.delivery.state.messages).toHaveLength(2));
    expect(await binding.cancelWork()).toEqual({ ok: true });
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toMatch(/\/cancel$/);
    expect(mocks.request.mock.calls[0][1].body).toBeUndefined();
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
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(runtime.cancelMessage("another-message")).toBe(false);
    expect(signal.aborted).toBe(false);
    expect(runtime.cancelMessage("pending-router")).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(await sending).toBe(false);
    expect(runtime.cancelMessage("pending-router")).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});


const learningAttemptA = "11111111-1111-4111-8111-111111111111";
const learningAttemptB = "22222222-2222-4222-8222-222222222222";
const learningPath = attempt => `/api/learning/${attempt}/vibe64/sessions`;

describe("same Main transport for an actual learning conversation", () => {
  it("uses the exact Main learning selector, ordinary app transport and captured application path", async () => {
    const f = fixture({ projectSlug: "", sessionId: "learning-session", learningAttemptId: learningAttemptA,
      learnerId: "learner-a", sessionsApiPath: learningPath(learningAttemptA) });
    const runtime = f.runtime.value;
    expect(runtime.identity).toMatchObject({ projectSlug: "", learningAttemptId: learningAttemptA, learnerId: "learner-a",
      sessionId: "learning-session", sessionsApiPath: learningPath(learningAttemptA) });
    expect(runtime.identity.actorKey).toBe(JSON.stringify(["learning", "owner", "learner-a", learningAttemptA]));
    expect(f.viewer.value).toEqual({ actorKey: "owner" });
    expect(f.owners[0].identity.learningAttemptId).toBe(learningAttemptA);
    expect(mocks.access.mock.calls[0][0].learnerId).toBe("learner-a");
    await runtime.send({ message: "Teach this lesson" }, { messageId: "learning-first" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toBe(`/api/assistant/app/conversations/${encodeURIComponent(mainConversationId({
      learningAttemptId: learningAttemptA, sessionId: "learning-session"
    }))}/messages`);
    expect(mocks.request.mock.calls[0][1].body).toMatchObject({ messageId: "learning-first", text: "Teach this lesson" });
    expect(f.owners[0].refresh).toHaveBeenCalledWith({ reason: "agent-message-accepted" });
  });

  it("keeps accepted work captured and never resends it after explicit attempt/learner change", async () => {
    const f = fixture({ projectSlug: "", sessionId: "same-session", learningAttemptId: learningAttemptA,
      learnerId: "learner-a", sessionsApiPath: learningPath(learningAttemptA) });
    const original = f.runtime.value;
    const retained = original.retain(); releases.push(retained.release);
    original.draft.value = "Original unsent words";
    mocks.request.mockReturnValue(new Promise(() => {}));
    const sending = original.send({ message: "Exact accepted request" }, { messageId: "captured-learning" });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    const acceptedUrl = mocks.request.mock.calls[0][0];
    f.selected.learningAttemptId = learningAttemptB;
    f.selected.sessionsApiPath = learningPath(learningAttemptB);
    await nextTick();
    expect(original.available.value).toBe(false);
    expect(await sending).toBe(false);
    expect(f.runtime.value.identity.learningAttemptId).toBe(learningAttemptB);
    expect(f.runtime.value.draft.value).toBe("");
    expect(original.draft.value).toBe(""); // Original dispatch/actor retirement clears its private editor buffer.
    await expect(original.send({ message: "Do not cross attempts" })).rejects.toThrow("no longer available");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(acceptedUrl).toContain(encodeURIComponent(mainConversationId({ learningAttemptId: learningAttemptA, sessionId: "same-session" })));
    const second = f.runtime.value;
    const secondRetained = second.retain(); releases.push(secondRetained.release);
    f.selected.learnerId = "learner-b";
    await nextTick();
    expect(second.available.value).toBe(false);
    expect(f.runtime.value.identity.actorKey).not.toBe(second.identity.actorKey);
    expect(f.runtime.value.draft.value).toBe("");
    f.viewer.value = null;
    await nextTick();
    expect(f.runtime.value).toBe(null);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it("refreshes goals only for the exact learning attempt without sending a message", async () => {
    const f = fixture({ projectSlug: "", sessionId: "lesson", learningAttemptId: learningAttemptA,
      learnerId: "learner-a", sessionsApiPath: learningPath(learningAttemptA) });
    await vi.waitFor(() => expect(mocks.read.mock.calls.some(([url]) => url.endsWith("/goal"))).toBe(true));
    const count = () => mocks.read.mock.calls.filter(([url]) => url.endsWith("/goal")).length;
    const before = count();
    for (const payload of [
      { learningAttemptId: learningAttemptB, sessionId: "lesson", reason: "codex-goal" },
      { projectSlug: "working", sessionId: "lesson", reason: "codex-goal" },
      { sessionId: "lesson", reason: "codex-goal" },
      { learningAttemptId: learningAttemptA, sessionId: "other", reason: "codex-goal" }
    ]) f.socket.publish(VIBE64_SESSION_CHANGED_EVENT, payload);
    await nextTick();
    expect(count()).toBe(before);
    f.socket.publish(VIBE64_SESSION_CHANGED_EVENT, { learningAttemptId: learningAttemptA, sessionId: "lesson", reason: "codex-goal" });
    await vi.waitFor(() => expect(count()).toBeGreaterThan(before));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    { learningAttemptId: learningAttemptA, learnerId: undefined, sessionsApiPath: learningPath(learningAttemptA), projectSlug: "" },
    { learningAttemptId: learningAttemptA, learnerId: "learner", sessionsApiPath: learningPath(learningAttemptB), projectSlug: "" },
    { learningAttemptId: learningAttemptA, learnerId: "learner", sessionsApiPath: learningPath(learningAttemptA), projectSlug: "working" },
    { learningAttemptId: "invalid", learnerId: "learner", sessionsApiPath: learningPath("invalid"), projectSlug: "" }
  ])("refuses incomplete/mixed learning scope without creating a Working fallback (%j)", input => {
    const f = fixture(input);
    expect(f.runtime.value).toBe(null);
    expect(f.owners).toEqual([]);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("same Main voice binding for actual source-less Learning", () => {
  const attempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const nextAttempt = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const path = `/api/learning/${attempt}/vibe64/sessions`;
  it("captures the exact Learning voice socket and submits through its existing Main target", async () => {
    const f = fixture({ projectSlug: "", sessionId: "lesson", learningAttemptId: attempt, learnerId: "42", sessionsApiPath: path });
    const runtime = f.runtime.value; const binding = createProjectVoiceBinding(runtime);
    expect(binding.id).toBe(JSON.stringify(["learning", runtime.identity.actorKey, "42", attempt, "lesson"]));
    expect(binding.conversationId).toBe(mainConversationId({ learningAttemptId: attempt, sessionId: "lesson" }));
    expect(binding.socketUrl).toBe(`${path}/lesson/voice/ws`); expect(binding.label).toBe("Lesson · lesson");
    expect(binding.preferenceTarget).toBe("coding"); expect(binding.defaults).toEqual({ readAloud: true });
    const context = binding.captureContext(); expect(context).toEqual({ ...runtime.identity, clientId: runtime.presentation.clientId });
    binding.retain(); releases.push(() => binding.release());
    await binding.submitText("Teach me the next step", { messageId: "lesson-voice", context });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith(`/api/assistant/app/conversations/${encodeURIComponent(binding.conversationId)}/messages`, expect.objectContaining({
      method: "POST", body: expect.objectContaining({ messageId: "lesson-voice", text: "Teach me the next step" })
    }));
    expect(binding.narration.vocalizeThinking).toBe(false); expect(binding.narration.vocalizeInterimTurns).toBe(false);
  });
  it("retains an admitted voice target without retargeting or resending after attempt changes", async () => {
    const f = fixture({ projectSlug: "", sessionId: "lesson", learningAttemptId: attempt, learnerId: "42", sessionsApiPath: path });
    const runtime = f.runtime.value; const binding = createProjectVoiceBinding(runtime); const context = binding.captureContext();
    binding.retain(); releases.push(() => binding.release());
    const held = Promise.withResolvers(); mocks.request.mockReturnValueOnce(held.promise);
    const sending = binding.submitText("Captured original words", { messageId: "held-lesson-voice", context });
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    f.selected.learningAttemptId = nextAttempt; f.selected.sessionsApiPath = `/api/learning/${nextAttempt}/vibe64/sessions`;
    await nextTick();
    expect(binding.socketUrl).toBe(`${path}/lesson/voice/ws`); expect(binding.captureContext()).toEqual(context);
    held.resolve({ ok: true }); expect(await sending).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await expect(binding.submitText("Old target cannot admit new words", { messageId: "retired-lesson-voice", context })).rejects.toThrow("no longer available");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("refuses changed captured learner, attempt or API path without dispatch", async () => {
    const f = fixture({ projectSlug: "", sessionId: "lesson", learningAttemptId: attempt, learnerId: "42", sessionsApiPath: path });
    const binding = createProjectVoiceBinding(f.runtime.value); const context = binding.captureContext();
    for (const changed of [{ learnerId: "other" }, { learningAttemptId: nextAttempt }, { sessionsApiPath: `/api/learning/${nextAttempt}/vibe64/sessions` }]) {
      expect(() => binding.submitText("Wrong target", { messageId: "wrong-lesson-voice", context: { ...context, ...changed } })).toThrow("another conversation");
    }
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("refuses mixed or incomplete Learning identity without a Working voice fallback", () => {
    const f = fixture({ projectSlug: "", sessionId: "lesson", learningAttemptId: attempt, learnerId: "42", sessionsApiPath: path });
    for (const changed of [{ projectSlug: "fake" }, { learnerId: "" }, { actorKey: "" }, { sessionsApiPath: "/api/vibe64/sessions" }]) {
      expect(() => createProjectVoiceBinding({ ...f.runtime.value, identity: { ...f.runtime.value.identity, ...changed } })).toThrow("exact saved learner");
    }
    expect(mocks.request).not.toHaveBeenCalled();
  });
});


describe("Main lesson answer context uses the original conversation snapshot", () => {
  const lessonQuestion = (questionId = "question-one") => ({ attemptId: learningAttemptA,
    questionId, assessmentId: "workspace-navigation", issuedRevision: 4,
    topicHash: "a".repeat(64), lessonHash: "b".repeat(64) });
  const lessonFixture = () => fixture({ projectSlug: "", sessionId: "lesson-answer",
    learningAttemptId: learningAttemptA, learnerId: "learner-a", sessionsApiPath: learningPath(learningAttemptA) });

  it("captures only the delivered question fields in a typed Main answer", async () => {
    const f = lessonFixture(); const runtime = f.runtime.value; const question = lessonQuestion();
    f.snapshot(runtime.identity, { trainingQuestion: { ...question, claimedPass: true } });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(question));
    await runtime.send({ message: "My actual answer" }, { messageId: "typed-lesson-answer" });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].body).toMatchObject({ text: "My actual answer",
      messageId: "typed-lesson-answer", data: { trainingQuestion: question } });
    expect(mocks.request.mock.calls[0][1].body.data.trainingQuestion).toEqual(question);
    expect(runtime.draft.value).toBe("");
  });

  it("keeps the spoken answer attached to its recording-start question", async () => {
    const f = lessonFixture(); const runtime = f.runtime.value; const first = lessonQuestion();
    f.snapshot(runtime.identity, { trainingQuestion: first });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(first));
    const binding = createProjectVoiceBinding(runtime); const context = binding.captureContext();
    expect(context.trainingQuestion).toEqual(first);
    expect(context.trainingQuestion).not.toBe(runtime.trainingQuestion.value);
    const next = lessonQuestion("question-two");
    f.snapshot(runtime.identity, { trainingQuestion: next });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(next));
    await binding.submitText("Answer to the first question", { messageId: "captured-lesson-answer", context });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].body.data.trainingQuestion).toEqual(first);
  });

  it("never associates an earlier ordinary recording with a later delivered question", async () => {
    const f = lessonFixture(); const runtime = f.runtime.value;
    const binding = createProjectVoiceBinding(runtime); const context = binding.captureContext();
    expect(context).toEqual({ ...runtime.identity, clientId: runtime.presentation.clientId });
    const question = lessonQuestion();
    f.snapshot(runtime.identity, { trainingQuestion: question });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(question));
    await binding.submitText("Words recorded before that question", { messageId: "ordinary-lesson-words", context });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][1].body.data).not.toHaveProperty("trainingQuestion");
  });

  it("retains the original question and words when the original delivery owner retries", async () => {
    const f = lessonFixture(); const runtime = f.runtime.value; const first = lessonQuestion();
    f.snapshot(runtime.identity, { trainingQuestion: first });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(first));
    mocks.request.mockResolvedValueOnce({ ok: false, error: "Delivery refused", retryable: true });
    await expect(runtime.send({ message: "Original answer words" }, { messageId: "retry-lesson-answer" })).rejects.toThrow("Delivery refused");
    const request = runtime.delivery.find("retry-lesson-answer").payload.request;
    const saved = { ...request, data: { ...request.data, trainingQuestion: { ...request.data.trainingQuestion } } };
    const next = lessonQuestion("question-two");
    f.snapshot(runtime.identity, { trainingQuestion: next });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(next));
    await runtime.send({ message: "Replacement must not win" }, { messageId: "retry-lesson-answer" });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.request.mock.calls[1][1].body).toEqual({ ...saved, messageId: "retry-lesson-answer" });
    expect(saved.data.trainingQuestion).toEqual(first);
  });

  it("does not add lesson context to Working or adopt another attempt's snapshot", async () => {
    const f = fixture(); const runtime = f.runtime.value;
    f.snapshot(runtime.identity, { trainingQuestion: lessonQuestion() });
    await vi.waitFor(() => expect(runtime.trainingQuestion.value).toBe(null));
    await runtime.send({ message: "Ordinary work", trainingQuestion: lessonQuestion() }, { messageId: "working-no-lesson" });
    expect(mocks.request.mock.calls[0][1].body.data).not.toHaveProperty("trainingQuestion");
    const learning = lessonFixture(); const target = learning.runtime.value;
    learning.snapshot(target.identity, { trainingQuestion: lessonQuestion() });
    await vi.waitFor(() => expect(target.trainingQuestion.value).toEqual(lessonQuestion()));
    learning.snapshot(target.identity, { trainingQuestion: { ...lessonQuestion(), attemptId: learningAttemptB } });
    await vi.waitFor(() => expect(target.trainingQuestion.value).toBe(null));
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});

// Deferred first hydration uses the original reader, mounted product host,
// controller, session and transport. Only their browser/service endpoints are controlled.
async function mountedOriginalMainVoice() {
  const { default: VoiceHost } = await import("../../packages/vibe64-voice/src/client/Vibe64VoiceHost.vue");
  const { useVibe64Voice, VIBE64_VOICE_KEY } = await import("../../packages/vibe64-voice/src/client/voiceHost.js");
  const { QueryClient, VueQueryPlugin } = await import("@tanstack/vue-query");
  let voice;
  const Probe = { setup() { voice = useVibe64Voice(); return () => h("div"); } };
  // The test pipeline compiles SFCs for SSR; retain the actual Host setup and
  // lifecycle while rendering only its supplied probe slot in this renderer.
  const MountedVoiceHost = { ...VoiceHost, render() { return h("div", this.$slots.default?.()); } };
  const host = renderer.createApp({ render: () => h(MountedVoiceHost, {
    preferences: { actorKey: "owner", coding: { readAloud: true, vocalizeThinking: true, vocalizeInterimTurns: true } }
  }, { default: () => h(Probe) }) });
  host.provide(ssrContextKey, { modules: new Set() });
  host.mount({});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const controlled = { heldId: "", httpReads: 0, socketAcknowledgements: 0, response: null,
    gate: Promise.withResolvers() };
  let readState;
  function beforeMount(app, { socket, read }) {
    readState = read;
    app.use(VueQueryPlugin, { queryClient });
    app.provide(VIBE64_VOICE_KEY, voice);
    const originalEmit = socket.emit.bind(socket);
    socket.emit = (name, input, acknowledge) => {
      if (name === "assistant.conversation.subscribe" && input.conversationId === controlled.heldId) {
        controlled.socketAcknowledgements += 1;
        // Original socket owns its epoch/subscription/reducer; only ACK timing changes.
        void controlled.gate.promise.then(response => {
          expect(response).toBe(read(input.conversationId));
          originalEmit(name, input, acknowledge);
        });
        return;
      }
      return originalEmit(name, input, acknowledge);
    };
    mocks.read.mockImplementation(url => {
      if (url.endsWith("/goal")) return null;
      if (url.includes("/training/presentation")) return { ok: true, navigation: null, cue: null };
      const id = decodeURIComponent(url.split("/conversations/")[1]);
      if (id !== controlled.heldId) return read(id);
      controlled.httpReads += 1;
      return controlled.gate.promise;
    });
  }
  function hold(identity) {
    controlled.heldId = mainConversationId(identity);
    controlled.response = readState(controlled.heldId);
    const user = { role: "user", messageId: "historic-question", text: "Earlier accepted request", receipt: true };
    const assistant = { role: "assistant", messageId: "historic-answer", outputId: "historic-output",
      text: "This is an earlier completed answer and must not be narrated again.", status: "completed" };
    // Saved SERVER response, not a seeded Runtime/voice snapshot. Both channels await it.
    controlled.response.conversationLog.push({ turnId: "historic-turn", messages: [user, assistant],
      user, assistant, metadata: { runtime: { status: "complete", origin: "user" } } });
  }
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    controlled.gate.resolve(controlled.response);
    await voice.controller.dispose();
    host.unmount();
    queryClient.clear();
  }
  return { voice, controlled, beforeMount, hold,
    release: () => controlled.gate.resolve(controlled.response), close };
}

function controlledVoiceBrowserEndpoints() {
  const sockets = [];
  const frames = [];
  const audioContexts = [];
  const microphone = vi.fn(async () => { throw new Error("This target-order test never opens a microphone."); });
  class Socket {
    constructor(url) {
      this.url = url; this.readyState = 1; this.listeners = new Map(); sockets.push(this);
      queueMicrotask(() => this.fire("message", { data: JSON.stringify({ type: "voice.ready", voices: [] }) }));
    }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(listener);
    }
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
    fire(name, event) { for (const listener of [...this.listeners.get(name) || []]) listener(event); }
    send(value) { frames.push({ url: this.url, body: JSON.parse(value) }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.fire("close", {}); }
  }
  class AudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; audioContexts.push(this); }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    createAnalyser() { return { connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("window", { AudioContext, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("location", { href: "http://localhost/app" });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: microphone } });
  return { sockets, frames, audioContexts, microphone,
    speech: () => frames.filter(frame => frame.body.type === "speak.start"),
    restore: () => vi.unstubAllGlobals() };
}

const hydrationAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function selectHydrationSession(f, sessionId) { f.selected.sessionId = sessionId; }
function hydrationRuntime(f, sessionId) {
  expect(f.runtime.value.identity.sessionId).toBe(sessionId);
  return f.runtime.value;
}

describe("actual Main VoiceHost awaits the captured reader's first hydration", () => {
  it("retains the original capture target and lease until hydration, primes history silently once, then speaks only the next canonical output", async () => {
    const endpoints = controlledVoiceBrowserEndpoints();
    const mounted = await mountedOriginalMainVoice();
    try {
      const f = fixture({ projectSlug: "", learningAttemptId: hydrationAttempt, learnerId: "42",
        sessionId: "old-target", sessionsApiPath: `/api/learning/${hydrationAttempt}/vibe64/sessions`,
        beforeMount: mounted.beforeMount });
      const original = f.runtime.value;
      const oldBinding = createProjectVoiceBinding(original, { presentation: "inline" });
      const oldRelease = vi.spyOn(oldBinding, "release");
      expect(await mounted.voice.open(oldBinding)).toBe(true);
      const oldSession = mounted.voice.controller.state.session;
      const oldCapture = oldBinding.captureContext();
      mounted.hold({ ...original.identity, sessionId: "hydrating-target" });
      selectHydrationSession(f, "hydrating-target"); await nextTick();
      const target = hydrationRuntime(f, "hydrating-target");
      const binding = createProjectVoiceBinding(target, { presentation: "inline" });
      const retained = vi.spyOn(binding, "retain");
      expect(typeof target.prepareVoice).toBe("function");
      expect(target.conversationLog.turns).toEqual([]);
      const opening = mounted.voice.open(binding);
      await vi.waitFor(() => expect(mounted.controlled.httpReads).toBeGreaterThan(0));
      expect(mounted.controlled.socketAcknowledgements).toBeGreaterThan(0);
      expect(mounted.voice.controller.state.binding.id).toBe(oldBinding.id);
      expect(mounted.voice.controller.state.binding.captureContext()).toEqual(oldCapture);
      expect(mounted.voice.controller.state.session).toBe(oldSession);
      expect(oldRelease).not.toHaveBeenCalled();
      expect(retained).not.toHaveBeenCalled();
      expect(binding.available).toBe(true); // No availability=false hydration shortcut.
      expect(endpoints.microphone).not.toHaveBeenCalled();
      expect(endpoints.speech()).toEqual([]);
      mounted.release();
      expect(await opening).toBe(true);
      expect(oldRelease).toHaveBeenCalledTimes(1);
      expect(retained).toHaveBeenCalledTimes(1);
      expect(mounted.voice.controller.state.session).not.toBe(oldSession);
      expect(mounted.voice.controller.state.binding.captureContext().sessionId).toBe("hydrating-target");
      await vi.waitFor(() => expect(target.conversationLog.turns).toHaveLength(1));
      expect(mounted.voice.controller.state.session.voiceAnswer.value).toBe(mounted.controlled.response.conversationLog[0].assistant.text);
      await nextTick();
      expect(endpoints.speech()).toEqual([]);
      f.socket.notify({ type: "phase" }, binding.conversationId); await nextTick();
      expect(await mounted.voice.open(binding)).toBe(true);
      expect(retained).toHaveBeenCalledTimes(1);
      expect(endpoints.speech()).toEqual([]);
      const words = "This new canonical answer may now be sent to the speech service.";
      f.receipt(target.identity, { user: { role: "user", messageId: "fresh-question", text: "Next question", receipt: true },
        assistant: { role: "assistant", messageId: "fresh-answer", outputId: "fresh-output", text: words, status: "completed" },
        metadata: { runtime: { status: "complete", origin: "user" } } });
      await vi.waitFor(() => expect(endpoints.speech()).toHaveLength(1));
      expect(endpoints.speech()[0].body).toMatchObject({ type: "speak.start", text: words, stream: true });
      expect(endpoints.speech()[0].url).toContain("/hydrating-target/voice/ws");
      f.socket.notify({ type: "phase" }, binding.conversationId); await nextTick();
      expect(endpoints.speech()).toHaveLength(1);
      expect(endpoints.speech().some(frame => frame.body.text.includes("earlier completed answer"))).toBe(false);
      expect(endpoints.microphone).not.toHaveBeenCalled();
      expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("/messages"))).toEqual([]);
    } finally { await mounted.close(); endpoints.restore(); }
  });

  it("supersedes a held prepare without creating a target session or releasing the existing capture lease", async () => {
    const endpoints = controlledVoiceBrowserEndpoints(); const mounted = await mountedOriginalMainVoice();
    try {
      const f = fixture({ projectSlug: "", learningAttemptId: hydrationAttempt, learnerId: "42", sessionId: "retained-target",
        sessionsApiPath: `/api/learning/${hydrationAttempt}/vibe64/sessions`, beforeMount: mounted.beforeMount });
      const original = f.runtime.value; const oldBinding = createProjectVoiceBinding(original, { presentation: "inline" });
      const oldRelease = vi.spyOn(oldBinding, "release");
      expect(await mounted.voice.open(oldBinding)).toBe(true);
      const oldSession = mounted.voice.controller.state.session;
      mounted.hold({ ...original.identity, sessionId: "superseded-target" });
      selectHydrationSession(f, "superseded-target"); await nextTick();
      const binding = createProjectVoiceBinding(hydrationRuntime(f, "superseded-target"), { presentation: "inline" });
      const retained = vi.spyOn(binding, "retain"); const opening = mounted.voice.open(binding);
      await vi.waitFor(() => expect(mounted.controlled.httpReads).toBeGreaterThan(0));
      const staying = mounted.voice.open(oldBinding); // Actual controller revision supersedes pending activation.
      expect(mounted.voice.controller.state.session).toBe(oldSession);
      expect(oldRelease).not.toHaveBeenCalled();
      mounted.release(); expect(await opening).toBe(false); expect(await staying).toBe(true);
      expect(mounted.voice.controller.state.session).toBe(oldSession);
      expect(mounted.voice.controller.state.binding.id).toBe(oldBinding.id);
      expect(mounted.voice.controller.state.binding.captureContext().sessionId).toBe("retained-target");
      expect(retained).not.toHaveBeenCalled(); expect(oldRelease).not.toHaveBeenCalled();
      expect(endpoints.sockets).toEqual([]); expect(endpoints.audioContexts).toEqual([]);
      expect(endpoints.microphone).not.toHaveBeenCalled();
      expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("/messages"))).toEqual([]);
    } finally { await mounted.close(); endpoints.restore(); }
  });

  it("refuses a held first hydration after the actual viewer changes without creating the new voice lease", async () => {
    const endpoints = controlledVoiceBrowserEndpoints(); const mounted = await mountedOriginalMainVoice();
    try {
      const f = fixture({ projectSlug: "", learningAttemptId: hydrationAttempt, learnerId: "42", sessionId: "old-owner-target",
        sessionsApiPath: `/api/learning/${hydrationAttempt}/vibe64/sessions`, beforeMount: mounted.beforeMount });
      const original = f.runtime.value; const oldBinding = createProjectVoiceBinding(original, { presentation: "inline" });
      expect(await mounted.voice.open(oldBinding)).toBe(true);
      mounted.hold({ ...original.identity, sessionId: "revoked-target" });
      selectHydrationSession(f, "revoked-target"); await nextTick();
      const target = hydrationRuntime(f, "revoked-target");
      const binding = createProjectVoiceBinding(target, { presentation: "inline" }); const retained = vi.spyOn(binding, "retain");
      const result = mounted.voice.open(binding).then(value => ({ value }), error => ({ error }));
      await vi.waitFor(() => expect(mounted.controlled.httpReads).toBeGreaterThan(0));
      f.viewer.value = { actorKey: "another-person" }; await nextTick();
      mounted.release();
      const outcome = await result;
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toMatch(/load|available|voice/i);
      expect(target.available.value).toBe(false);
      expect(retained).not.toHaveBeenCalled();
      expect(mounted.voice.controller.state.binding?.id).not.toBe(binding.id);
      expect(endpoints.sockets).toEqual([]); expect(endpoints.audioContexts).toEqual([]);
      expect(endpoints.microphone).not.toHaveBeenCalled();
      expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("/messages"))).toEqual([]);
    } finally { await mounted.close(); endpoints.restore(); }
  });
});


it("actual retained Main snapshot/client feeds the same original three-control collector and exact saved Learning API", async () => {
  const attempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const channel = ref(null), layout = ref(null), view = ref(null);
  const body = ref({ actorKey: "owner", conversationId: "real-general", visible: false, compact: false });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } }); releases.push(() => query.clear());
  const f = fixture({ learningAttemptId: attempt, learnerId: "own", noExercise: false, sourceProjectSlug: "practice",
    projectSlug: "", sessionId: "saved-initial", sessionsApiPath: `/api/learning/${attempt}/vibe64/sessions`,
    beforeMount(app) { app.use(VueQueryPlugin, { queryClient: query });
      for (const [key, value] of [[VIBE64_TRAINING_LEARNER_GESTURE_KEY, channel], [VIBE64_COLLEAGUE_BODY_KEY, body],
        [VIBE64_COLLEAGUE_VIEW_KEY, view], [VIBE64_COLLEAGUE_LAYOUT_KEY, layout]]) app.provide(key, value); } });
  await vi.waitFor(() => expect(f.runtime.value).toBeTruthy());
  const runtime = f.runtime.value, identity = runtime.identity;
  view.value = { learningBinding: identity, sessionId: "saved-initial", ready: true, conversationId: "",
    temporarySelected: false, hostConversationSelected: false, pane: "preview" };
  layout.value = { projectSlug: "practice", learningAttemptId: attempt, learnerId: "own", ready: true,
    chatVisible: true, projectVisible: true };
  expect(channel.value.begin({ type: "click", isTrusted: true }, "project-select")).toBeNull();
  const question = { attemptId: attempt, questionId: "delivered-practical", assessmentId: "workspace-navigation",
    issuedRevision: 3, topicHash: "a".repeat(64), lessonHash: "b".repeat(64) };
  f.snapshot(identity, { trainingQuestion: question });
  await vi.waitFor(() => expect(runtime.trainingQuestion.value).toEqual(question));
  expect(channel.value.matchesLearning(identity)).toBe(true);
  expect(channel.value.begin({ type: "click", isTrusted: false }, "project-select")).toBeNull();
  for (const control of ["project-select", "chat-show", "preview-select"]) {
    const ticket = channel.value.begin({ type: "click", isTrusted: true }, control,
      { projectSlug: "practice", sessionId: "saved-initial" });
    expect(ticket).toBeTruthy(); await channel.value.finish(ticket);
  }
  const observations = mocks.request.mock.calls.filter(([url]) => url.endsWith("/training/observations"));
  expect(observations).toHaveLength(3);
  for (const [url, options] of observations) {
    expect(url).toBe(`/api/learning/${attempt}/vibe64/sessions/saved-initial/training/observations`);
    expect(options.method).toBe("POST"); expect(options.body.conversationId).toBeUndefined();
    expect(options.body.clientId).toBe(runtime.presentation.clientId);
    expect(options.body.reference).toEqual(question);
    expect(options.body.workspace).toEqual({ projectSlug: "practice", sessionId: "saved-initial", mainChatVisible: true,
      projectVisible: true, pane: "preview", ready: true, colleagueVisible: false });
  }
  expect(observations.map(([, options]) => options.body.control)).toEqual(["project-select", "chat-show", "preview-select"]);
  view.value.ready = false;
  const held = channel.value.begin({ type: "click", isTrusted: true }, "preview-select");
  const pending = channel.value.finish(held);
  f.viewer.value = { actorKey: "another" };
  expect(await pending).toBe(false);
  expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("/training/observations"))).toHaveLength(3);
});
