import { ref } from "vue";
import {
  expandedComposerPromptSubmissionOptions as expandPromptSubmissionOptions,
  promptTemplateRefForItem
} from "@/lib/vibe64ComposerPromptRefs.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function composerDraftWithPastedText(current = "", text = "") {
  const existing = String(current || "");
  const pasted = String(text || "").trim();
  if (!pasted) {
    return existing;
  }
  if (!existing.trim()) {
    return pasted;
  }
  return `${existing.trimEnd()}\n\n${pasted}`;
}

function useVibe64ComposerPromptActions({
  actionById = () => null,
  activateWorkflowControl = async () => false,
  activeDraftText = () => "",
  activePromptControl = () => null,
  composerMenuItems = [],
  intentById = () => null,
  rejectOptimisticTurn = () => null,
  runWorkflowControl = async () => false,
  setActiveDraftText = () => false,
  startOptimisticTurn = () => null
} = {}) {
  const promptRefs = ref([]);

  function rememberPromptRef(promptRef = {}) {
    if (!promptRef?.text) {
      return;
    }
    const key = String(promptRef.id || promptRef.token || promptRef.label || "").trim();
    promptRefs.value = [
      ...promptRefs.value.filter((candidate) => (
        String(candidate.id || candidate.token || candidate.label || "").trim() !== key
      )),
      promptRef
    ];
  }

  function expandedSubmissionOptions(options = {}) {
    return expandPromptSubmissionOptions(options, {
      menuItems: readRefOrGetterValue(composerMenuItems) || [],
      promptRefs: promptRefs.value
    });
  }

  function expandedPromptOnlySubmissionOptions(promptRef = {}) {
    return expandPromptSubmissionOptions({
      displayFields: {
        conversationRequest: promptRef.displayText
      },
      fields: {
        conversationRequest: promptRef.displayText
      }
    }, {
      menuItems: readRefOrGetterValue(composerMenuItems) || [],
      promptRefs: [promptRef]
    });
  }

  function clearPromptRefs() {
    promptRefs.value = [];
  }

  function prefillActiveComposer(text = "") {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }
    return setActiveDraftText(composerDraftWithPastedText(activeDraftText(), value));
  }

  async function submitPromptTemplate(promptRef = {}) {
    const control = activePromptControl();
    if (!control?.id) {
      return false;
    }
    const payload = expandedPromptOnlySubmissionOptions(promptRef);
    const draftSubmission = startOptimisticTurn({
      control,
      options: payload,
      values: payload.displayFields
    });
    try {
      const accepted = await runWorkflowControl(control, {
        ...payload,
        composerSubmissionId: draftSubmission
      });
      if (!accepted) {
        rejectOptimisticTurn(draftSubmission);
        return false;
      }
      clearPromptRefs();
      return true;
    } catch (error) {
      rejectOptimisticTurn(draftSubmission, {
        error
      });
      return false;
    }
  }

  async function attachPromptTemplate(item = {}) {
    const promptRef = promptTemplateRefForItem(item);
    if (!promptRef) {
      return false;
    }
    const current = String(activeDraftText() || "");
    if (!current.trim()) {
      return submitPromptTemplate(promptRef);
    }
    rememberPromptRef(promptRef);
    return setActiveDraftText(composerDraftWithPastedText(current, promptRef.token));
  }

  async function activateComposerMenuItem(item = {}) {
    const kind = String(item?.kind || "template").trim();
    if (kind === "template") {
      return attachPromptTemplate(item);
    }
    if (kind === "action") {
      const action = actionById(item.actionId);
      if (!action) {
        return false;
      }
      return activateWorkflowControl({
        disabledReason: item.disabledReason || action.disabledReason || "",
        enabled: item.enabled === true && action.enabled === true,
        id: item.id || action.id,
        label: item.label || action.label || action.id,
        sourceAction: action,
        style: "secondary"
      });
    }
    if (kind === "intent") {
      const intent = intentById(item.intentId);
      if (!intent) {
        return false;
      }
      return activateWorkflowControl({
        ...intent,
        enabled: item.enabled === true && intent.enabled === true,
        id: intent.id,
        label: item.label || intent.label || intent.id
      });
    }
    return false;
  }

  function insertComposerMenuItemText(item = {}) {
    return prefillActiveComposer(item.text);
  }

  return {
    activateComposerMenuItem,
    clearPromptRefs,
    expandedSubmissionOptions,
    insertComposerMenuItemText,
    prefillActiveComposer
  };
}

export {
  composerDraftWithPastedText,
  useVibe64ComposerPromptActions
};
