<script setup>
import { computed, inject, ref, unref, watch } from "vue";
import { mdiArchiveArrowDownOutline, mdiClose, mdiFileDocumentOutline, mdiHistory } from "@mdi/js";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import { parseWorkPlanLines } from "@local/vibe64-terminals/shared/assistantWorkPlan";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { VIBE64_SESSION_CHANGED_EVENT, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";

const props = defineProps({ active: Boolean, busy: Boolean, session: { type: Object, default: null },
  sessionsApiPath: { type: [Function, Object, String], default: "" } });
const projectSlug = useVibe64ProjectSlug();
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const actorKey = computed(() => unref(viewer)?.actorKey || "");
const sessionId = computed(() => props.session?.sessionId || "");
const sessionsPath = computed(() => String(readRefOrGetterValue(props.sessionsApiPath) || ""));
const enabled = computed(() => props.active && Boolean(sessionId.value && sessionsPath.value && actorKey.value));
const endpoint = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/work-plan"));
const open = ref(false);
const archiveId = ref("");
const notice = ref("");
const showHistory = ref(false);
const archiving = ref(false);
const archiveError = ref("");
const resource = useEndpointResource({
  enabled, path: endpoint,
  queryKey: computed(() => ["vibe64-work-plan", projectSlug.value, sessionsPath.value, sessionId.value, actorKey.value, archiveId.value]),
  fallbackLoadError: "The plan could not be loaded.",
  queryOptions: {
    meta: { jskit: { requestRecovery: false } }, retry: false,
    refetchOnMount: "always", refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const selectedArchive = archiveId.value;
      const path = endpoint.value;
      const read = (query) => getHttpWebClient().request(path + "?" + new URLSearchParams(query), { signal });
      const first = await read({ limit: "16000", ...(selectedArchive ? { archiveId: selectedArchive } : {}) });
      let page = first;
      let text = first.text || "";
      while (page.hasMore) {
        page = await read({ limit: "16000", offset: String(page.nextOffset), expectedRevision: first.revision,
          ...(selectedArchive ? { archiveId: selectedArchive } : {}) });
        text += page.text;
      }
      return { ...first, text };
    }
  }
});
useRealtimeEvent({
  enabled, event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value && payload.sessionId === sessionId.value &&
    ["work-plan-changed", "assistant-routing-changed"].includes(payload.reason),
  onEvent: ({ payload = {} } = {}) => {
    if (payload.planNotice) notice.value = payload.planNotice;
    void resource.reload();
  }
});
const plan = computed(() => resource.data.value || null);
const visible = computed(() => Boolean(plan.value?.available || plan.value?.history?.length || resource.loadError.value));
const history = computed(() => plan.value?.history || []);
const selectedPlanReady = computed(() => (plan.value?.archiveId || "") === archiveId.value);
const currentActive = computed(() => plan.value?.current?.status === "active");
const label = computed(() => currentActive.value ? "View active plan" : "View plan and history");
async function archivePlan() {
  if (archiving.value || props.busy || !plan.value?.current || archiveId.value || !selectedPlanReady.value) return;
  const target = endpoint.value;
  const actor = actorKey.value;
  archiving.value = true;
  archiveError.value = "";
  try {
    const result = await getHttpWebClient().request(target + "/archive", {
      method: "POST", body: { expectedRevision: plan.value.current.revision }
    });
    if (result?.ok === false) throw new Error(result.error || "The plan could not be archived.");
    if (target !== endpoint.value || actor !== actorKey.value) return;
    notice.value = result.notice || "The plan is archived and remains available in History.";
    showHistory.value = true;
    await resource.reload();
  } catch (error) {
    if (target === endpoint.value && actor === actorKey.value) archiveError.value = error.message;
  } finally {
    if (target === endpoint.value && actor === actorKey.value) archiving.value = false;
  }
}
const sections = computed(() => {
  const result = [];
  let prose = [];
  const flush = () => {
    if (prose.length) {
      result.push({ blocks: parseLongTextReviewBlocks(prose.join("\n")) });
      prose = [];
    }
  };
  for (const line of parseWorkPlanLines(plan.value?.text || "")) {
    if (line.checked !== undefined) {
      flush();
      result.push({ checked: line.checked, blocks: parseLongTextReviewBlocks(line.text) });
    } else if (!/^Status: (active|completed)\s*$/u.test(line.text)) {
      prose.push(line.text);
    }
  }
  flush();
  return result;
});
watch([sessionId, sessionsPath, actorKey], () => {
  open.value = false;
  archiveId.value = "";
  notice.value = "";
  showHistory.value = false;
  archiving.value = false;
  archiveError.value = "";
});
watch(() => props.active, (active) => {
  if (!active) open.value = false;
});
</script>

<template>
  <div v-if="visible" class="work-plan-control">
    <v-btn
      :icon="mdiFileDocumentOutline" :variant="currentActive ? 'tonal' : 'text'" :color="currentActive ? 'warning' : undefined"
      :aria-label="label" :title="label" size="small" @click="open = true"
    />
    <span v-if="notice" class="d-sr-only" role="status">{{ notice }}</span>
  </div>
  <v-dialog v-model="open" max-width="880" scrollable aria-label="Plan and history">
    <v-card rounded="xl">
      <v-card-title class="d-flex align-center">
        {{ showHistory ? 'Plan history' : archiveId ? 'Archived plan' : 'Current plan' }}
        <v-spacer />
        <v-btn :icon="mdiHistory" variant="text" aria-label="Plan history" title="Plan history" :aria-pressed="showHistory" @click="showHistory = !showHistory" />
        <v-btn :icon="mdiClose" variant="text" aria-label="Close plan" @click="open = false" />
      </v-card-title>
      <v-card-text class="work-plan-content">
        <p v-if="notice" class="text-body-small text-medium-emphasis mb-3">{{ notice }}</p>
        <v-btn v-if="showHistory || archiveId" variant="text" class="mb-3" @click="archiveId = ''; showHistory = false">Current plan</v-btn>
        <v-alert v-if="archiveError" type="error" variant="tonal" class="mb-3">{{ archiveError }}</v-alert>
        <v-alert v-if="resource.loadError.value" type="warning" variant="tonal" class="mb-3">
          {{ resource.loadError.value }}
          <v-btn variant="text" @click="resource.reload()">Retry</v-btn>
        </v-alert>
        <template v-if="showHistory">
          <v-list v-if="history.length" aria-label="Archived plans">
            <v-list-item
              v-for="item in history" :key="item.id" :title="item.title"
              :subtitle="`${item.status === 'completed' ? 'Completed' : 'Unfinished'} · ${new Date(item.archivedAt).toLocaleString()}`"
              @click="archiveId = item.id; showHistory = false"
            />
          </v-list>
          <p v-else>No archived plans yet. Archive the current plan to keep it here.</p>
        </template>
        <v-progress-linear v-else-if="!selectedPlanReady && !resource.loadError.value" indeterminate aria-label="Loading plan" />
        <template v-else-if="plan?.available && selectedPlanReady">
          <p class="text-body-small mb-4" role="status">
            {{ plan.status === 'completed' ? 'Completed' : 'Active' }} · {{ plan.checked }} / {{ plan.total }} checked
            <span v-if="archiveId"> · Archived snapshot. Ask Senior in chat to reopen it.</span>
          </p>
          <div v-for="(section, index) in sections" :key="index" :class="{ 'work-plan-item': section.checked !== undefined }">
            <input v-if="section.checked !== undefined" type="checkbox" :checked="section.checked" disabled aria-label="Recorded completion">
            <LongTextPreviewBlocks :blocks="section.blocks" />
          </div>
        </template>
        <p v-else-if="!resource.loadError.value">There is no current plan. Ask Senior in chat to create one or reopen an archived plan.</p>
      </v-card-text>
      <v-card-actions v-if="!showHistory && !archiveId && plan?.current">
        <v-btn
          :prepend-icon="mdiArchiveArrowDownOutline" :loading="archiving" :disabled="busy || archiving || !selectedPlanReady"
          min-height="48" title="Preserve this plan in History without marking it completed" @click="archivePlan"
        >
          Archive plan
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.work-plan-control { display: inline-flex; align-items: center; flex: 0 0 auto; }
@media (pointer: coarse) {
  .work-plan-control > .v-btn { min-width: 48px; min-height: 48px; }
}
.work-plan-content { overflow-wrap: anywhere; }
.work-plan-item { display: flex; align-items: flex-start; gap: 0.75rem; margin-block: 0.5rem; }
.work-plan-item input { flex: none; width: 1.1rem; height: 1.1rem; margin-top: 0.25rem; opacity: 1; accent-color: rgb(var(--v-theme-primary)); }
.work-plan-item > :last-child { min-width: 0; flex: 1; }
</style>
