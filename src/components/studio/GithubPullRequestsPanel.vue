<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { mdiArrowLeft, mdiArrowRight, mdiGithub, mdiMagnify, mdiOpenInNew, mdiPlus, mdiRefresh,
  mdiSourceBranch, mdiSourceMerge, mdiSourcePull, mdiCloseCircleOutline } from "@mdi/js";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import Vibe64AssistantSessionDialog from "@/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";
import Vibe64CreatePullRequestDialog from "@/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue";
import { projectAppPath, projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { focusCreatedVibe64SessionTab } from "@/lib/vibe64SessionFocus.js";
import { vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import { githubProjectAvailable, githubProjectRepositoryName } from "@/lib/vibe64GithubProject.js";
import GithubBrowserTabs from "./GithubBrowserTabs.vue";

const props = defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
const route = useRoute();
const router = useRouter();
const projectSlug = computed(() => projectSlugFromRoute(route));
const repository = computed(() => githubProjectRepositoryName(props.dashboardContext.projectContext));
const available = computed(() => githubProjectAvailable(props.dashboardContext.projectContext));
const active = computed(() => available.value && props.dashboardContext.active !== false);
const number = computed(() => /^\d+$/u.test(String(route.query.pr || "")) ? String(route.query.pr) : "");
const state = computed(() => ["open", "closed", "merged", "all"].includes(route.query.prState) ? route.query.prState : "open");
const search = ref(String(route.query.prSearch || ""));
watch(() => route.query.prSearch, (value) => { search.value = String(value || ""); });
const basePath = computed(() => scopedDevelopmentApiUrl("/api/vibe64/pull-requests", projectSlug.value));
const listQuery = computed(() => ({ state: state.value, search: String(route.query.prSearch || ""),
  ...(route.query.prCursor ? { cursor: route.query.prCursor } : {}) }));
const list = useEndpointResource({
  path: basePath, readQuery: listQuery,
  queryKey: computed(() => ["vibe64.pullRequests", basePath.value, listQuery.value]),
  enabled: computed(() => active.value && !number.value), queryOptions: { retry: false },
  fallbackLoadError: "Pull requests could not load."
});
const detail = useEndpointResource({
  path: computed(() => `${basePath.value}/${number.value}`),
  queryKey: computed(() => ["vibe64.pullRequest", basePath.value, number.value]),
  enabled: computed(() => active.value && Boolean(number.value)), queryOptions: { retry: false },
  fallbackLoadError: "This pull request could not load."
});
const resource = computed(() => number.value ? detail : list);
const pr = computed(() => detail.data.value?.pullRequest);
const description = computed(() => parseLongTextReviewBlocks(pr.value?.body || ""));
const assistantDialog = ref(false);
const createDialog = ref(false);
const selectedSource = computed(() => vibe64SessionPullRequest(props.dashboardContext.session));
const createAvailable = computed(() => Boolean(props.dashboardContext.sessionId) && !selectedSource.value?.number);
const toolbar = computed(() => ({
  ...props.dashboardContext.sessionToolbar,
  createSession: (selection) => props.dashboardContext.sessionToolbar?.createSession?.(selection, { pullRequestNumber: Number(number.value) })
}));
watch(() => route.query.createPullRequest, (value) => {
  if (value && createAvailable.value) {
    createDialog.value = true;
  }
}, { immediate: true });

function navigate(query) {
  return router.push({ query: { ...route.query, ...query } });
}
function filter(nextState = state.value) {
  return navigate({ prState: nextState, prSearch: String(search.value || "").trim() || undefined, prCursor: undefined, pr: undefined });
}
function status(item) {
  if (item.state === "MERGED") return "Merged";
  if (item.state === "CLOSED") return "Closed";
  return item.isDraft ? "Draft" : "Open";
}
function color(item) {
  if (item.state === "MERGED") return "primary";
  if (item.state === "CLOSED") return "error";
  return item.isDraft ? undefined : "success";
}
function icon(item) {
  if (item.state === "MERGED") return mdiSourceMerge;
  return item.state === "CLOSED" ? mdiCloseCircleOutline : mdiSourcePull;
}
function date(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}
async function created(response) {
  if (!response?.sessionId) return;
  await router.push(projectAppPath(projectSlug.value, '/dashboard/changes'));
  void focusCreatedVibe64SessionTab(response.sessionId);
}
async function published(source) {
  await list.reload();
  await navigate({ pr: String(source.number), createPullRequest: undefined });
  await detail.reload();
}
</script>

<template>
  <section class="pull-requests d-flex flex-column ga-5">
    <div class="d-flex align-center justify-space-between flex-wrap ga-2">
      <v-btn
        :prepend-icon="mdiArrowLeft" variant="tonal" size="x-small"
        :to="available && number ? undefined : projectAppPath(projectSlug, '/dashboard/env')"
        @click="available && number && navigate({ pr: undefined })"
      >
        {{ available && number ? 'All pull requests' : 'Back to dashboard' }}
      </v-btn>
      <v-btn
        v-if="available" :prepend-icon="mdiRefresh" variant="text" height="48" :disabled="resource.isFetching.value"
        @click="resource.reload()"
      >
        {{ resource.isFetching.value ? 'Refreshing…' : 'Refresh' }}
      </v-btn>
    </div>
    <v-alert v-if="!available" type="info" variant="tonal">Pull requests are available only for GitHub projects.</v-alert>
    <template v-else>
      <header class="d-flex align-center flex-wrap ga-3 px-2">
        <v-avatar size="48" rounded="lg" color="primary" variant="tonal"><v-icon :icon="mdiGithub" /></v-avatar>
        <div class="pull-requests__heading">
          <h1 class="text-headline-small ma-0">Pull requests</h1>
          <p class="text-body-medium text-medium-emphasis ma-0">{{ repository }}</p>
        </div>
        <v-btn
          v-if="createAvailable" color="primary" variant="tonal" rounded="pill" height="48" :prepend-icon="mdiPlus"
          :disabled="dashboardContext.sourceOperationsSuspended || dashboardContext.assistantDirectAllowed === false" @click="createDialog = true"
        >
          Create from session
        </v-btn>
      </header>
      <GithubBrowserTabs />
      <form v-if="!number" class="d-flex flex-wrap align-center ga-3" @submit.prevent="filter()">
        <v-btn-toggle
          :model-value="state" mandatory divided rounded="pill" color="primary" variant="outlined"
          aria-label="Pull request state" @update:model-value="filter($event)"
        >
          <v-btn v-for="value in ['open', 'closed', 'merged', 'all']" :key="value" :value="value" height="48">{{ value[0].toUpperCase() + value.slice(1) }}</v-btn>
        </v-btn-toggle>
        <v-text-field
          v-model="search" class="pull-requests__search" label="Search pull requests" :prepend-inner-icon="mdiMagnify"
          variant="outlined" rounded="pill" hide-details maxlength="200" clearable @keydown.enter.prevent="filter()" @click:clear="search = ''; filter()"
        >
          <template #append-inner><v-btn :icon="mdiArrowRight" variant="text" size="48" aria-label="Search pull requests" @click="filter()" /></template>
        </v-text-field>
      </form>
      <v-sheet v-if="resource.isInitialLoading.value" rounded="xl" border class="pa-4" aria-label="Loading pull requests" aria-busy="true">
        <v-skeleton-loader v-for="index in 4" :key="index" :type="number ? 'paragraph' : 'list-item-two-line'" />
      </v-sheet>
      <v-alert v-else-if="resource.loadError.value" type="error" variant="tonal" rounded="lg">
        {{ resource.loadError.value }}
        <template #append><v-btn variant="text" height="48" @click="resource.reload()">Retry</v-btn></template>
      </v-alert>
      <template v-else-if="!number">
        <div class="d-flex justify-space-between px-2 text-label-large text-medium-emphasis">
          <span>{{ list.data.value?.total || 0 }} pull requests</span><span>Recently updated</span>
        </div>
        <v-list v-if="list.data.value?.pullRequests?.length" class="pa-0" rounded="xl" border slim aria-label="GitHub pull requests">
          <template v-for="(item, index) in list.data.value.pullRequests" :key="item.number">
            <v-divider v-if="index" />
            <v-list-item class="py-3" :active="false" :to="{ query: { ...$route.query, pr: String(item.number) } }">
              <template #prepend><v-icon :icon="icon(item)" :color="color(item)" /></template>
              <v-list-item-title class="text-title-medium text-wrap">{{ item.title }}</v-list-item-title>
              <div class="text-body-small text-medium-emphasis mt-1">#{{ item.number }} · {{ status(item) }} · {{ item.author?.login }} · {{ date(item.updatedAt) }}</div>
              <div class="text-body-small text-medium-emphasis mt-1 pull-requests__branch">{{ item.headRefName }} → {{ item.baseRefName }}</div>
            </v-list-item>
          </template>
        </v-list>
        <v-sheet v-else rounded="xl" color="surface-light" class="pa-8 text-center">
          <v-icon :icon="mdiSourcePull" size="40" class="mb-3" />
          <h2 class="text-title-large mb-2">No pull requests here</h2>
          <p class="text-body-medium text-medium-emphasis">Try another filter, or turn your session into a pull request.</p>
        </v-sheet>
        <div class="d-flex justify-end ga-2">
          <v-btn v-if="$route.query.prCursor" variant="text" height="48" @click="navigate({ prCursor: undefined })">First page</v-btn>
          <v-btn
            v-if="list.data.value?.pageInfo?.hasNextPage" variant="tonal" height="48" :append-icon="mdiArrowRight"
            @click="navigate({ prCursor: list.data.value.pageInfo.endCursor })"
          >
            Next page
          </v-btn>
        </div>
      </template>
      <template v-else-if="pr">
        <div class="px-2">
          <div class="d-flex align-center flex-wrap ga-2 mb-3">
            <v-chip :color="color(pr)" :prepend-icon="icon(pr)" variant="tonal">{{ status(pr) }}</v-chip>
            <span class="text-body-medium text-medium-emphasis">#{{ pr.number }} · {{ pr.author?.login }}</span>
          </div>
          <h2 class="text-headline-small mb-3">{{ pr.title }}</h2>
          <div class="d-flex flex-wrap ga-3 text-body-small text-medium-emphasis">
            <span>{{ pr.changedFiles }} files changed</span><span class="text-success">+{{ pr.additions }}</span><span class="text-error">−{{ pr.deletions }}</span>
          </div>
        </div>
        <v-sheet rounded="xl" color="surface-light" class="pa-5 d-flex flex-column ga-4">
          <div class="d-flex align-start ga-3">
            <v-icon :icon="mdiSourceBranch" color="primary" class="mt-1" />
            <div class="pull-requests__branch">
              <div class="text-label-large">Session source · Save destination</div>
              <div class="text-body-medium mt-1">{{ pr.headRepository?.nameWithOwner || 'Deleted repository' }}:{{ pr.headRefName }}</div>
              <div class="text-body-small text-medium-emphasis mt-1">Proposed into {{ repository }}:{{ pr.baseRefName }}</div>
            </div>
          </div>
          <p class="text-body-medium ma-0">Open an isolated session with this PR’s changes and description. Save publishes further work to its source branch.</p>
          <p v-if="pr.unavailableReason" class="text-body-medium ma-0">{{ pr.unavailableReason }}</p>
          <p v-else-if="!toolbar.canCreateSession" class="text-body-medium ma-0">{{ toolbar.createSessionTitle }}</p>
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              color="primary" rounded="pill" height="48" :prepend-icon="mdiSourcePull"
              :disabled="Boolean(pr.unavailableReason) || !toolbar.canCreateSession || toolbar.createSessionRunning"
              @click="assistantDialog = true"
            >
              Open as session
            </v-btn>
            <v-btn :href="pr.url" target="_blank" rel="noopener noreferrer" variant="text" height="48" :append-icon="mdiOpenInNew">View on GitHub</v-btn>
          </div>
        </v-sheet>
        <v-sheet rounded="xl" border class="pa-5 pull-requests__description">
          <h3 class="text-title-medium mb-4">Description</h3>
          <LongTextPreviewBlocks v-if="pr.body" :blocks="description" />
          <p v-else class="text-body-medium text-medium-emphasis ma-0">No description provided.</p>
        </v-sheet>
      </template>
    </template>
    <Vibe64AssistantSessionDialog v-if="available && assistantDialog" v-model="assistantDialog" :toolbar="toolbar" @created="created" />
    <Vibe64CreatePullRequestDialog v-if="available" v-model="createDialog" :dashboard-context="dashboardContext" @created="published" />
  </section>
</template>

<style scoped>
.pull-requests { width: 100%; min-width: 0; padding-bottom: 1rem; }
.pull-requests__heading { flex: 1; min-width: 12rem; overflow-wrap: anywhere; }
.pull-requests__search { flex: 1 1 16rem; min-width: 0; }
.pull-requests__branch, .pull-requests__description { min-width: 0; overflow-wrap: anywhere; }
.pull-requests__description { overflow: auto; }
</style>
