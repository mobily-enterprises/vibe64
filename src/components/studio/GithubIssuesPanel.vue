<script setup>
import { computed, ref, shallowRef, watch } from "vue";
import { mdiArrowLeft, mdiArrowRight, mdiCheck, mdiCommentOutline, mdiGithub,
  mdiOpenInNew, mdiRecordCircleOutline, mdiRefresh, mdiRestore, mdiMagnify, mdiPlus, mdiLabelOutline } from "@mdi/js";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";
import { useVibe64Issues } from "@/composables/useVibe64Issues.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import GithubIssueEditorDialog from "./GithubIssueEditorDialog.vue";
import GithubLabelChip from "./GithubLabelChip.vue";
import GithubBrowserTabs from "./GithubBrowserTabs.vue";

const props = defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
const { available, repository, projectSlug, basePath, list, detail, issue, number, state, searchDraft,
  draft, pending, commentCursor, navigate, filter, mutate, issueSaved } = useVibe64Issues(computed(() => props.dashboardContext));
const editorOpen = ref(false);
const editorIssue = shallowRef(null);
watch(projectSlug, () => { editorOpen.value = false; editorIssue.value = null; });
function openEditor(selectedIssue = null) {
  editorIssue.value = selectedIssue;
  editorOpen.value = true;
}
const resource = computed(() => number.value ? detail : list);
const description = computed(() => parseLongTextReviewBlocks(issue.value?.body || ""));
const comments = computed(() => (issue.value?.comments?.nodes || []).map((comment) => ({
  ...comment, blocks: parseLongTextReviewBlocks(comment.body || "")
})));
const canChangeState = computed(() => issue.value?.state === "OPEN" ? issue.value.viewerCanClose : issue.value?.viewerCanReopen);
function date(value) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
</script>

<template>
  <section class="issues-panel d-flex flex-column ga-4">
    <div class="d-flex align-center justify-space-between flex-wrap ga-2">
      <v-btn
        :prepend-icon="mdiArrowLeft" variant="tonal" size="x-small"
        :to="available && number ? undefined : projectAppPath(projectSlug, '/dashboard/env')"
        @click="available && number && navigate({ issue: undefined })"
      >
        {{ available && number ? 'All issues' : 'Back to dashboard' }}
      </v-btn>
      <v-btn
        v-if="available"
        :prepend-icon="mdiRefresh" variant="text" height="48"
        :disabled="resource.isFetching.value || Boolean(pending)" @click="resource.reload()"
      >
        {{ resource.isFetching.value ? 'Refreshing…' : 'Refresh' }}
      </v-btn>
    </div>

    <v-alert v-if="!available" variant="tonal" type="info">Issues are available only for GitHub projects.</v-alert>
    <template v-else>
      <header class="d-flex align-center flex-wrap ga-3">
        <v-avatar color="primary" variant="tonal" rounded="lg" size="48"><v-icon :icon="mdiGithub" /></v-avatar>
        <div class="issues-panel__heading">
          <h1 class="text-headline-small ma-0">Issues</h1>
          <p class="text-body-medium text-medium-emphasis ma-0 issues-panel__repository">{{ repository }}</p>
        </div>
        <v-btn :prepend-icon="mdiPlus" color="primary" variant="tonal" rounded="pill" height="48" @click="openEditor()">New issue</v-btn>
      </header>

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
            v-model="searchDraft" class="issues-panel__search" label="Search issues" placeholder="Title or description"
            :prepend-inner-icon="mdiMagnify" variant="outlined" rounded="pill" hide-details maxlength="200" clearable
            @keydown.enter.prevent="filter()"
            @click:clear="searchDraft = ''; filter()"
          >
            <template #append-inner><v-btn :icon="mdiArrowRight" variant="text" size="48" aria-label="Search issues" @click="filter()" /></template>
          </v-text-field>
        </form>
      </template>

      <v-sheet v-if="resource.isInitialLoading.value" rounded="xl" border class="pa-4" aria-label="Loading issues" aria-busy="true">
        <v-skeleton-loader v-for="index in 4" :key="index" :type="number ? 'paragraph' : 'list-item-two-line'" />
      </v-sheet>
      <v-alert v-else-if="resource.loadError.value" type="error" variant="tonal" rounded="lg">
        {{ resource.loadError.value }}
        <template #append><v-btn variant="text" height="48" :disabled="resource.isFetching.value" @click="resource.reload()">Retry</v-btn></template>
      </v-alert>

      <template v-else-if="!number">
        <div class="d-flex align-center justify-space-between px-2 text-label-large text-medium-emphasis">
          <span>{{ list.data.value?.total || 0 }} {{ list.data.value?.total === 1 ? 'issue' : 'issues' }}</span>
          <span>Recently updated</span>
        </div>
        <v-list v-if="list.data.value?.issues?.length" class="pa-0" lines="two" rounded="xl" border slim aria-label="GitHub issues">
          <template v-for="(item, index) in list.data.value.issues" :key="item.number">
            <v-divider v-if="index" />
            <v-list-item class="py-3" :active="false" :to="{ query: { ...$route.query, issue: String(item.number) } }">
              <template #prepend>
                <v-icon
                  :icon="item.state === 'OPEN' ? mdiRecordCircleOutline : mdiCheck"
                  :color="item.state === 'OPEN' ? 'success' : 'primary'" :aria-label="item.state === 'OPEN' ? 'Open' : 'Closed'"
                />
              </template>
              <v-list-item-title class="text-title-medium text-wrap">{{ item.title }}</v-list-item-title>
              <v-list-item-subtitle class="text-body-small mt-1">
                #{{ item.number }} · {{ item.state === 'OPEN' ? 'Open' : 'Closed' }} · {{ date(item.updatedAt) }}
              </v-list-item-subtitle>
              <div v-if="item.labels?.nodes?.length" class="d-flex flex-wrap ga-1 mt-2">
                <GithubLabelChip v-for="label in item.labels.nodes" :key="label.name" :label="label" />
                <span v-if="item.labels.totalCount > item.labels.nodes.length" class="text-label-small align-self-center">+{{ item.labels.totalCount - item.labels.nodes.length }}</span>
              </div>
              <template #append>
                <span
                  class="d-flex align-center ga-1 ml-3 text-label-medium text-medium-emphasis"
                  :aria-label="`${item.comments.totalCount} comments`"
                ><v-icon :icon="mdiCommentOutline" size="18" />{{ item.comments.totalCount }}</span>
              </template>
            </v-list-item>
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
        <div>
          <div class="d-flex align-center flex-wrap ga-2 mb-3">
            <v-chip :prepend-icon="issue.state === 'OPEN' ? mdiRecordCircleOutline : mdiCheck" :color="issue.state === 'OPEN' ? 'success' : 'primary'" variant="tonal">
              {{ issue.state === 'OPEN' ? 'Open' : 'Closed' }}
            </v-chip>
            <span class="text-label-large text-medium-emphasis">#{{ issue.number }}</span>
            <v-spacer />
            <v-btn :href="issue.url" target="_blank" rel="noopener noreferrer" :append-icon="mdiOpenInNew" variant="text" height="48">GitHub</v-btn>
          </div>
          <h2 class="text-title-large mb-2 issues-panel__title">{{ issue.title }}</h2>
          <p class="text-body-small text-medium-emphasis mb-0">{{ issue.author?.login || 'Deleted user' }} opened this on {{ date(issue.createdAt) }}</p>
          <div class="d-flex align-center flex-wrap ga-2 mt-3">
            <GithubLabelChip v-for="label in issue.labels?.nodes || []" :key="label.name" :label="label" />
            <span v-if="!issue.labels?.nodes?.length" class="text-body-small text-medium-emphasis">No labels</span>
            <v-btn v-if="issue.canEditLabels" :prepend-icon="mdiLabelOutline" variant="text" height="48" @click="openEditor(issue)">Edit labels</v-btn>
          </div>
        </div>

        <v-sheet border rounded="xl" class="pa-5 issues-panel__markdown">
          <LongTextPreviewBlocks v-if="description.length" :blocks="description" />
          <p v-else class="text-body-medium text-medium-emphasis ma-0">No description provided.</p>
        </v-sheet>
        <div class="d-flex align-center justify-space-between flex-wrap ga-2 px-2">
          <h3 class="text-title-medium">Comments <span class="text-medium-emphasis">{{ issue.comments.totalCount }}</span></h3>
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
            <v-sheet color="surface-light" rounded="xl" class="pa-4 issues-panel__markdown"><LongTextPreviewBlocks :blocks="comment.blocks" /></v-sheet>
          </div>
        </article>
        <v-divider />
        <form class="d-flex flex-column ga-3" @submit.prevent="mutate('comment')">
          <p v-if="issue.locked" class="text-body-small text-medium-emphasis ma-0">This conversation is locked. GitHub limits comments to permitted collaborators.</p>
          <v-textarea
            v-model="draft" label="Add a comment" placeholder="Share an update or ask a question…" variant="outlined" rounded="lg"
            rows="4" auto-grow :disabled="Boolean(pending)" :counter="draft.length > 65000 ? 65536 : undefined"
            :error-messages="draft.length > 65536 ? 'Keep your comment under 65,536 characters.' : []" hint="Markdown supported" persistent-hint
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
    <GithubIssueEditorDialog
      v-if="available" v-model="editorOpen" :base-path="basePath" :issue="editorIssue" @saved="issueSaved"
    />
  </section>
</template>

<style scoped>
.issues-panel { width: 100%; min-width: 0; }
.issues-panel__heading, .issues-panel__comment-body { min-width: 0; flex: 1; }
.issues-panel__search { flex: 1 1 16rem; min-width: 0; }
.issues-panel__title, .issues-panel__repository, .issues-panel__markdown { overflow-wrap: anywhere; }
.issues-panel__markdown { min-width: 0; overflow-x: auto; }
</style>
