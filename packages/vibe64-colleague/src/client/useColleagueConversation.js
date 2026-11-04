import { computed, watch } from "vue";
import { projectConversationVoiceState } from "@jskit-ai/assistant-voice/client";
import { createAssistantApi } from "@jskit-ai/assistant-core/client";
import { useAssistantConversation } from "@jskit-ai/assistant-runtime/client";
import { COLLEAGUE_VOICE_SOCKET_URL } from "@local/vibe64-voice/shared/routes";
import { useColleagueVoicePreviews } from "./useColleagueVoicePreviews.js";

/**
 * Whether the voice controller's binding is Colleague's own voice chat.
 * @param {{ socketUrl?: string } | null} binding
 */
function isColleagueBinding(binding) {
  return binding?.socketUrl === COLLEAGUE_VOICE_SOCKET_URL;
}

/**
 * Colleague's conversation: the product read that names its thread and model,
 * the shared conversation runtime it presents, its voice chat binding, and the
 * sends, stops and model switches. A late answer for another person or after
 * a newer read is dropped.
 * @param {object} options
 * @param {(url: string, options: object) => Promise<any>} options.request the host's HTTP request
 * @param {(suffix?: string, options?: object) => Promise<any>} options.requestColleague
 * @param {string} options.clientId this browser view's Colleague client
 * @param {import("vue").ComputedRef<string>} options.actorKey
 * @param {import("@jskit-ai/realtime/client/types").RealtimeSocket} options.socket
 * @param {import("@local/vibe64-voice/client").Vibe64Voice} options.voice
 * @param {import("vue").Ref<boolean>} options.open
 * @param {import("vue").Ref<object | null>} options.voiceTranscript
 * @param {import("vue").Ref<HTMLElement | null>} options.voicePanelTarget
 * @param {import("vue").Ref<object>} options.product
 * @param {import("vue").Ref<string>} options.productError
 * @param {import("vue").Ref<string>} options.pointerNotice
 * @param {(navigation: object | undefined) => Promise<void>} options.handleNavigation
 * @param {() => string} options.readName
 * @param {() => object} options.readFocus
 * @param {() => object | null} options.readFreshOperation the fresh start still in progress
 * @param {() => boolean} options.readFreshBusy
 * @param {(messageId: string) => void} options.onMessageSubmit
 * @param {(visual: object) => void} options.onVoiceVisual
 * @param {() => boolean} options.isMounted
 * @param {(error: unknown) => void} options.reportFailure
 */
function useColleagueConversation({
  request, requestColleague, clientId, actorKey, socket, voice, open, voiceTranscript, voicePanelTarget,
  product, productError, pointerNotice, handleNavigation, readName, readFocus, readFreshOperation, readFreshBusy,
  onMessageSubmit, onVoiceVisual, isMounted, reportFailure
}) {
  let revision = 0;
  const nextRevision = () => ++revision;

  function apply(result, expectedRevision, expectedActor, allowRetarget = false) {
    if (!isMounted() || expectedRevision !== revision || expectedActor !== actorKey.value) return false;
    const runtime = conversation.runtime.value;
    const changingConversation = Boolean(product.value.conversationId && result.conversationId &&
      product.value.conversationId !== result.conversationId);
    // Switching between Develop and a Learn thread (L, or another lesson) is
    // the person's own choice, never another tab's change: each thread keeps
    // its own draft and nothing needs resolving.
    const changingThread = Boolean(product.value.thread && result.thread &&
      (product.value.thread.kind !== result.thread.kind || product.value.thread.attemptId !== result.thread.attemptId));
    if (changingConversation && !changingThread && runtime?.current.value && runtime.identity.actorKey === expectedActor) {
      if (voiceSession.value?.hasUnsentSpeech.value || pointerNotice.value && !allowRetarget) {
        pointerNotice.value = "Colleague changed in another tab. Resolve the old speech first: pause the microphone and discard newer words, or explicitly Stop voice chat. Then choose Refresh conversation. Your typed draft stays unsent.";
        return false;
      }
    }
    // The original runtime owns drafts. Preserve the same person's CURRENT draft
    // before its binding changes; actor changes never enter this copy path.
    const savedDraft = changingConversation && !changingThread && runtime?.current.value && runtime.identity.actorKey === expectedActor
      ? runtime.draft.value : null;
    const { conversationId, thread, assistantSelection, watches, assignments, navigation, operation, operations, modelSetupRequired, error } = result;
    product.value = { conversationId, thread, assistantSelection, watches, assignments, navigation, operation, operations, modelSetupRequired, error };
    if (savedDraft !== null && actorKey.value === expectedActor) conversation.adapter.value.actions.setDraft(savedDraft);
    pointerNotice.value = "";
    void handleNavigation(navigation);
    return true;
  }
  const api = createAssistantApi({
    request,
    resolveBasePath: () => "/api/assistant/app", resolveSurfaceId: () => "app"
  });
  const nativeApplicationAdmission = snapshot => ["codex", "claude", "opencode"].includes(snapshot?.engine);
  const conversation = useAssistantConversation({
    conversationId: () => product.value.conversationId,
    actorKey, surfaceId: "app", hostSurfaceId: "app", workspaceSlug: "",
    socket,
    api: { ...api, sendConversationMessage(id, input) {
      onMessageSubmit(input.messageId);
      const activeVoice = voice.controller.state;
      if (isColleagueBinding(activeVoice?.binding)) activeVoice.session.inviteSpeech(input.messageId);
      return api.sendConversationMessage(id, input);
    } },
    clearDraftOn: "accepted", queueWhileSending: true,
    admitWhileWorking: nativeApplicationAdmission, deferWhileWorking: snapshot => !nativeApplicationAdmission(snapshot),
    draftWhileLoading: true,
    // The app selects tab-local scope; the original shared runtime owns the
    // opaque draft/delivery format, restoration and write lifecycle.
    draftStorage: () => {
      try {
        const storage = typeof window !== "undefined" ? window.sessionStorage : null;
        return storage && actorKey.value && product.value.conversationId ? { storage,
          key: `vibe64:colleague-composer:v1:${JSON.stringify([actorKey.value, product.value.conversationId])}` } : null;
      } catch { return null; }
    },
    data: () => ({ clientId, focus: { ...readFocus() } }),
    onEvent(event) {
      if (event.type === "application") {
        void conversation.runtime.value?.reload();
        void refresh();
      }
    },
    presentation: () => ({
      assistantLabel: readName(), systemLabel: "Vibe64", variant: "task", visible: open.value,
      userMessageFormat: "plain", progressPreviewLimit: 0,
      welcomeMessage: product.value.thread?.kind === "learn"
        ? "I'm your teacher here. Ask me about a lesson, or press Teach me on a step."
        : "Let's think it through. I can discuss an idea, check on your agents, or help you operate Vibe64.",
      previewMessage: voicePreview.value,
      ariaLabel: `Message ${readName()}`, placeholder: `Talk it through with ${readName()}…`, rows: 1, layout: "compact",
      submitAriaLabel: conversation.runtime.value?.steerable.value ? `Steer ${readName()}` : `Send to ${readName()}`,
      submitLabel: conversation.runtime.value?.steerable.value ? "Steer" : "Send"
    })
  });
  const working = computed(() => conversation.runtime.value?.snapshot.value?.status === "working");
  const voiceSession = computed(() => {
    const state = voice.controller.state;
    const identity = conversation.runtime.value?.identity;
    return isColleagueBinding(state?.binding) &&
      state.binding.conversationId === identity?.conversationId &&
      state.binding.id === JSON.stringify(["colleague", identity?.actorKey]) ? state.session : null;
  });
  // Colleague's voice controls belong to one conversation. After a thread switch
  // (L, another lesson) they still hold the previous thread's conversation.
  const staleVoice = computed(() => isColleagueBinding(voice.controller.state.binding) && !voiceSession.value);

  const { voicePreviews, voicePreview } = useColleagueVoicePreviews({ voiceTranscript, voiceSession, conversation, isMounted });
  const bodyVisible = computed(() => open.value || Boolean((voiceSession.value || staleVoice.value) && voice.controller.state.visible));

  const adapter = computed(() => {
    const supplied = conversation.adapter.value;
    return { ...supplied,
      conversation: { ...supplied.conversation, reloadable: false, retainWhenHidden: true, visible: bodyVisible.value, previewMessages: voicePreviews.value },
      composer: { ...supplied.composer, canSend: supplied.composer.canSend && !voiceSession.value?.composerBlocked.value && !readFreshOperation() && !readFreshBusy() }
    };
  });
  const draft = computed({ get: () => adapter.value.composer.draft, set: value => adapter.value.actions.setDraft(value) });
  const sending = computed(() => conversation.runtime.value?.delivery.state.sending === true);
  const connectionError = computed(() => productError.value || conversation.runtime.value?.error.value || "");
  // A native snapshot reports no error as an empty string; it must not hide a
  // failed Colleague turn such as an unverified application operation.
  const turnError = computed(() => conversation.runtime.value?.snapshot.value?.error || product.value.error);

  async function refresh(options = {}) {
    // A lost fresh response must be retried by its original operation, not
    // silently retargeted by a background product read.
    if (readFreshOperation()) return;
    const expectedRevision = ++revision;
    const expectedActor = actorKey.value;
    try {
      const result = await requestColleague(`?clientId=${encodeURIComponent(clientId)}`, { method: "GET" });
      apply(result, expectedRevision, expectedActor, options.allowRetarget === true);
      if (isMounted() && expectedRevision === revision && expectedActor === actorKey.value) productError.value = "";
    } catch (error) {
      if (isMounted() && expectedRevision === revision && expectedActor === actorKey.value) productError.value = error.message;
    }
  }
  async function sendMessage(message, options = {}, target = conversation.runtime.value) {
    if (!target?.available.value) return false;
    return target.send({ message, data: { clientId, focus: options.focus } }, { messageId: options.messageId });
  }
  /** Resolves with Colleague's available conversation; fails after timeoutMs or once Colleague leaves this view. */
  function waitForConversation(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let stop = null;
      const timer = setTimeout(() => finish(new Error(connectionError.value || "Colleague is not connected yet. Press Teach me again.")), timeoutMs);
      function finish(error, target) {
        clearTimeout(timer);
        if (stop) stop();
        else queueMicrotask(() => stop?.());
        if (error) reject(error);
        else resolve(target);
      }
      stop = watch(() => conversation.runtime.value?.available.value ? conversation.runtime.value : null, target => {
        if (!isMounted()) finish(new Error("Colleague left this browser view."));
        else if (target) finish(null, target);
      }, { immediate: true });
    });
  }
  async function openVoice() {
    if (readFreshOperation() || readFreshBusy()) return false;
    if (!conversation.runtime.value) await refresh();
    const target = conversation.runtime.value;
    if (!target) throw new Error(connectionError.value || "Colleague is not connected yet. Try again.");
    let retained;
    const binding = {
      preferenceTarget: "colleague",
      presentation: "inline",
      id: JSON.stringify(["colleague", target.identity.actorKey]),
      conversationId: target.identity.conversationId,
      get label() { return readName(); },
      get state() {
        return projectConversationVoiceState({ turns: target.turns.value, status: target.snapshot.value?.status, interimReply: target.snapshot.value?.interimReply });
      },
      get available() { return isMounted() && target.current.value; },
      get adapter() { return conversation.runtime.value === target ? adapter.value : null; },
      setConversationTarget(element) { voicePanelTarget.value = element; },
      retain() { retained = target.retain(); },
      release() { retained?.release(); retained = null; },
      socketUrl: COLLEAGUE_VOICE_SOCKET_URL,
      captureContext: () => ({ ...readFocus() }),
      submitText(text, { messageId, context }) {
        return sendMessage(text, { messageId, focus: context || {} }, target);
      },
      cancelWork: () => target.cancel(),
      onTranscript(value, { canTake = false } = {}) {
        if (isMounted() && conversation.runtime.value === target) voiceTranscript.value = value ? { ...value, canTake } : null;
      },
      onVisual(value) { onVoiceVisual(value); },
      onError: reportFailure
    };
    const opened = await voice.open(binding);
    if (!isMounted() || conversation.runtime.value !== target) return false;
    open.value = false;
    if (opened) return voice.controller.state.session;
    return false;
  }
  async function submit() {
    if (readFreshOperation() || readFreshBusy() || voiceSession.value?.composerBlocked.value) return;
    const target = conversation.runtime.value;
    // Without an AI the banner already says what to do; the draft stays put.
    if (product.value.modelSetupRequired) return;
    if (!target?.canSubmit.value) {
      if (draft.value.trim() && connectionError.value) reportFailure(connectionError.value);
      return;
    }
    const result = await adapter.value.actions.submit();
    if ((result === false || result?.ok === false) && target.current.value) {
      const failure = target.delivery.find(target.draftMessageId.value)?.error || target.error.value;
      // A missing AI shows once, as the banner, not again as a snackbar.
      await refresh();
      if (failure && !product.value.modelSetupRequired) reportFailure(failure);
    }
  }
  async function stop() {
    const target = conversation.runtime.value;
    if (await target?.cancel() === false && target.current.value && target.error.value) reportFailure(target.error.value);
  }
  // `selection` is { assistantSelection }. Only the model menu reports failures here.
  async function saveSelection(selection, { report = true } = {}) {
    if (readFreshOperation() || readFreshBusy()) return { ok: false, error: "Colleague is busy; try again in a moment." };
    const expectedRevision = ++revision;
    const expectedActor = actorKey.value;
    try {
      const result = await api.selectConversation(product.value.conversationId, selection);
      apply(result, expectedRevision, expectedActor);
      if (isMounted() && expectedActor === actorKey.value) {
        productError.value = "";
        conversation.runtime.value?.reload();
      }
      return result;
    } catch (error) {
      if (report && expectedActor === actorKey.value) reportFailure(error);
      return { ok: false, error: String(error?.message || error) };
    }
  }
  const selectModel = assistantSelection => saveSelection({ assistantSelection });

  return { conversation, working, voiceSession, staleVoice, voicePreview, bodyVisible, adapter, draft, sending, connectionError,
    turnError, nextRevision, apply, refresh, sendMessage, waitForConversation, openVoice, submit, stop, saveSelection, selectModel };
}

export { isColleagueBinding, useColleagueConversation };
