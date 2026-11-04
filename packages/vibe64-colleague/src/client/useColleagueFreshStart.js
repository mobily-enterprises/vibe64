import { computed, ref, shallowRef } from "vue";

/**
 * Start fresh: archives Colleague's current conversation through one operator
 * request and follows the server to the new one. Only the pending request is
 * retained here; durable idempotency and archived delivery evidence belong to
 * the original server owner. A lost answer is retried by the same operation.
 * @param {object} options
 * @param {{ runtime: import("vue").Ref<object | null> }} options.conversation
 * @param {import("@local/vibe64-voice/client").Vibe64Voice} options.voice
 * @param {import("vue").ComputedRef<object | null>} options.voiceSession
 * @param {import("vue").Ref<object | null>} options.voiceTranscript
 * @param {import("vue").ComputedRef<string>} options.actorKey
 * @param {import("vue").Ref<object>} options.product
 * @param {import("vue").Ref<string>} options.productError
 * @param {import("vue").Ref<string>} options.pointerNotice
 * @param {import("vue").Ref<boolean>} options.open
 * @param {import("vue").ComputedRef<boolean>} options.working
 * @param {import("vue").ComputedRef<boolean>} options.sending
 * @param {() => boolean} options.isMounted
 * @param {() => number} options.nextRevision
 * @param {(suffix: string, options: object) => Promise<object>} options.requestColleague
 * @param {(result: object, expectedRevision: number, expectedActor: string, allowRetarget: boolean) => boolean} options.apply
 * @param {() => Promise<unknown>} options.openVoice
 * @param {() => void} options.closeHistory
 * @param {(error: unknown) => void} options.reportFailure
 */
function useColleagueFreshStart({
  conversation, voice, voiceSession, voiceTranscript, actorKey, product, productError, pointerNotice, open, working, sending,
  isMounted, nextRevision, requestColleague, apply, openVoice, closeHistory, reportFailure
}) {
  const freshConfirm = ref(false);
  const freshBusy = ref(false);
  const freshError = ref("");
  const freshOperation = shallowRef(null);
  const freshBlocked = computed(() => {
    if (pointerNotice.value) return "Colleague already changed in another tab. Resolve the old speech, then choose Refresh conversation instead of starting another fresh request.";
    const runtime = conversation.runtime.value;
    if (!runtime?.current.value || working.value || sending.value || runtime.stopping.value) {
      return "Wait for the current request or Stop to finish before starting fresh.";
    }
    if (voice.controller.state.busy || voice.controller.state.nextTarget) return "Finish the pending voice switch before starting fresh.";
    const session = voiceSession.value;
    if (!session) return "";
    if (session.starting?.value || session.capturing?.value || session.sending.value) {
      return "Pause the microphone, then discard newer unsent speech with its X before starting fresh. You can also explicitly stop voice chat.";
    }
    const pending = session.pendingTranscript.value;
    if (pending && runtime.delivery.find(pending.messageId)?.status !== "uncertain") {
      return "Send or discard the reviewed speech before starting fresh.";
    }
    return "";
  });
  function showFreshConfirmation() {
    closeHistory();
    freshError.value = "";
    freshConfirm.value = true;
  }
  function closeFreshConfirmation() {
    if (!freshBusy.value) freshConfirm.value = false;
  }
  function freshScopeCurrent(operation) {
    return isMounted() && actorKey.value === operation.actor && conversation.runtime.value === operation.runtime &&
      product.value.conversationId === operation.body.expectedConversationId;
  }
  async function startFresh() {
    if (freshBusy.value) return false;
    if (freshBlocked.value) { freshError.value = freshBlocked.value; return false; }
    let operation = freshOperation.value;
    if (!operation) {
      const runtime = conversation.runtime.value;
      const unconfirmedMessages = runtime.delivery.state.messages.filter(message => message.status === "uncertain").map(message => {
        const request = message.payload?.request;
        const data = request?.data || message.payload?.data;
        return { messageId: message.id, text: request?.text ?? message.payload?.message,
          clientId: data?.clientId, ...(data?.focus ? { focus: { ...data.focus } } : {}) };
      });
      if (unconfirmedMessages.length > 8 || unconfirmedMessages.some(message =>
        typeof message.text !== "string" || !message.text.trim() || message.text.length > 24000 || !message.clientId)) {
        freshError.value = "The original uncertain delivery evidence is incomplete or too large. Check delivery before starting fresh.";
        return false;
      }
      operation = { actor: actorKey.value, runtime, session: voiceSession.value,
        binding: voiceSession.value ? voice.controller.state.binding : null,
        body: { operationId: crypto.randomUUID(), expectedConversationId: product.value.conversationId, unconfirmedMessages } };
      // Invalidate a product read that began before this operation. Its late
      // pointer cannot retire the original binding while archive is unresolved.
      nextRevision();
      freshOperation.value = operation;
    }
    if (!freshScopeCurrent(operation)) return false;
    freshBusy.value = true;
    freshError.value = "";
    try {
      const result = await requestColleague("/conversations/fresh", { method: "POST", body: operation.body });
      if (!freshScopeCurrent(operation)) return false;
      if (result.fresh?.operationId !== operation.body.operationId ||
        result.fresh.previousConversationId !== operation.body.expectedConversationId ||
        !result.fresh.conversationId || !result.conversationId) throw new Error("The fresh conversation receipt did not match this request. Retry the same operation.");
      // Archive success alone cannot discard speech captured while HTTP was held,
      // or end a different assistant that the person opened in the meantime.
      if (freshBlocked.value || operation.session && voice.controller.state.session && (voice.controller.state.session !== operation.session ||
        voice.controller.state.binding !== operation.binding)) {
        throw new Error(freshBlocked.value || "The voice conversation changed. Return to the original conversation before retrying this fresh operation.");
      }
      if (operation.session && voice.controller.state.session === operation.session) await voice.controller.end({ discard: true });
      if (!freshScopeCurrent(operation)) return false;
      if (operation.session && (voice.controller.state.session || voice.controller.state.busy || voice.controller.state.nextTarget)) {
        throw new Error("Another voice conversation opened during retirement. Resolve it before retrying this fresh operation.");
      }
      // The original apply owner preserves the latest same-actor draft while
      // following the CURRENT server pointer, never a historic receipt successor.
      apply(result, nextRevision(), operation.actor, true);
      if (isMounted() && actorKey.value === operation.actor && product.value.conversationId === result.conversationId) {
        freshBusy.value = false;
        freshOperation.value = null;
        freshConfirm.value = false;
        productError.value = "";
        open.value = true;
        voiceTranscript.value = null;
        const controller = voice.controller;
        if (!controller.state.session && !controller.state.binding && !controller.state.busy && !controller.state.nextTarget) {
          // Restore the original controls with a paused binding. Archive success
          // is already committed; presentation failure must not repeat it.
          try { await openVoice(); }
          catch (error) {
            if (isMounted() && actorKey.value === operation.actor && product.value.conversationId === result.conversationId) {
              reportFailure(new Error(`The fresh conversation is ready, but its voice controls could not open. Reopen Colleague to try again. ${error.message}`));
            }
          }
          if (!isMounted() || actorKey.value !== operation.actor || product.value.conversationId !== result.conversationId) return false;
          open.value = true;
        }
        return true;
      }
      return false;
    } catch (error) {
      if (freshScopeCurrent(operation)) freshError.value = `${error.message} Nothing was resent. Retry this same fresh operation to check its result.`;
      return false;
    } finally {
      if (freshOperation.value === operation) freshBusy.value = false;
    }
  }
  return { freshConfirm, freshBusy, freshError, freshOperation, freshBlocked, showFreshConfirmation, closeFreshConfirmation, startFresh };
}

export { useColleagueFreshStart };
