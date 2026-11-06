<script setup>
// One page beside the chat, as Preview shows an app: a sandboxed frame on a
// short-lived viewing link, with Open in new tab, its kept versions, and
// archive or restore.
import { computed, onMounted, ref, watch } from "vue";
import { useTheme } from "vuetify";
import {
  mdiArchiveArrowDownOutline,
  mdiArchiveArrowUpOutline,
  mdiArrowLeft,
  mdiHistory,
  mdiOpenInNew,
  mdiRefresh
} from "@mdi/js";
import { archivePage, openPageView, pageTime, restorePage, restorePageVersion } from "./pagesRequests.js";

// The page's frame may run its own scripts and forms, never as Vibe64.
const PAGE_SANDBOX = "allow-scripts allow-forms allow-modals";

const props = defineProps({
  pagesPath: { type: String, required: true },
  pageId: { type: String, required: true },
  projectSlug: { type: String, required: true }
});

const vuetifyTheme = useTheme();
const themeName = computed(() => vuetifyTheme.current.value.dark ? "dark" : "light");
const page = ref(null);
const viewPath = ref("");
const error = ref("");
const busy = ref(false);
const frameKey = ref(0);

const versions = computed(() => [...(page.value?.versions || [])].reverse());

async function open() {
  if (!props.projectSlug || !props.pageId) return;
  try {
    const answer = await openPageView(props.projectSlug, props.pageId, themeName.value);
    page.value = answer.page;
    viewPath.value = answer.viewPath;
    frameKey.value += 1;
    error.value = "";
  } catch (cause) {
    viewPath.value = "";
    error.value = cause?.message || "The page could not open.";
  }
}

// A new tab gets its own viewing link; it opens blank first so the browser
// allows it, then leaves no way back to this window.
async function openInNewTab() {
  const tab = window.open("", "_blank");
  if (!tab) {
    error.value = "The browser blocked the new tab. Allow pop-ups for Vibe64 and try again.";
    return;
  }
  tab.opener = null;
  try {
    const answer = await openPageView(props.projectSlug, props.pageId, themeName.value);
    tab.location.href = answer.viewPath;
  } catch (cause) {
    tab.close();
    error.value = cause?.message || "The page could not open.";
  }
}

async function change(operation) {
  busy.value = true;
  try {
    page.value = (await operation()).page;
    error.value = "";
    await open();
  } catch (cause) {
    error.value = cause?.message || "The page could not change.";
  } finally {
    busy.value = false;
  }
}

onMounted(open);
watch(() => [props.projectSlug, props.pageId, themeName.value], open);
</script>

<template>
  <section class="vibe64-page-viewer" data-test="page-viewer" :data-page-id="pageId">
    <header class="vibe64-page-viewer__toolbar">
      <v-btn :prepend-icon="mdiArrowLeft" :to="pagesPath" color="primary" rounded="pill" variant="text">All pages</v-btn>
      <div class="vibe64-page-viewer__heading">
        <h1 class="vibe64-page-viewer__title text-title-medium" data-test="page-viewer-title">{{ page?.title || "Page" }}</h1>
        <span v-if="page" class="vibe64-page-viewer__meta text-body-small">
          Version {{ page.version }} · updated {{ pageTime(page.updatedAt) }}<template v-if="page.updatedBy?.name"> by {{ page.updatedBy.name }}</template>
        </span>
      </div>
      <v-chip v-if="page?.archived" size="small" variant="tonal" data-test="page-viewer-archived">Archived</v-chip>
      <div class="vibe64-page-viewer__actions">
        <v-btn :icon="mdiRefresh" aria-label="Reload page" title="Reload" variant="text" @click="open" />
        <v-menu v-if="versions.length > 1" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" :disabled="busy" :prepend-icon="mdiHistory" variant="text" data-test="page-versions">Versions</v-btn>
          </template>
          <v-list density="compact" min-width="260">
            <v-list-subheader>Kept versions</v-list-subheader>
            <v-list-item
              v-for="version in versions"
              :key="version.number"
              :subtitle="`${pageTime(version.createdAt)}${version.createdBy?.name ? ` · ${version.createdBy.name}` : ''}`"
              :title="`Version ${version.number}${version.restoredFrom ? `, back from ${version.restoredFrom}` : ''}${version.number === page.version ? ' (shown)' : ''}`"
            >
              <template v-if="version.number !== page.version && !page.archived" #append>
                <v-btn size="small" variant="text" :data-test="`page-version-restore-${version.number}`" @click="change(() => restorePageVersion(projectSlug, pageId, version.number))">
                  Bring back
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-btn
          v-if="page && !page.archived"
          :disabled="busy"
          :prepend-icon="mdiArchiveArrowDownOutline"
          variant="text"
          @click="change(() => archivePage(projectSlug, pageId))"
        >
          Archive
        </v-btn>
        <v-btn
          v-if="page?.archived"
          :disabled="busy"
          :prepend-icon="mdiArchiveArrowUpOutline"
          variant="text"
          @click="change(() => restorePage(projectSlug, pageId))"
        >
          Restore
        </v-btn>
        <v-btn :disabled="!page" :prepend-icon="mdiOpenInNew" variant="tonal" data-test="page-open-new-tab" @click="openInNewTab">
          Open in new tab
        </v-btn>
      </div>
    </header>
    <v-alert v-if="error" density="compact" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
    <div class="vibe64-page-viewer__frame-box">
      <iframe
        v-if="viewPath"
        :key="frameKey"
        class="vibe64-page-viewer__frame"
        data-test="page-viewer-frame"
        referrerpolicy="no-referrer"
        :sandbox="PAGE_SANDBOX"
        :src="viewPath"
        :title="page?.title || 'Page'"
      />
    </div>
  </section>
</template>

<style scoped>
.vibe64-page-viewer {
  display: grid;
  gap: 0.5rem;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.vibe64-page-viewer__toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  min-width: 0;
}

.vibe64-page-viewer__heading {
  display: grid;
  flex: 1 1 12rem;
  min-width: 0;
}

.vibe64-page-viewer__title {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-page-viewer__meta {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.vibe64-page-viewer__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

/* The frame box matches Preview's: a rounded surface the page fills, down to the bottom of the pane. */
.vibe64-page-viewer__frame-box {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--v64-outline-variant, rgba(var(--v-border-color), var(--v-border-opacity)));
  border-radius: 12px;
  height: max(24rem, calc(100dvh - 10rem));
  overflow: hidden;
}

.vibe64-page-viewer__frame {
  border: 0;
  display: block;
  height: 100%;
  width: 100%;
}
</style>
