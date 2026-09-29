<script setup>
import { computed, inject, ref, unref, watch } from "vue";
import { mdiArchiveArrowDownOutline, mdiArchiveOutline, mdiArrowLeft, mdiCheckCircleOutline, mdiChevronRight, mdiClose, mdiFileDocumentOutline, mdiHistory, mdiRestore } from "@mdi/js";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
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
const view = ref("current");
const showHistory = computed(() => view.value === "history" && !archiveId.value);
const pendingOperation = ref("");
const feedback = useShellWebErrorRuntime();
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
const history = computed(() => (plan.value?.history || []).map(item => ({ ...item,
  archivedDate: new Date(item.archivedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
})));
const selectedArchive = computed(() => history.value.find(item => item.id === archiveId.value));
const selectedPlanReady = computed(() => Boolean(plan.value) && (plan.value.archiveId || "") === archiveId.value);
const canChangePlan = computed(() => !props.busy && !pendingOperation.value && selectedPlanReady.value);
const currentActive = computed(() => plan.value?.current?.status === "active");
const label = computed(() => currentActive.value ? "View active plan" : "View plan and history");
async function changePlan(operation) {
  if (!canChangePlan.value) return;
  const restoring = operation === "restore";
  if (restoring) {
    if (!archiveId.value || plan.value?.current) return;
  } else if (!plan.value?.current || archiveId.value) return;
  const target = endpoint.value;
  const actor = actorKey.value;
  pendingOperation.value = operation;
  try {
    const result = await getHttpWebClient().request(target + "/" + operation, {
      method: "POST", body: restoring ? { archiveId: archiveId.value } : { expectedRevision: plan.value.current.revision }
    });
    if (result?.ok === false) throw new Error(result.error || "The plan could not be updated.");
    if (target !== endpoint.value || actor !== actorKey.value) return;
    notice.value = result.notice || (restoring ? "The plan is now current and active." : "The plan is archived and remains available in History.");
    if (restoring) archiveId.value = "";
    await resource.reload();
    if (target === endpoint.value && actor === actorKey.value) view.value = restoring ? "current" : "history";
  } catch (error) {
    if (target === endpoint.value && actor === actorKey.value) feedback.report({
      source: "vibe64.work-plan." + operation, intent: "action-feedback", severity: "error", message: error.message
    });
  } finally {
    if (target === endpoint.value && actor === actorKey.value) pendingOperation.value = "";
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
  view.value = "current";
  pendingOperation.value = "";
});
watch(() => props.active, (active) => {
  if (!active) open.value = false;
});
</script>

<template>
  <div v-if="visible" class="work-plan-control">
    <v-btn
      :icon="mdiFileDocumentOutline" :variant="currentActive ? 'tonal' : 'text'" :color="currentActive ? 'warning' : undefined"
      :aria-label="label" :title="label" size="small" @click="archiveId = ''; view = plan?.current ? 'current' : 'history'; open = true"
    />
    <span v-if="notice" class="d-sr-only" role="status">{{ notice }}</span>
  </div>
  <v-dialog v-model="open" max-width="880" height="min(760px, calc(100dvh - 48px))" scrollable aria-label="Plan and history">
    <v-card rounded="xl" height="100%">
      <v-card-title class="d-flex align-center ga-2 px-4 py-2 flex-shrink-0">
        <span class="text-title-large">Plan</span>
        <v-spacer />
        <v-btn
          v-if="view === 'current' && plan?.current"
          :prepend-icon="mdiArchiveArrowDownOutline" :disabled="!canChangePlan"
          :aria-busy="pendingOperation === 'archive'" variant="text" size="small" width="120" min-height="48"
          aria-label="Archive plan" title="Move this plan to History without marking it completed" @click="changePlan('archive')"
        >
          {{ pendingOperation === 'archive' ? 'Archiving…' : 'Archive' }}
        </v-btn>
        <v-btn
          v-if="archiveId && !plan?.current"
          :prepend-icon="mdiRestore" :disabled="!canChangePlan"
          :aria-busy="pendingOperation === 'restore'" variant="text" color="primary" size="small" width="128" min-height="48"
          aria-label="Make current" title="Move this archived plan back to Current plan and reopen it as Active" @click="changePlan('restore')"
        >
          {{ pendingOperation === 'restore' ? 'Restoring…' : 'Make current' }}
        </v-btn>
        <v-btn :icon="mdiClose" variant="text" aria-label="Close plan" title="Close plan" @click="open = false" />
      </v-card-title>
      <v-tabs :model-value="view" color="primary" grow height="48" class="flex-grow-0 flex-shrink-0" aria-label="Plan views" @update:model-value="view = $event; archiveId = ''">
        <v-tab value="current" :prepend-icon="mdiFileDocumentOutline">Current plan</v-tab>
        <v-tab value="history" :prepend-icon="mdiHistory">History</v-tab>
      </v-tabs>
      <v-divider />
      <v-sheet v-if="archiveId" color="surface" border="b" class="work-plan-archive-context px-4 py-3">
        <v-btn :icon="mdiArrowLeft" variant="text" aria-label="Back to plan history" title="Back to plan history" @click="archiveId = ''" />
        <div class="work-plan-archive-copy">
          <v-chip color="primary" variant="tonal" size="small" class="mb-1">Archived · read-only</v-chip>
          <p class="text-body-small text-medium-emphasis">{{ selectedArchive ? `Archived ${selectedArchive.archivedDate}` : 'Saved snapshot' }}</p>
        </div>
      </v-sheet>
      <v-card-text class="work-plan-content pa-4 pa-sm-6" :class="{ 'd-flex flex-column': showHistory && !history.length }">
        <v-alert v-if="resource.loadError.value" type="warning" variant="tonal" class="mb-4">
          {{ resource.loadError.value }}
          <v-btn variant="text" @click="resource.reload()">Retry</v-btn>
        </v-alert>
        <template v-if="showHistory">
          <v-list v-if="history.length" aria-label="Archived plans" class="pa-0 bg-transparent">
            <v-list-item
              v-for="item in history" :key="item.id" :aria-label="`Open archived plan: ${item.title}`" role="button"
              rounded="lg" border class="mb-2 pa-4"
              @click="archiveId = item.id"
            >
              <div class="d-flex align-start ga-2">
                <v-list-item-title class="work-plan-history-title text-title-medium">{{ item.title }}</v-list-item-title>
                <v-icon :icon="mdiChevronRight" class="flex-shrink-0" />
              </div>
              <p class="text-body-small text-medium-emphasis mt-1">Archived {{ item.archivedDate }}</p>
              <div class="d-flex align-center flex-wrap ga-2 mt-2">
                <v-chip :color="item.status === 'completed' ? 'success' : undefined" size="small" variant="tonal">
                  <span class="text-high-emphasis">{{ item.status === 'completed' ? 'Completed' : 'Unfinished' }}</span>
                </v-chip>
                <span v-if="typeof item.total === 'number'" class="text-body-small text-medium-emphasis">{{ item.checked }} / {{ item.total }} checked</span>
              </div>
            </v-list-item>
          </v-list>
          <div v-else class="work-plan-empty text-center pa-4">
            <v-icon :icon="mdiHistory" size="48" class="text-medium-emphasis mb-4" />
            <p class="text-title-medium mb-2">No archived plans</p>
            <p class="text-body-medium text-medium-emphasis">Archive a plan to keep it here.</p>
          </div>
        </template>
        <v-skeleton-loader v-else-if="!selectedPlanReady && !resource.loadError.value" type="heading, paragraph, paragraph, paragraph" aria-label="Loading plan" aria-busy="true" />
        <template v-else-if="plan?.available && selectedPlanReady">
          <div class="d-flex align-center flex-wrap ga-3 mb-5" role="status">
            <v-chip
              :color="plan.status === 'completed' ? 'success' : 'warning'" variant="tonal" size="small"
              :prepend-icon="plan.status === 'completed' ? mdiCheckCircleOutline : undefined"
            >
              <span class="text-high-emphasis">{{ plan.status === 'completed' ? 'Completed' : archiveId ? 'Unfinished' : 'Active' }}</span>
            </v-chip>
            <span class="text-body-small text-medium-emphasis">{{ plan.checked }} / {{ plan.total }} checked</span>
          </div>
          <div v-for="(section, index) in sections" :key="index" :class="{ 'work-plan-item': section.checked !== undefined }">
            <input v-if="section.checked !== undefined" type="checkbox" :checked="section.checked" disabled aria-label="Recorded completion">
            <LongTextPreviewBlocks :blocks="section.blocks" />
          </div>
        </template>
        <div v-else-if="!resource.loadError.value" class="work-plan-empty text-center pa-4">
          <v-icon :icon="mdiArchiveOutline" size="48" class="text-medium-emphasis mb-4" />
          <p class="text-title-medium mb-2">No current plan</p>
          <p class="text-body-medium text-medium-emphasis">Ask Senior in chat to create a plan or reopen one from History.</p>
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.work-plan-control { display: inline-flex; align-items: center; flex: 0 0 auto; }
@media (pointer: coarse) {
  .work-plan-control > .v-btn { min-width: 48px; min-height: 48px; }
}
.work-plan-content { min-height: 0; overflow-wrap: anywhere; }
.work-plan-archive-context { display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; }
.work-plan-archive-copy { min-width: 0; }
.work-plan-history-title { flex: 1; min-width: 0; white-space: normal; overflow-wrap: anywhere; }
.work-plan-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; min-height: 12rem; }
.work-plan-item { display: flex; align-items: flex-start; gap: 0.75rem; margin-block: 0.5rem; }
.work-plan-item input { flex: none; width: 1.1rem; height: 1.1rem; margin-top: 0.25rem; opacity: 1; accent-color: rgb(var(--v-theme-primary)); }
.work-plan-item > :last-child { min-width: 0; flex: 1; }
</style>
