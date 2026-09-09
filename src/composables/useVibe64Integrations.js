import { computed, onScopeDispose, ref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { validateIntegrationConfiguration } from "@jskit-ai/connectors-core/shared/configuration";
import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { googleCalendarDefinition } from "@jskit-ai/connector-google-calendar/shared";
import { vibe64BrowserTabOriginId } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64SessionPath, VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

export function useVibe64Integrations(context) {
  const configuration = ref(null);
  const baseline = ref("");
  const baseHash = ref(null);
  const fieldErrors = ref({});
  const error = ref("");
  const changedElsewhere = ref(false);
  const sessionId = computed(() => String(context.value.sessionId || ""));
  const active = computed(() => context.value.active !== false && Boolean(sessionId.value));
  const path = computed(() => vibe64SessionPath(
    readRefOrGetterValue(context.value.sessionsApiPath), sessionId.value, "/integrations"
  ));
  const dirty = computed(() => Boolean(configuration.value && JSON.stringify(configuration.value) !== baseline.value));
  const resource = useEndpointResource({
    path,
    enabled: active,
    queryKey: computed(() => ["vibe64.integrations", path.value]),
    requestRecoveryLabel: "Integrations",
    fallbackLoadError: "Integrations could not load."
  });
  const command = useCommand({
    access: "never", ownershipFilter: "public", surfaceId: "app", writeMethod: "PUT",
    apiSuffix: "/vibe64/integrations",
    buildRawPayload: (_model, { context: request }) => request.body,
    buildCommandOptions: (_payload, { context: request }) => ({ method: "PUT", path: request.path }),
    messages: { success: "Integration configuration saved.", error: "Integration configuration could not be saved." },
    placementSource: "vibe64.integrations.save"
  });
  let disposed = false;
  onScopeDispose(() => { disposed = true; });

  function apply(payload) {
    configuration.value = JSON.parse(JSON.stringify(payload.configuration));
    baseline.value = JSON.stringify(payload.configuration);
    baseHash.value = payload.baseHash;
    changedElsewhere.value = false;
    error.value = "";
    fieldErrors.value = {};
  }

  watch(resource.data, (payload) => {
    if (!payload?.configuration || disposed) return;
    if (dirty.value) {
      if (payload.baseHash !== baseHash.value) changedElsewhere.value = true;
    } else apply(payload);
  }, { immediate: true });

  useRealtimeEvent({
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    enabled: active,
    onEvent: ({ payload }) => {
      if (payload.sessionId !== sessionId.value || payload.path !== "integrations.json" ||
          payload.originId === vibe64BrowserTabOriginId()) return;
      void resource.reload();
    }
  });

  async function save() {
    if (!dirty.value || changedElsewhere.value || command.isRunning || context.value.sourceOperationsSuspended) return;
    error.value = "";
    fieldErrors.value = {};
    try {
      const validated = validateIntegrationConfiguration(configuration.value, {
        providers: [googleCalendarDefinition, ...connectorDefinitions], allowUnknownProviders: true
      });
      const payload = await command.run({
        path: path.value,
        body: { configuration: validated, baseHash: baseHash.value, originId: vibe64BrowserTabOriginId() }
      });
      if (payload && !disposed) apply(payload);
    } catch (failure) {
      if (disposed) return;
      fieldErrors.value = failure.fieldErrors || failure.details?.fieldErrors || {};
      error.value = failure.message || "Configuration could not be saved. Reload to check for other changes.";
      if (failure.status === 409 || failure.statusCode === 409) changedElsewhere.value = true;
    }
  }

  async function discard() {
    if (command.isRunning) return;
    const result = await resource.reload();
    if (result?.data?.configuration && !result.isError && !disposed) apply(result.data);
  }

  return { configuration, dirty, resource, command, fieldErrors, error, changedElsewhere, save, discard };
}
