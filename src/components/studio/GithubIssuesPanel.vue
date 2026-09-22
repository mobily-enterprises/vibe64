<script setup>
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";
import { mdiArrowLeft, mdiArrowRight, mdiCheck, mdiCommentOutline,
  mdiOpenInNew, mdiRecordCircleOutline, mdiRefresh, mdiRestore, mdiMagnify, mdiPlus, mdiLabelOutline, mdiPencilOutline } from "@mdi/js";
import { useVibe64Issues } from "@/composables/useVibe64Issues.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import GithubIssueEditorDialog from "./GithubIssueEditorDialog.vue";
import GithubCommentEditor from "./GithubCommentEditor.vue";
import GithubBulkLabelsDialog from "./GithubBulkLabelsDialog.vue";
import GithubLabelChip from "./GithubLabelChip.vue";
import GithubNewLabelButton from "./GithubNewLabelButton.vue";
import GithubBrowserTabs from "./GithubBrowserTabs.vue";
import GithubMentionTextarea from "./GithubMentionTextarea.vue";
import GithubMarkdown from "./GithubMarkdown.vue";

const props = defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
const { available, projectSlug, basePath, list, detail, labelCatalog, issue, number, state, searchDraft, selectedLabels,
  draft, pending, comments, commentCount, commentCursor, navigate, filter, mutate, issueSaved, issueUpdated, retryComment } = useVibe64Issues(computed(() => props.dashboardContext));
const route = useRoute();
const bulkOpen = ref(false);
const selectedNumbers = ref([]);
const visibleNumbers = computed(() => (list.data.value?.issues || []).map((item) => item.number));
const allSelected = computed(() => visibleNumbers.value.length > 0 && visibleNumbers.value.every((value) => selectedNumbers.value.includes(value)));
watch(() => [basePath.value, number.value, route.query.issueSearch, route.query.issueState, route.query.issueCursor, route.query.issueLabel], () => {
  selectedNumbers.value = [];
  bulkOpen.value = false;
}, { deep: true });
function labelsApplied({ number: issueNumber, basePath: requestBasePath }) {
  if (basePath.value === requestBasePath) selectedNumbers.value = selectedNumbers.value.filter((value) => value !== issueNumber);
}
const editorOpen = ref(false);
const editorMode = ref("create");
const editorIssue = shallowRef(null);
watch([basePath, number], () => {
  editorOpen.value = false;
  editorIssue.value = null;
  editorMode.value = "create";
});
function openEditor(selectedIssue = null, mode = "create") {
  editorMode.value = mode;
  editorIssue.value = selectedIssue;
  editorOpen.value = true;
}
const resource = computed(() => number.value ? detail : list);
const canChangeState = computed(() => issue.value?.state === "OPEN" ? issue.value.viewerCanClose : issue.value?.viewerCanReopen);
function date(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
</script>

<template>
  <section class="issues-panel d-flex flex-column ga-2">
    <div class="issues-panel__toolbar d-flex align-center ga-2">
      <v-btn
        :prepend-icon="mdiArrowLeft" variant="tonal" size="x-small"
        :to="available && number ? undefined : projectAppPath(projectSlug, '/dashboard/env')"
        @click="available && number && navigate({ issue: undefined })"
      >
        {{ available && number ? 'All issues' : 'Back to dashboard' }}
      </v-btn>
      <v-spacer />
      <v-btn
        v-if="available"
        :prepend-icon="mdiRefresh" variant="text" size="small" height="48"
        :disabled="resource.isFetching.value || Boolean(pending)" @click="resource.reload()"
      >
        {{ resource.isFetching.value ? 'Refreshing…' : 'Refresh' }}
      </v-btn>
      <v-btn
        v-if="available" :prepend-icon="mdiPlus" color="primary" variant="tonal"
        rounded="pill" size="small" height="48" @click="openEditor()"
      >New issue</v-btn>
    </div>

    <v-alert v-if="!available" variant="tonal" type="info">Issues are available only for GitHub projects.</v-alert>
    <template v-else>
      <GithubBrowserTabs />

      <template v-if="!number">
        <form class="d-flex flex-wrap align-center ga-3" @submit.prevent="filter()">
          <v-btn-toggle
            :model-value="state" mandatory divided rounded="pill" color="primary" variant="outlined"
            aria-label="Issue state" @update:model-value="filter($event)"
          >
            <v-btn value="open" height="48">Open</v-btn>
            <v-btn value="closed" height="48">Closed</v-btn>
            <v-btn value="all" height="48">All</v-btn>
          </v-btn-toggle>
          <v-text-field
            v-model="searchDraft" class="issues-panel__search" label="Search issues" placeholder="Number, title or description"
            :prepend-inner-icon="mdiMagnify" variant="outlined" rounded="pill" hide-details maxlength="200" clearable
            @keydown.enter.prevent="filter()"
            @click:clear="searchDraft = ''; filter()"
          >
            <template #append-inner><v-btn :icon="mdiArrowRight" variant="text" size="48" aria-label="Search issues" @click="filter()" /></template>
          </v-text-field>
        </form>
        <div class="issues-panel__labels d-flex flex-wrap align-start ga-2">
          <v-skeleton-loader v-if="labelCatalog.isInitialLoading.value" class="issues-panel__label-filter" type="list-item" height="80" aria-label="Loading label filters" aria-busy="true" />
          <v-alert v-else-if="labelCatalog.loadError.value" class="issues-panel__label-filter" type="error" variant="tonal" rounded="lg">
            {{ labelCatalog.loadError.value }}
            <template #append><v-btn variant="text" height="48" @click="labelCatalog.reload()">Retry labels</v-btn></template>
          </v-alert>
          <v-autocomplete
            v-else :model-value="selectedLabels" :items="labelCatalog.data.value?.labels || []" class="issues-panel__label-filter"
            item-title="name" item-value="name" multiple chips closable-chips clearable
            label="Filter by labels" :prepend-inner-icon="mdiLabelOutline" variant="outlined" rounded="lg"
            :menu-props="{ maxHeight: 320 }" hint="Match all selected labels." persistent-hint
            no-data-text="No matching labels" @update:model-value="filter(state, $event)"
          >
            <template #chip="{ props: chipProps, item }"><GithubLabelChip v-bind="chipProps" :label="item" /></template>
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" min-height="48">
                <template #title><GithubLabelChip :label="item" /></template>
                <template #subtitle>{{ item.description }}</template>
              </v-list-item>
            </template>
          </v-autocomplete>
          <div v-if="labelCatalog.data.value?.canCreateLabels" class="d-flex justify-end">
            <GithubNewLabelButton :base-path="basePath" :labels="labelCatalog.data.value.labels" />
          </div>
        </div>
      </template>

      <v-sheet v-if="resource.isInitialLoading.value" rounded="xl" border class="pa-4" aria-label="Loading issues" aria-busy="true">
        <v-skeleton-loader v-for="index in 4" :key="index" :type="number ? 'paragraph' : 'list-item-two-line'" />
      </v-sheet>
      <v-alert v-else-if="resource.loadError.value && (!number || !issue)" type="error" variant="tonal" rounded="lg">
        {{ resource.loadError.value }}
        <template #append><v-btn variant="text" height="48" :disabled="resource.isFetching.value" @click="resource.reload()">Retry</v-btn></template>
      </v-alert>

      <template v-else-if="!number">
        <p v-if="list.data.value?.searchLimit && list.data.value.total > list.data.value.searchLimit" class="text-body-small text-medium-emphasis ma-0">
          GitHub returns up to 1,000 matches for text searches or multiple labels. Narrow the filters to see more specific results.
        </p>
        <div class="d-flex align-center justify-space-between px-2 text-label-large text-medium-emphasis">
          <span>{{ list.data.value?.total || 0 }} {{ list.data.value?.total === 1 ? 'issue' : 'issues' }}</span>
          <span>Recently updated</span>
        </div>
        <div v-if="labelCatalog.data.value?.canEditLabels && visibleNumbers.length" class="d-flex flex-wrap align-center ga-2">
          <v-checkbox-btn
            :model-value="allSelected" :indeterminate="selectedNumbers.length > 0 && !allSelected"
            label="Select all on this page" class="issues-panel__select-all" min-height="48"
            @update:model-value="selectedNumbers = $event ? [...visibleNumbers] : []"
          />
          <span class="text-label-large" role="status">{{ selectedNumbers.length }} selected</span>
          <v-btn variant="tonal" height="48" :disabled="!selectedNumbers.length" @click="bulkOpen = true">Bulk edit labels</v-btn>
          <v-btn v-if="selectedNumbers.length" variant="text" height="48" @click="selectedNumbers = []">Clear selection</v-btn>
        </div>
        <v-list v-if="list.data.value?.issues?.length" class="pa-0" density="compact" lines="two" rounded="xl" border slim aria-label="GitHub issues">
          <template v-for="(item, index) in list.data.value.issues" :key="item.number">
            <v-divider v-if="index" />
            <div class="d-flex align-center">
              <v-checkbox-btn
                v-if="labelCatalog.data.value?.canEditLabels" v-model="selectedNumbers" :value="item.number"
                :aria-label="`Select issue #${item.number}`" class="flex-grow-0 ml-2" min-width="48" min-height="48"
              />
              <v-list-item class="py-2 flex-grow-1" :active="false" :to="{ query: { ...$route.query, issue: String(item.number) } }">
                <template #prepend>
                  <v-icon
                    :icon="item.state === 'OPEN' ? mdiRecordCircleOutline : mdiCheck"
                    :color="item.state === 'OPEN' ? 'success' : 'primary'" :aria-label="item.state === 'OPEN' ? 'Open' : 'Closed'"
                  />
                </template>
                <div class="d-flex flex-wrap align-center ga-1">
                  <v-list-item-title class="issues-panel__item-title text-title-medium text-wrap">{{ item.title }}</v-list-item-title>
                  <GithubLabelChip v-for="label in item.labels?.nodes || []" :key="label.name" :label="label" />
                  <span v-if="item.labels?.totalCount > item.labels?.nodes?.length" class="text-label-small">+{{ item.labels.totalCount - item.labels.nodes.length }}</span>
                </div>
                <v-list-item-subtitle class="text-body-small mt-1">
                  #{{ item.number }} · {{ item.state === 'OPEN' ? 'Open' : 'Closed' }} · {{ date(item.updatedAt) }}
                </v-list-item-subtitle>
                <template #append>
                  <span
                    class="d-flex align-center ga-1 ml-3 text-label-medium text-medium-emphasis"
                    :aria-label="`${item.comments.totalCount} comments`"
                  ><v-icon :icon="mdiCommentOutline" size="18" />{{ item.comments.totalCount }}</span>
                </template>
              </v-list-item>
            </div>
          </template>
        </v-list>
        <v-sheet v-else rounded="xl" color="surface-light" class="pa-8 text-center">
          <v-icon :icon="mdiRecordCircleOutline" size="40" class="mb-3" />
          <p class="text-title-medium mb-1">No issues here</p>
          <p class="text-body-medium text-medium-emphasis ma-0">Try a different filter or search.</p>
        </v-sheet>
        <div class="d-flex justify-space-between ga-2">
          <v-btn v-if="$route.query.issueCursor" variant="text" height="48" @click="navigate({ issueCursor: undefined })">First page</v-btn>
          <v-spacer />
          <v-btn
            v-if="list.data.value?.pageInfo?.hasNextPage" variant="tonal" height="48" :append-icon="mdiArrowRight"
            @click="navigate({ issueCursor: list.data.value.pageInfo.endCursor })"
          >
            Next page
          </v-btn>
        </div>
      </template>

      <template v-else-if="issue">
        <v-alert v-if="detail.loadError.value" type="error" variant="tonal" rounded="lg">
          {{ detail.loadError.value }}
          <template #append><v-btn variant="text" height="48" :disabled="detail.isFetching.value" @click="detail.reload()">Refresh</v-btn></template>
        </v-alert>
        <div>
          <div class="d-flex align-center flex-wrap ga-2 mb-3">
            <v-chip :prepend-icon="issue.state === 'OPEN' ? mdiRecordCircleOutline : mdiCheck" :color="issue.state === 'OPEN' ? 'success' : 'primary'" variant="tonal">
              {{ issue.state === 'OPEN' ? 'Open' : 'Closed' }}
            </v-chip>
            <span class="text-label-large text-medium-emphasis">#{{ issue.number }}</span>
            <v-spacer />
            <v-btn v-if="issue.viewerCanUpdate" :prepend-icon="mdiPencilOutline" variant="text" height="48" @click="openEditor(issue, 'content')">Edit issue</v-btn>
            <v-btn :href="issue.url" target="_blank" rel="noopener noreferrer" :append-icon="mdiOpenInNew" variant="text" height="48">GitHub</v-btn>
          </div>
          <h2 class="text-title-large mb-2 issues-panel__title">{{ issue.title }}</h2>
          <p class="text-body-small text-medium-emphasis mb-0">{{ issue.author?.login || 'Deleted user' }} opened this on {{ date(issue.createdAt) }}</p>
          <div class="d-flex align-center flex-wrap ga-2 mt-3">
            <GithubLabelChip v-for="label in issue.labels?.nodes || []" :key="label.name" :label="label" />
            <span v-if="!issue.labels?.nodes?.length" class="text-body-small text-medium-emphasis">No labels</span>
            <v-btn v-if="issue.canEditLabels" :prepend-icon="mdiLabelOutline" variant="text" height="48" @click="openEditor(issue, 'labels')">Edit labels</v-btn>
          </div>
        </div>

        <v-sheet border rounded="xl" class="pa-5 issues-panel__markdown">
          <GithubMarkdown v-if="issue.body || issue.bodyHTML" :text="issue.body" :html="issue.bodyHTML" />
          <p v-else class="text-body-medium text-medium-emphasis ma-0">No description provided.</p>
        </v-sheet>
        <div class="d-flex align-center justify-space-between flex-wrap ga-2 px-2">
          <h3 class="text-title-medium">Comments <span class="text-medium-emphasis">{{ commentCount }}</span></h3>
          <div class="d-flex flex-wrap ga-2">
            <v-btn v-if="commentCursor" height="48" variant="text" @click="commentCursor = ''">Latest comments</v-btn>
            <v-btn
              v-if="issue.comments.pageInfo.hasPreviousPage" height="48" variant="text"
              @click="commentCursor = issue.comments.pageInfo.startCursor"
            >
              Older comments
            </v-btn>
          </div>
        </div>
        <p v-if="!comments.length" class="text-body-medium text-medium-emphasis px-2">No comments yet. Start the conversation.</p>
        <article v-for="comment in comments" :key="comment.id" class="issues-panel__comment d-flex ga-3">
          <v-avatar color="primary" variant="tonal" size="36" class="mt-1 text-label-large" aria-hidden="true">{{ (comment.author?.login || '?').slice(0, 1).toUpperCase() }}</v-avatar>
          <div class="issues-panel__comment-body">
            <div class="d-flex flex-wrap align-center ga-2 mb-2">
              <span class="text-label-large">{{ comment.author?.login || 'Deleted user' }}</span>
              <time class="text-body-small text-medium-emphasis" :datetime="comment.createdAt">{{ date(comment.createdAt) }}</time>
            </div>
            <GithubCommentEditor :key="`${basePath}:${issue.number}:${comment.id}`" :comment="comment" :issue="issue" :base-path="basePath" @saved="issueUpdated">
              <v-sheet color="surface-light" rounded="xl" class="pa-4 issues-panel__markdown">
                <GithubMarkdown :text="comment.body" :html="comment.bodyHTML" />
              </v-sheet>
            </GithubCommentEditor>
            <div v-if="comment.delivery && comment.delivery !== 'sent'" class="d-flex flex-wrap align-center ga-2 mt-1" aria-live="polite">
              <span v-if="comment.delivery === 'sending'" class="text-body-small text-medium-emphasis">Posting…</span>
              <template v-else>
                <span class="text-body-small text-error">{{ comment.error }}</span>
                <v-btn variant="text" height="48" :disabled="Boolean(pending)" @click="retryComment(comment.id)">Retry</v-btn>
              </template>
            </div>
          </div>
        </article>
        <v-divider />
        <form class="d-flex flex-column ga-3" @submit.prevent="mutate('comment')">
          <p v-if="issue.locked" class="text-body-small text-medium-emphasis ma-0">This conversation is locked. GitHub limits comments to permitted collaborators.</p>
          <GithubMentionTextarea
            v-model="draft" label="Add a comment" placeholder="Share an update or ask a question…" variant="outlined" rounded="lg"
            rows="4" auto-grow :counter="draft.length > 65000 ? 65536 : undefined"
            :error-messages="draft.length > 65536 ? 'Keep your comment under 65,536 characters.' : []"
            :base-path="basePath" :issue="issue" :enabled="dashboardContext.active !== false"
          />
          <div class="d-flex flex-wrap align-center justify-space-between ga-3">
            <v-btn
              variant="tonal" height="48" :prepend-icon="issue.state === 'OPEN' ? mdiCheck : mdiRestore"
              :disabled="!canChangeState || Boolean(pending)" :title="canChangeState ? '' : 'Your GitHub account cannot change this issue’s state.'"
              @click="mutate('state')"
            >
              {{ pending === 'state' ? 'Updating…' : issue.state === 'OPEN' ? 'Close issue' : 'Reopen issue' }}
            </v-btn>
            <v-btn
              type="submit" color="primary" variant="flat" rounded="pill" height="48"
              :disabled="!draft.trim() || draft.length > 65536 || Boolean(pending)"
            >
              {{ pending === 'comment' ? 'Posting…' : 'Comment' }}
            </v-btn>
          </div>
        </form>
      </template>
    </template>
    <GithubBulkLabelsDialog
      v-if="available" :key="basePath" v-model="bulkOpen" :base-path="basePath" :numbers="selectedNumbers"
      :labels="labelCatalog.data.value?.labels || []" :can-create-labels="labelCatalog.data.value?.canCreateLabels === true" @applied="labelsApplied"
    />
    <GithubIssueEditorDialog
      v-if="available" v-model="editorOpen" :base-path="basePath" :issue="editorIssue" :mode="editorMode" @saved="issueSaved"
    />
  </section>
</template>

<style scoped>
.issues-panel { width: 100%; min-width: 0; }
.issues-panel__select-all { flex: 0 0 auto; }
.issues-panel__comment-body { min-width: 0; flex: 1; }
.issues-panel__search { flex: 1 1 16rem; min-width: 0; }
.issues-panel__labels { min-width: 0; }
.issues-panel__label-filter { flex: 1 1 16rem; min-width: 0; }
.issues-panel__item-title { min-width: 0; overflow-wrap: anywhere; }
.issues-panel__title, .issues-panel__markdown { overflow-wrap: anywhere; }
.issues-panel__markdown { min-width: 0; overflow-x: auto; }
</style>
