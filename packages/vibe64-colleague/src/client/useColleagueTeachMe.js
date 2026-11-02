import { ref, watch } from "vue";

/**
 * Teach me on a lesson step first reveals Colleague's conversation (voice
 * stays as it is). Without a usable AI model Teach me sends nothing: the
 * conversation opens and says so, offering Set up your AI to connect one.
 * @param {object} options
 * @param {import("vue").Ref<object>} options.product
 * @param {() => Promise<void>} options.refresh
 * @param {() => void} options.reopenConversation
 * @param {() => Promise<object>} options.waitForConversation
 * @param {import("vue").ComputedRef<boolean>} options.bodyVisible
 * @param {() => Promise<void>} options.focusConversationComposer
 */
function useColleagueTeachMe({ product, refresh, reopenConversation, waitForConversation, bodyVisible, focusConversationComposer }) {
  const teachNeedsModel = ref(false);
  /** Reveals the conversation for Teach me; false when no usable AI model can answer. */
  async function revealForLearning() {
    teachNeedsModel.value = false;
    reopenConversation();
    // A fresh read says whether a model is usable before anything is sent.
    await refresh();
    if (product.value.modelSetupRequired) {
      teachNeedsModel.value = true;
      return false;
    }
    await waitForConversation();
    if (bodyVisible.value) await focusConversationComposer();
    return true;
  }
  watch(() => product.value.modelSetupRequired, required => { if (!required) teachNeedsModel.value = false; });
  return { teachNeedsModel, revealForLearning };
}

export { useColleagueTeachMe };
