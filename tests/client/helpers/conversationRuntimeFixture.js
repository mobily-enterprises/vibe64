import { createRenderer, h, markRaw, onScopeDispose, reactive, toValue, watch } from "vue";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { useVibe64AgentSettings } from "../../../src/composables/useVibe64AgentSettings.js";
const { createWebPlacementRuntime } = await import(new URL("./runtime.js",
  import.meta.resolve("@jskit-ai/shell-web/client/placement")).href);

const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {}, parentNode() {}, nextSibling() {} });

// A controlled multi-listener socket around the real supplied subscriber. It
// acknowledges the canonical state and forwards events; it owns no reducer.
export function createConversationFixtureSocket(read) {
  const listeners = new Map();
  const subscriptions = new Map();
  const fire = (name, payload) => { for (const listener of [...listeners.get(name) || []]) listener(payload); };
  const socket = {
    connected: true,
    publish: fire,
    on(name, listener) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(listener); },
    off(name, listener) { listeners.get(name)?.delete(listener); },
    timeout() { return socket; },
    emit(name, input, acknowledge) {
      if (name === "assistant.conversation.unsubscribe") { subscriptions.delete(input.subscriptionId); return; }
      if (name !== "assistant.conversation.subscribe") throw new Error(`Unexpected socket command ${name}`);
      const subscription = { ...input, epoch: crypto.randomUUID(), revision: 0 };
      subscriptions.set(input.subscriptionId, subscription);
      acknowledge(null, { ok: true, streamEpoch: subscription.epoch, state: read(input.conversationId) });
    },
    notify(event = { type: "phase" }, conversationId = "") {
      for (const subscription of subscriptions.values()) {
        if (conversationId && subscription.conversationId !== conversationId) continue;
        fire("assistant.conversation.event", {
        subscriptionId: subscription.subscriptionId, conversationId: subscription.conversationId,
        streamEpoch: subscription.epoch, streamRevision: ++subscription.revision, event
        });
      }
    },
    reconnect() { socket.connected = false; subscriptions.clear(); fire("disconnect"); socket.connected = true; fire("connect"); }
  };
  return socket;
}

export function provideConversationFixture(app, socket, actor = "local") {
  globalThis.__JSKIT_CLIENT_APP_CONFIG__ = {
    surfaceDefinitions: { app: { requiresWorkspace: false } },
    assistantSurfaces: { app: { settingsSurfaceId: "app", configScope: "global" } }
  };
  const placement = createWebPlacementRuntime({ components: new Map() });
  placement.setContext({ user: { id: actor }, surfaceConfig: {
    defaultSurfaceId: "app", surfacesById: { app: { id: "app", routeBase: "/app", requiresWorkspace: false } }
  } });
  app.provide("jskit.shell-web.runtime.web-placement.client", placement);
  app.provide("jskit.realtime.runtime.client.socket", socket);
  return placement;
}

// The original composer fixture still supplies product session state and
// service outcomes. Drafts, queued requests, receipts and retention now run
// through the actual useAssistantConversation binding, without mocking it.
export function attachConversationRuntime(props, viewer = { actorKey: "local" }, { steering = true, deferWhileWorking = false } = {}) {
  const transcript = reactive([]);
  const state = id => ({ id, segmentId: "fixture-thread", status: props.session?.agentSession?.turn?.active ? "working" : "ready",
    capabilities: { steering: toValue(steering), attachments: true }, conversationLog: transcript });
  const socket = createConversationFixtureSocket(state);
  const api = {
    readConversation: id => state(id),
    async sendConversationMessage(_id, input) {
      try { return await props.sendAgentMessage({ ...input.data, messageId: input.messageId }); }
      catch (failure) {
        // The original fake represents the product service result, which the
        // old private HTTP wrapper threw. The real facade preserves its envelope.
        return { ok: false, error: failure.message, ...(failure.code ? { code: failure.code } : {}) };
      }
    }
  };
  const app = renderer.createApp({ setup() {
    const binding = useAssistantConversation({
      conversationId: () => props.session?.sessionId || "", actorKey: () => toValue(viewer)?.actorKey || "",
      surfaceId: "app", hostSurfaceId: "app", workspaceSlug: "", api, socket, deferWhileWorking,
      draftStorage: () => {
        try {
          const storage = typeof window !== "undefined" ? window.sessionStorage : null;
          return storage ? { storage, key: `vibe64:chat-composer:v1:${JSON.stringify([
            toValue(viewer)?.actorKey || "", "chat-test", props.session?.sessionId || ""
          ])}` } : null;
        } catch { return null; }
      },
      application(runtime) {
        function prepare(payload, options = {}) {
          const original = runtime.delivery.find(options.messageId)?.payload || payload;
          if (original.request) return original;
          const submissionKind = options.submissionKind || "send";
          const data = { ...original, submissionKind };
          return { ...original, submissionKind, data, request: { text: original.message, data,
            ...(original.attachmentIds?.length ? { attachmentIds: original.attachmentIds } : {}),
            ...(submissionKind === "steer" ? { steer: true } : {}) } };
        }
        async function submit(method, payload, options) {
          const result = await runtime[method](prepare(payload, options), options);
          if (result?.ok === false) throw Object.assign(new Error(result.error), result);
          return result;
        }
        return { ...runtime, agentSettings: useVibe64AgentSettings(),
          send: (payload, options) => submit("send", payload, options),
          submitDraft: (payload, options) => submit("submitDraft", payload, options) };
      }
    });
    watch(() => binding.runtime.value?.application, value => { props.conversationRuntime = value ? markRaw(value) : null; }, { immediate: true, flush: "sync" });
    return () => h("div");
  } });
  provideConversationFixture(app, socket, toValue(viewer)?.actorKey || "local");
  watch(() => props.conversationLog.turns, turns => {
    const rows = turns.map((turn, index) => ({ turnId: String(index + 1), ...turn }));
    transcript.splice(0, transcript.length, ...rows);
    for (const turn of rows) socket.notify({ type: "transcript", patch: { type: "upsert-turn", turn } }, props.session.sessionId);
  }, { immediate: true, flush: "sync" });
  watch(() => props.session?.agentSession?.turn, () => socket.notify(), { deep: true, flush: "sync" });
  app.runWithContext(() => app.mount({}));
  onScopeDispose(() => app.unmount());
  return props;
}
