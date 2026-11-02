import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  COLLABORATION_ENDPOINT,
  VIBE64_COLLABORATION_API_SUFFIX
} from "@/lib/studioGateApi.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

function normalizeCollaborationDraft(value = {}) {
  return {
    tone: String(value?.tone || ""),
    responseLength: String(value?.responseLength || ""),
    experience: String(value?.experience || ""),
    explanationStyle: String(value?.explanationStyle || ""),
    requirements: String(value?.requirements || "")
  };
}

function collaborationChoiceOptions(collaboration = {}, field = "") {
  const choices = collaboration.choices?.[field];
  return (Array.isArray(choices) ? choices : []).flatMap((choice) => {
    const value = String(choice?.id || "").trim();
    const label = String(choice?.name || "").trim();
    return value && label ? [{ label, value }] : [];
  });
}

/**
 * The AI behaviour section of Project settings: tone, response length, experience, explanation style
 * and project requirements, saved to the project source. A changed source replaces the draft; the
 * same source keeps unsaved edits while its saved values refresh.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   resource: {
 *     data: import("vue").Ref<{ collaboration?: object } | null>,
 *     reload: () => Promise<unknown>
 *   },
 *   routeSessionId: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64CollaborationSettings({ projectSlug, resource, routeSessionId }) {
  const collaborationDraft = ref(normalizeCollaborationDraft());
  const savedCollaboration = ref(normalizeCollaborationDraft());
  const collaborationSaveCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_COLLABORATION_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      path: COLLABORATION_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      ...context.collaboration,
      ...(context.sessionId ? { sessionId: context.sessionId } : {})
    }),
    fallbackRunError: "Collaboration guidance could not be saved.",
    messages: {
      error: "Collaboration guidance could not be saved.",
      success: "Collaboration guidance saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.collaboration.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });

  const collaboration = computed(() => resource.data.value?.collaboration || {});
  const collaborationAvailable = computed(() => collaboration.value.available === true);
  const collaborationCanEdit = computed(() => collaboration.value.canEdit === true);
  const collaborationSourceLabel = computed(() => (
    collaboration.value.source?.rootKind === "session-source"
      ? "This session's project source"
      : "This project source"
  ));
  const collaborationUnavailableReason = computed(() => String(
    collaboration.value.unavailableReason ||
    "Collaboration guidance is not available for this source."
  ));
  const toneOptions = computed(() => collaborationChoiceOptions(collaboration.value, "tone"));
  const responseLengthOptions = computed(() => collaborationChoiceOptions(collaboration.value, "responseLength"));
  const experienceOptions = computed(() => collaborationChoiceOptions(collaboration.value, "experience"));
  const explanationStyleOptions = computed(() => collaborationChoiceOptions(collaboration.value, "explanationStyle"));
  const collaborationSaving = ref(false);
  const collaborationChanged = computed(() => (
    JSON.stringify(collaborationDraft.value) !== JSON.stringify(savedCollaboration.value)
  ));

  let collaborationSource = null;
  watch([projectSlug, collaboration], ([slug, value]) => {
    // A query-key transition can temporarily clear the same source's result.
    if (!value.source) return;
    const sourceChanged = !collaborationSource ||
      collaborationSource.projectSlug !== slug ||
      collaborationSource.rootKind !== value.source.rootKind ||
      collaborationSource.sessionId !== value.source.sessionId;
    const next = normalizeCollaborationDraft(value);
    if (sourceChanged || !collaborationChanged.value) {
      collaborationDraft.value = next;
    }
    savedCollaboration.value = { ...next };
    collaborationSource = { projectSlug: slug, ...value.source };
  }, {
    immediate: true
  });

  async function saveCollaboration() {
    if (
      !collaborationChanged.value ||
      !collaborationAvailable.value ||
      !collaborationCanEdit.value ||
      collaborationSaving.value
    ) {
      return;
    }
    collaborationSaving.value = true;
    try {
      try {
        await collaborationSaveCommand.run({
          collaboration: normalizeCollaborationDraft(collaborationDraft.value),
          sessionId: routeSessionId.value || String(collaboration.value.source?.sessionId || "").trim()
        });
      } catch {
        // The command already presents the failure through shared action feedback.
        return;
      }
      await resource.reload();
    } finally {
      collaborationSaving.value = false;
    }
  }

  return {
    collaborationAvailable,
    collaborationCanEdit,
    collaborationChanged,
    collaborationDraft,
    collaborationSaving,
    collaborationSourceLabel,
    collaborationUnavailableReason,
    experienceOptions,
    explanationStyleOptions,
    responseLengthOptions,
    saveCollaboration,
    toneOptions
  };
}

export {
  useVibe64CollaborationSettings
};
