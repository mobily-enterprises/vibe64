<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQueryClient } from "@tanstack/vue-query";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiArrowLeft, mdiRefresh, mdiSourceMerge, mdiArchiveOutline } from "@mdi/js";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { vibe64ApiError, vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";

const props = defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const feedback = useUiFeedback({ source: "vibe64.incoming" });
const projectSlug = computed(() => projectSlugFromRoute(route));
const sessionId = computed(() => props.dashboardContext.sessionId || "");
const available = computed(() => props.dashboardContext.projectContext?.repositoryMode === "github");
const id = computed(() => String(route.query.contribution || ""));
const state = computed(() => ["pending", "merged", "discarded", "unresolved", "all"].includes(route.query.state) ? route.query.state : "pending");
const offset = computed(() => /^\d+$/u.test(String(route.query.offset || "")) ? Number(route.query.offset) : 0);
const basePath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/incoming", projectSlug.value));
const path = computed(() => id.value ? `${basePath.value}/${encodeURIComponent(id.value)}` : basePath.value);
const readQuery = computed(() => ({ sessionId: sessionId.value, ...(!id.value ? { state: state.value, offset: offset.value, limit: 25 } : {}) }));
const resource = useEndpointResource({ path, readQuery,
  queryKey: computed(() => ["vibe64.incoming", basePath.value, id.value, readQuery.value]),
  enabled: computed(() => available.value && Boolean(sessionId.value) && props.dashboardContext.active !== false),
  queryOptions: { retry: false }, mutationOptions: { retry: false }, fallbackLoadError: "Incoming changes could not load."
});
const entry = computed(() => id.value ? resource.data.value?.contributions?.[0] : null);
const confirmation = ref(null);
const pending = ref(false);
const uncertain = ref(false);
const conflict = ref(null);
const repair = ref(null);
const openingRepair = ref(false);
const loadError = computed(() => resource.loadError.value || vibe64ResourceResponseError(resource.data.value));
watch(() => [path.value, sessionId.value], () => {
  confirmation.value = null; uncertain.value = false; conflict.value = null; repair.value = null;
});
const actionDisabled = computed(() => pending.value || openingRepair.value || uncertain.value || resource.isFetching.value || props.dashboardContext.sourceOperationsSuspended);

function navigate(query) { return router.push({ query: { ...route.query, ...query } }); }
function back() {
  const previous = router.options.history.state.back;
  if (typeof previous === "string" && previous.startsWith(projectAppPath(projectSlug.value) + "/")) router.back();
  else void router.push(projectAppPath(projectSlug.value, "/dashboard/env"));
}
function confirm(action) {
  if (actionDisabled.value || !entry.value?.review || resource.data.value?.actions?.[action]) return;
  confirmation.value = { action, review: { ...entry.value.review }, id: entry.value.id,
    ...(action === "merge" && repair.value ? { repairReview: { ...repair.value.repairReview } } : {}),
    path: path.value, sessionId: sessionId.value, basePath: basePath.value };
}
async function apply() {
  if (pending.value || !confirmation.value || uncertain.value) return;
  const reviewed = confirmation.value;
  pending.value = true;
  try {
    const result = await resource.save({ sessionId: reviewed.sessionId, action: reviewed.action, review: reviewed.review,
      ...(reviewed.repairReview ? { repairReview: reviewed.repairReview } : {}) }, { method: "POST", path: reviewed.path });
    if (result?.ok !== true) throw vibe64ApiError(result, "The contribution action was not confirmed.");
    feedback.success(reviewed.action === "merge" ? "Contribution merged." : "Contribution discarded; its commits are preserved.");
    confirmation.value = null;
    conflict.value = null;
    repair.value = null;
    await queryClient.invalidateQueries({ queryKey: ["vibe64.incoming", reviewed.basePath] });
  } catch (error) {
    if (path.value === reviewed.path && sessionId.value === reviewed.sessionId) {
      confirmation.value = null;
      repair.value = null;
      if (error.code === "vibe64_incoming_merge_conflict") {
        conflict.value = { ...error.details, review: reviewed.review };
      } else uncertain.value = true;
    }
    feedback.error(error, "The result was not confirmed. Refresh Incoming changes before trying again.");
  } finally { pending.value = false; }
}
async function fixConflict() {
  if (actionDisabled.value || !conflict.value || props.dashboardContext.assistantFixAllowed === false ||
      typeof props.dashboardContext.requestTemporaryAi !== "function") return;
  const { review, conflictPaths, checkpointCommit } = conflict.value;
  openingRepair.value = true;
  try {
    await props.dashboardContext.requestTemporaryAi({ code: "vibe64_incoming_merge_conflict", title: "Resolve Incoming merge",
      error: [`Receiving repository: ${review.repository}; target ${review.targetBranch} at ${review.targetHead}.`,
        `Contribution vibe64-incoming/${review.id} at ${review.activeHead}.`,
        `Original receiving work is preserved by checkpoint ${checkpointCommit}.`,
        `Conflicting files: ${JSON.stringify(conflictPaths)}.`].join("\n") });
  } finally { openingRepair.value = false; }
}
async function reviewRepair() {
  if (actionDisabled.value || !entry.value?.review) return;
  const reviewed = { path: path.value, sessionId: sessionId.value, review: { ...entry.value.review } };
  pending.value = true;
  try {
    const result = await resource.save({ sessionId: reviewed.sessionId, action: "review-repair", review: reviewed.review },
      { method: "POST", path: reviewed.path });
    if (result?.ok !== true || result.status !== "repair-review") throw vibe64ApiError(result, "Repair review was not confirmed. Refresh before retrying.");
    if (path.value === reviewed.path && sessionId.value === reviewed.sessionId) repair.value = result;
  } catch (error) {
    if (path.value === reviewed.path && sessionId.value === reviewed.sessionId) { repair.value = null; uncertain.value = true; }
    feedback.error(error, "Repair review failed. The contribution has not been merged.");
  } finally { pending.value = false; }
}
async function refresh() {
  confirmation.value = null;
  repair.value = null;
  conflict.value = null;
  await resource.reload();
  if (!loadError.value) uncertain.value = false;
}
</script>

<template>
  <section class="incoming d-flex flex-column ga-3" aria-label="Incoming changes">
    <div class="d-flex align-center flex-wrap ga-2">
      <v-btn :prepend-icon="mdiArrowLeft" variant="text" height="48" @click="back">Back</v-btn>
      <v-btn v-if="id" variant="tonal" height="48" @click="navigate({ contribution: undefined })">All incoming changes</v-btn>
      <v-spacer />
      <v-btn :prepend-icon="mdiRefresh" variant="text" height="48" :disabled="pending || resource.isFetching.value || !sessionId || !available" @click="refresh">
        {{ resource.isFetching.value ? 'Refreshing…' : 'Refresh' }}
      </v-btn>
    </div>
    <v-alert v-if="!available" type="info" variant="tonal">Incoming changes require a configured GitHub receiving project.</v-alert>
    <v-alert v-else-if="!sessionId" type="info" variant="tonal">Select or create a working session to read this project's Incoming changes. The queue is shared by all sessions.</v-alert>
    <template v-else>
      <v-select v-if="!id" :model-value="state" label="Contribution state" hide-details variant="outlined"
        :items="['pending', 'merged', 'discarded', 'unresolved', 'all'].map(value => ({ value, title: value[0].toUpperCase() + value.slice(1) }))"
        @update:model-value="navigate({ state: $event, offset: undefined })" />
      <v-sheet v-if="resource.isInitialLoading.value" border rounded="lg" class="pa-4" aria-label="Loading incoming changes" aria-busy="true">
        <v-skeleton-loader v-for="index in 3" :key="index" :type="id ? 'paragraph' : 'list-item-two-line'" />
      </v-sheet>
      <v-alert v-else-if="loadError" type="error" variant="tonal">{{ loadError }}</v-alert>
      <template v-else-if="!id">
        <v-alert v-if="resource.data.value?.unresolvedCount > 0 && state !== 'unresolved'" type="warning" variant="tonal">
          {{ resource.data.value.unresolvedCount }} interrupted discards need review.
          <v-btn variant="text" height="48" @click="navigate({ state: 'unresolved', offset: undefined })">Review interrupted discards</v-btn>
        </v-alert>
        <p class="ma-0 text-body-medium">{{ resource.data.value?.totalCount || 0 }} {{ state }} contributions</p>
        <p v-if="!resource.data.value?.contributions?.length" class="ma-0">No contributions in this view.</p>
        <v-sheet v-for="item in resource.data.value?.contributions || []" :key="item.id" border rounded="lg" class="pa-4 d-flex flex-wrap align-center ga-3">
          <div class="incoming__summary">
            <p class="ma-0 text-title-medium">{{ item.title || item.branch }}</p>
            <p class="ma-0 text-body-small">{{ item.status }} · {{ item.fileCount }} changed files</p>
          </div>
          <v-btn variant="tonal" height="48" @click="navigate({ contribution: item.id })">Review</v-btn>
        </v-sheet>
        <div class="d-flex flex-wrap ga-2">
          <v-btn variant="text" height="48" :disabled="offset === 0" @click="navigate({ offset: Math.max(0, offset - 25) || undefined })">Previous page</v-btn>
          <v-btn variant="text" height="48" :disabled="resource.data.value?.nextOffset == null" @click="navigate({ offset: resource.data.value.nextOffset })">Next page</v-btn>
        </div>
      </template>
      <template v-else-if="entry">
        <v-sheet border rounded="lg" class="pa-4 d-flex flex-column ga-3">
          <p class="ma-0 text-title-medium">{{ entry.title }}</p>
          <p class="ma-0">{{ resource.data.value.repository }} · {{ entry.status }} · {{ entry.fileCount }} changed files</p>
          <p class="ma-0">Contribution: <code>{{ entry.head }}</code><br>Target {{ resource.data.value.targetBranch }}: <code>{{ resource.data.value.targetHead }}</code></p>
          <p v-if="entry.status === 'unresolved'" class="ma-0">Both active and discarded branches exist. Refresh and finish Discard only when both still point to the same reviewed commit. Different heads require inspection by a coding agent.</p>
          <p v-if="resource.data.value.actions?.merge" class="ma-0">{{ resource.data.value.actions.merge }}</p>
          <div class="d-flex flex-wrap ga-2">
            <v-btn v-if="entry.status === 'pending'" color="primary" height="48" :prepend-icon="mdiSourceMerge" :disabled="actionDisabled || Boolean(resource.data.value.actions?.merge) || Boolean(conflict && !repair)" @click="confirm('merge')">Merge into {{ resource.data.value.targetBranch }}</v-btn>
            <v-btn v-if="entry.activeHead && (!entry.discardedHead || entry.discardedHead === entry.activeHead)" variant="outlined" height="48" :prepend-icon="mdiArchiveOutline" :disabled="actionDisabled || Boolean(resource.data.value.actions?.discard)" @click="confirm('discard')">{{ entry.status === 'unresolved' ? 'Finish discard' : 'Discard contribution' }}</v-btn>
          </div>
          <v-alert v-if="conflict" type="warning" variant="tonal">
            These files need repair in this receiving session: {{ conflict.conflictPaths?.join(', ') }}.
            Your original work has a private checkpoint. AI completion does not merge or publish anything.
            <div class="d-flex flex-wrap ga-2 mt-2">
              <Vibe64TemporaryAiFixAction :pending="openingRepair" :disabled="actionDisabled || dashboardContext.assistantFixAllowed === false || typeof dashboardContext.requestTemporaryAi !== 'function'" @click="fixConflict" />
              <v-btn height="48" variant="tonal" :disabled="actionDisabled" @click="reviewRepair">Review resolved conflicts</v-btn>
            </div>
          </v-alert>
          <p v-if="repair" class="ma-0" role="status">Review the repaired merge below, then choose Merge into {{ resource.data.value.targetBranch }}. Only the conflicting paths come from this session; unrelated local changes are excluded.</p>
          <p v-if="uncertain" class="ma-0" role="status">Refresh to inspect the current branches before acting again.</p>
        </v-sheet>
        <p v-if="(repair?.diff || entry.diff)?.truncated" class="ma-0">This diff is truncated. Inspect the complete change in a coding session before merging.</p>
        <pre class="incoming__diff pa-4">{{ (repair?.diff || entry.diff)?.content || 'No file differences from the target.' }}</pre>
      </template>
    </template>
    <v-dialog :model-value="Boolean(confirmation)" max-width="640" :persistent="pending" @update:model-value="!$event && !pending && (confirmation = null)">
      <v-card v-if="confirmation" :title="confirmation.action === 'merge' ? 'Merge contribution?' : 'Discard contribution?'">
        <v-card-text class="incoming">
          <p>{{ confirmation.review.repository }} → {{ confirmation.review.targetBranch }}</p>
          <p><code>{{ confirmation.review.activeHead }}</code></p>
          <p v-if="confirmation.repairReview">Merge the reviewed repair <code>{{ confirmation.repairReview.tree }}</code>. Changed source or remote heads require another review.</p>
          <p>{{ confirmation.action === 'merge' ? 'Integrate this reviewed commit while preserving its history. The contribution branch remains available.' : 'Rename the branch with _discarded appended. Its commits and the author’s checkout are preserved; dependent work remains blocked.' }}</p>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn height="48" :disabled="pending" @click="confirmation = null">Cancel</v-btn>
          <v-btn color="primary" height="48" :disabled="pending || uncertain" @click="apply">{{ pending ? 'Applying…' : confirmation.action === 'merge' ? 'Merge contribution' : 'Discard contribution' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.incoming { min-width: 0; overflow-wrap: anywhere; }
.incoming__summary { min-width: 0; flex: 1 1 14rem; }
.incoming__diff { max-width: 100%; overflow: auto; background: rgb(var(--v-theme-surface-variant)); font-size: 0.85rem; }
</style>
