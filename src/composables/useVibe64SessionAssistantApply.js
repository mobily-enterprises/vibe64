import { computed, nextTick, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AssistantModelAccessPath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";

/**
 * Custom AI's Apply and its provider model access switch: the session or
 * caller saves the draft choice, and the provider's paid models are unlocked
 * or locked again.
 * @param {object} options
 * @param {ReturnType<typeof import("@/composables/useVibe64SessionAssistantChoice.js").useVibe64SessionAssistantChoice>} options.choice
 * @param {(event: "saved") => void} options.emit
 * @param {import("vue").Ref<boolean>} options.menuOpen
 * @param {Readonly<import("@/composables/useVibe64SessionAssistantChoice.js").Vibe64SessionAssistantMenuProps>} options.props
 */
function useVibe64SessionAssistantApply({ choice, emit, menuOpen, props }) {
  const {
    agentId,
    assistantSelection,
    catalog,
    catalogError,
    catalogLoading,
    connections,
    draftSelection,
    engineId,
    modelAccess,
    modelId,
    modelProviderId,
    recommendedModel,
    reloadCatalog,
    routingMode,
    savesThroughCaller,
    selectedAgent,
    selectedModel,
    selectedProvider,
    selectionChanged,
    selectionForModel,
    selectionRevision,
    variantId
  } = choice;
  const saveError = ref("");
  const saving = ref(false);
  const modelAccessUpdating = ref(false);
  const unlockConfirmOpen = ref(false);
  const canSave = computed(() => Boolean(
    !props.changesDisabled &&
    (selectionChanged.value || routingMode.value !== "custom") &&
    selectedProvider.value &&
    selectedModel.value &&
    selectedAgent.value &&
    selectionRevision.value &&
    !catalogLoading.value &&
    !catalogError.value &&
    !modelAccessUpdating.value
  ));
  const updateCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PATCH",
      path: String(context?.path || "")
    }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({
      assistantSelection: context?.assistantSelection || {}
    }),
    fallbackRunError: "AI session choices could not be updated.",
    suppressSuccessMessage: true,
    onRunSuccess(response) {
      if (response?.ok === false) throw new Error(response.error || "The custom model could not be saved.");
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.assistant-selection.update",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
  });
  const modelAccessCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PATCH",
      path: String(context?.path || "")
    }),
    buildRawPayload: (_model, { context }) => ({
      engineId: String(context?.engineId || ""),
      modelProviderId: String(context?.modelProviderId || ""),
      unlocked: context?.unlocked === true
    }),
    fallbackRunError: "Provider model access could not be changed.",
    messages: {
      error: "Provider model access could not be changed.",
      success: "Provider model access updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.assistants.model-access.update",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
  });

  async function applySelection(selection, { closeMenu = true } = {}) {
    const sessionId = String(props.session?.sessionId || "").trim();
    const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
    if (props.changesDisabled || !selection || (!savesThroughCaller.value && (!sessionId || !sessionsPath)) || saving.value) {
      return null;
    }
    saving.value = true;
    saveError.value = "";
    try {
      const response = savesThroughCaller.value ? await props.saveSelection(selection) : await updateCommand.run({
        assistantSelection: selection,
        path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
      });
      if (response?.ok === false) throw new Error(response.error || "The custom model could not be saved.");
      if (response?.ok !== false) {
        emit("saved");
        modelId.value = selection.modelId;
        agentId.value = selection.agentId;
        variantId.value = selection.variantId;
        if (closeMenu) menuOpen.value = false;
      }
      return response;
    } catch (error) {
      saveError.value = error.message || "The custom model could not be saved.";
      // A refused save may mean the catalogue changed ("Review the current
      // choices and try again"); show the current choices so a retry can work.
      reloadCatalog().catch(() => {});
      return { ok: false, error: saveError.value };
    } finally {
      saving.value = false;
    }
  }

  async function save() {
    if (!canSave.value) return;
    await applySelection(draftSelection.value);
  }

  async function restoreRecommendedModel({ closeMenu = true } = {}) {
    const selection = selectionForModel(recommendedModel.value);
    return applySelection(selection, { closeMenu });
  }

  function requestModelAccessChange(unlocked) {
    if (props.changesDisabled || !props.canConfigure || modelAccessUpdating.value || saving.value) return;
    if (unlocked === true) {
      unlockConfirmOpen.value = true;
      return;
    }
    void updateModelAccess(false);
  }

  async function confirmUnlockModelAccess() {
    unlockConfirmOpen.value = false;
    await updateModelAccess(true);
  }

  async function updateModelAccess(unlocked) {
    const providerId = String(modelProviderId.value || "").trim();
    const path = vibe64AssistantModelAccessPath(connections.apiPath.value);
    if (
      !props.canConfigure ||
      props.changesDisabled ||
      !providerId ||
      !path ||
      !modelAccess.value.configurable ||
      modelAccessUpdating.value
    ) {
      return null;
    }
    modelAccessUpdating.value = true;
    try {
      const current = assistantSelection.value || {};
      if (
        unlocked !== true &&
        current.modelProviderId === providerId &&
        recommendedModel.value &&
        current.modelId !== recommendedModel.value.id
      ) {
        const recovery = await restoreRecommendedModel({ closeMenu: false });
        if (recovery?.ok === false || !recovery) return recovery;
        await nextTick();
      }
      const response = await modelAccessCommand.run({
        engineId: engineId.value,
        modelProviderId: providerId,
        path,
        unlocked: unlocked === true
      });
      if (response?.ok !== false) {
        await catalog.value?.reload();
      }
      return response;
    } finally {
      modelAccessUpdating.value = false;
    }
  }

  return {
    canSave,
    confirmUnlockModelAccess,
    modelAccessUpdating,
    requestModelAccessChange,
    restoreRecommendedModel,
    save,
    saveError,
    saving,
    unlockConfirmOpen
  };
}

export { useVibe64SessionAssistantApply };
