import { watch } from "vue";
import { latestAssistantMessageAwaitingUserReply } from "@jskit-ai/assistant-core/shared/conversation";
import { selectionLabels } from "./colleagueSelectionLabels.js";

/**
 * This Colleague's model as AI onboarding reads and switches it through the
 * model bridge: the current selection with its labels, a switch, a first
 * hello and showing the conversation. The bridge registers on mount, before
 * the first read names the conversation, so each call waits for that read.
 * @param {object} options
 * @param {import("vue").Ref<object>} options.product
 * @param {import("vue").Ref<string>} options.productError
 * @param {() => Promise<void>} options.refresh
 * @param {(suffix: string, options: object) => Promise<object>} options.requestColleague
 * @param {(selection: object, options: { report: boolean }) => Promise<object>} options.saveSelection
 * @param {() => Promise<object>} options.waitForConversation
 * @param {(message: string, options: object, target: object) => Promise<unknown>} options.sendMessage
 * @param {() => void} options.reopenConversation
 * @param {() => Promise<void>} options.focusConversationComposer
 * @param {() => object} options.readFocus
 */
function createColleagueModel({
  product, productError, refresh, requestColleague, saveSelection, waitForConversation, sendMessage,
  reopenConversation, focusConversationComposer, readFocus
}) {
  async function withLabels(selection) {
    try {
      const query = new URLSearchParams({ engineId: selection.engineId, modelProviderId: selection.modelProviderId,
        allConnectedModels: "true", connectedOnly: "true" });
      return { selection, ...selectionLabels(await requestColleague(`/models?${query}`, { method: "GET" }), selection) };
    } catch { return { selection, ...selectionLabels(null, selection) }; }
  }
  async function conversationReady() {
    if (!product.value.conversationId) await refresh();
    return Boolean(product.value.conversationId);
  }
  async function current() {
    await conversationReady();
    return product.value.assistantSelection ? withLabels(product.value.assistantSelection) : null;
  }
  async function select(assistantSelection) {
    if (!await conversationReady()) return { ok: false, error: productError.value || "Colleague is not ready yet; try again in a moment." };
    const result = await saveSelection({ assistantSelection }, { report: false });
    const selection = result?.ok === false ? null : result?.assistantSelection;
    if (!selection) return { ok: false, error: result?.error || "Colleague could not switch to this AI." };
    return { ok: true, ...await withLabels(selection) };
  }
  async function sayHello(message) {
    if (!await conversationReady()) return { ok: false, error: productError.value || "Colleague is not ready yet." };
    const target = await waitForConversation();
    const sent = target.turns.value.length;
    if (!await sendMessage(message, { focus: { ...readFocus() } }, target)) return { ok: false, error: target.error.value || "Colleague didn't receive it." };
    // Settles on the reply, a failed turn or the conversation's error, within 15 seconds.
    const outcome = () => {
      if (target.turns.value.length <= sent) return null;
      const { status, error } = target.turns.value.at(-1)?.assistant || {};
      const failure = target.snapshot.value?.status === "working" ? "" : target.snapshot.value?.error;
      if (["failed", "interrupted"].includes(status) || failure) return { ok: false, error: failure || error || "It stopped with an error." };
      const reply = latestAssistantMessageAwaitingUserReply(target.turns.value);
      return reply ? { ok: true, reply } : null;
    };
    let stop = null;
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => resolve({ ok: false, error: "It took too long to reply." }), 15000);
      stop = watch(outcome, value => { if (value) { clearTimeout(timer); resolve(value); } }, { immediate: true });
    });
    stop();
    return result;
  }
  /** Shows the conversation with its composer focused, for "Start building". */
  async function reveal() {
    reopenConversation();
    await focusConversationComposer();
  }
  return Object.freeze({
    current,
    select,
    sayHello,
    reveal
  });
}

export { createColleagueModel };
