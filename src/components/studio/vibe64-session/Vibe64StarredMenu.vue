<template>
  <component
    ref="menu"
    :is="mobile ? VBottomSheet : VMenu"
    v-model="opened"
    :close-on-content-click="false"
    :content-props="{ role: 'dialog', 'aria-label': 'Starred' }"
    location="top start"
    max-width="400"
    @after-enter="focusSearch"
    @after-leave="restoreTriggerFocus"
    @update:model-value="onOpenChange"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        aria-haspopup="dialog"
        :aria-label="`Starred (${pageStars.pages.value.length + bookmarks.files.value.length})`"
        class="starred-menu__trigger"
        :icon="mdiStarOutline"
        size="small"
        title="Your starred pages and files"
        variant="text"
      />
    </template>
    <v-card ref="panel" class="starred-menu" rounded="lg" @keydown.esc.stop.prevent="dismiss">
      <div class="starred-menu__header">
        <v-text-field
          ref="searchField"
          v-model="query"
          aria-label="Find a starred page or file"
          autofocus
          clearable
          density="compact"
          hide-details
          placeholder="Search"
          :prepend-inner-icon="mdiMagnify"
          variant="outlined"
          @keydown.enter.prevent="openFirstMatch"
        />
        <v-btn aria-label="Close starred" :icon="mdiClose" size="small" variant="text" @click="dismiss" />
      </div>
      <div class="starred-menu__list">
        <section aria-labelledby="starred-menu-pages">
          <h3 id="starred-menu-pages" class="starred-menu__heading">Pages</h3>
          <Vibe64StarredPagesList ref="pagesList" :project-slug="projectSlug" :query="query || ''" @opened="openPage" />
        </section>
        <section aria-labelledby="starred-menu-files">
          <h3 id="starred-menu-files" class="starred-menu__heading">Files</h3>
          <Vibe64StarredFilesList :bookmarks="bookmarks" :files="matchingFiles" @open-file="openFile" />
        </section>
      </div>
    </v-card>
  </component>
</template>

<script setup>
// The chat's Starred menu: your starred pages, then your starred files, with
// one search over both. A page opens beside the chat, a file in Files.
import { computed, nextTick, ref } from "vue";
import { useDisplay } from "vuetify";
import { VBottomSheet, VMenu } from "vuetify/components";
import { mdiClose, mdiMagnify, mdiStarOutline } from "@mdi/js";
import { usePageStars, Vibe64StarredPagesList } from "@local/vibe64-pages/client";
import Vibe64StarredFilesList from "./Vibe64StarredFilesList.vue";

// How many starred pages get their viewing link asked for as the menu opens.
const PAGES_PREPARED_ON_OPEN = 3;

const props = defineProps({
  bookmarks: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64StarredFiles>} */ (Object), required: true },
  projectSlug: { type: String, required: true }
});
const emit = defineEmits(["open-file", "open-page"]);
const { xs: mobile } = useDisplay();
const pageStars = usePageStars(() => props.projectSlug);
const opened = ref(false);
const query = ref("");
const menu = ref(null);
const panel = ref(null);
const pagesList = ref(null);
const searchField = ref(null);
const matchingFiles = computed(() => {
  const search = (query.value || "").trim().toLocaleLowerCase();
  return props.bookmarks.files.value.filter((file) => file.path.toLocaleLowerCase().includes(search));
});
let returnFocus = false;

function focusSearch() {
  if (opened.value) {
    searchField.value?.focus();
    pagesList.value?.prepareFirst(PAGES_PREPARED_ON_OPEN);
  }
}

function dismiss() {
  returnFocus = true;
  opened.value = false;
}

function restoreTriggerFocus() {
  if (returnFocus) {
    menu.value?.activatorEl?.focus();
  }
  returnFocus = false;
}

function onOpenChange(value) {
  if (value) {
    query.value = "";
    void nextTick(() => pagesList.value?.prepareFirst(PAGES_PREPARED_ON_OPEN));
    void props.bookmarks.refresh();
    void pageStars.refresh();
  } else if (document.activeElement === menu.value?.activatorEl || panel.value?.$el?.contains(document.activeElement)) {
    returnFocus = true;
  }
}

function closeForOpening() {
  returnFocus = false;
  opened.value = false;
}

function openPage() {
  closeForOpening();
  emit("open-page");
}

function openFile(filePath) {
  closeForOpening();
  emit("open-file", { path: filePath });
}

function openFirstMatch() {
  if (pagesList.value?.openFirst()) {
    return;
  }
  const file = matchingFiles.value.find((entry) => entry.available);
  if (file) {
    openFile(file.path);
  }
}
</script>

<style scoped>
.starred-menu {
  width: min(25rem, calc(100vw - 1rem));
  max-height: min(32rem, 75dvh);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.starred-menu__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
}

.starred-menu__list {
  display: grid;
  gap: 0.5rem;
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

.starred-menu__heading {
  margin: 0;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

@media (max-width: 599px) {
  .starred-menu {
    width: 100%;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  }
}

@media (pointer: coarse) {
  .starred-menu__trigger {
    min-height: 3rem;
    min-width: 3rem;
  }
}
</style>
