import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import {
  ENGINEERING_ENDPOINT,
  VIBE64_ENGINEERING_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  engineeringSettingsQueryKey
} from "@/lib/studioGateApi.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

/**
 * The engineering approach section of Project settings: the source's engineering profile, read for
 * the session in the address, or the session the source reports, which then joins the address.
 * Saving records the profile in the source and reads it back whether or not the save succeeded.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   routeSessionId: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64EngineeringSettings({ projectSlug, route, router, routeSessionId }) {
  const engineeringProfileDraft = ref("");
  const savedEngineeringProfile = ref("");
  const engineeringResource = useEndpointResource({
    fallbackLoadError: "Engineering approach could not load.",
    path: computed(() => scopedDevelopmentApiUrl(ENGINEERING_ENDPOINT, projectSlug.value)),
    queryKey: computed(() => engineeringSettingsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value,
      routeSessionId.value
    )),
    readQuery: computed(() => (
      routeSessionId.value ? { sessionId: routeSessionId.value } : {}
    )),
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT,
      matches: () => !engineeringSaveCommand.isRunning
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Engineering approach"
  });
  const engineeringSaveCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ENGINEERING_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      path: ENGINEERING_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      profile: context.profile,
      ...(context.sessionId ? { sessionId: context.sessionId } : {})
    }),
    fallbackRunError: "Engineering approach could not be saved.",
    messages: {
      error: "Engineering approach could not be saved.",
      success: "Engineering approach saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.engineering.profile.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });

  const engineering = computed(() => engineeringResource.data.value?.engineering || {});
  const engineeringAvailable = computed(() => engineering.value.available === true);
  const engineeringProfiles = computed(() => (
    Array.isArray(engineering.value.profiles) ? engineering.value.profiles : []
  ));
  const engineeringSourceLabel = computed(() => (
    engineering.value.source?.rootKind === "session-source"
      ? "This session's project source"
      : "This project source"
  ));
  const engineeringUnavailableReason = computed(() => String(
    engineering.value.unavailableReason || "An engineering profile is not available for this source."
  ));
  const selectedEngineeringDescription = computed(() => String(
    engineeringProfiles.value.find((profile) => profile.id === engineeringProfileDraft.value)?.description || ""
  ));
  const engineeringStatusText = computed(() => (
    engineering.value.status === "defaulted"
      ? "The focused default is active. Saving records the choice in genesis/engineering.md."
      : "This choice is stored in genesis/engineering.md and follows the source."
  ));
  const engineeringSaving = ref(false);
  const engineeringChanged = computed(() => (
    engineeringAvailable.value &&
    Boolean(engineeringProfileDraft.value) &&
    engineeringProfileDraft.value !== savedEngineeringProfile.value
  ));

  let engineeringSource = null;
  watch([projectSlug, engineering], ([slug, value]) => {
    // A query-key transition can temporarily clear the same source's result.
    if (!value.source) return;
    const sourceChanged = !engineeringSource ||
      engineeringSource.projectSlug !== slug ||
      engineeringSource.rootKind !== value.source.rootKind ||
      engineeringSource.sessionId !== value.source.sessionId;
    const profile = String(value.profile?.id || "").trim();
    if (sourceChanged || engineeringProfileDraft.value === savedEngineeringProfile.value) {
      engineeringProfileDraft.value = profile;
    }
    savedEngineeringProfile.value = profile;
    engineeringSource = { projectSlug: slug, ...value.source };
    const sourceSessionId = String(value.source?.sessionId || "").trim();
    if (!routeSessionId.value && sourceSessionId) {
      void router.replace({
        query: {
          ...route.query,
          sessionId: sourceSessionId
        }
      });
    }
  }, {
    immediate: true
  });

  async function saveEngineeringProfile() {
    if (!engineeringChanged.value || engineeringSaving.value) {
      return;
    }
    engineeringSaving.value = true;
    try {
      await engineeringSaveCommand.run({
        profile: engineeringProfileDraft.value,
        sessionId: routeSessionId.value || String(engineering.value.source?.sessionId || "").trim()
      });
    } catch {
      // The command already presents the failure through shared action feedback.
    } finally {
      try {
        await engineeringResource.reload();
      } finally {
        engineeringSaving.value = false;
      }
    }
  }

  return {
    engineeringAvailable,
    engineeringChanged,
    engineeringProfileDraft,
    engineeringProfiles,
    engineeringResource,
    engineeringSaving,
    engineeringSourceLabel,
    engineeringStatusText,
    engineeringUnavailableReason,
    saveEngineeringProfile,
    selectedEngineeringDescription
  };
}

export {
  useVibe64EngineeringSettings
};
