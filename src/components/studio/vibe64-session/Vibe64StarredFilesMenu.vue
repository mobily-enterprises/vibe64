<template>
  <component
    ref="menu"
    :is="mobile ? VBottomSheet : VMenu"
    v-model="opened"
    :close-on-content-click="false"
    :content-props="{ role: 'dialog', 'aria-label': 'Starred files' }"
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
        :aria-label="`Starred files (${bookmarks.files.value.length})`"
        block
        class="justify-space-between"
        size="small"
        title="Your starred files"
        variant="text"
      >
        Starred files
        <template #append>
          <v-icon :icon="mdiStarOutline" />
          <span class="ms-1">{{ bookmarks.files.value.length }}</span>
        </template>
      </v-btn>
    </template>
    <v-card ref="panel" class="starred-files-menu" rounded="lg" @keydown.esc.stop.prevent="dismiss">
      <div class="starred-files-menu__header">
        <v-text-field
          ref="searchField"
          v-model="query"
          aria-label="Find a starred file"
          autofocus
          clearable
          density="compact"
          hide-details
          placeholder="Search"
          :prepend-inner-icon="mdiMagnify"
          variant="outlined"
          @keydown.enter.prevent="openFirstMatch"
        />
        <v-btn aria-label="Close starred files" :icon="mdiClose" size="small" variant="text" @click="dismiss" />
      </div>
      <div class="starred-files-menu__list">
        <Vibe64StarredFilesList :bookmarks="bookmarks" :files="matchingFiles" @open-file="openFile" />
      </div>
    </v-card>
  </component>
</template>

<script setup>
import { computed, ref } from "vue";
import { useDisplay } from "vuetify";
import { VBottomSheet, VMenu } from "vuetify/components";
import { mdiClose, mdiMagnify, mdiStarOutline } from "@mdi/js";
import Vibe64StarredFilesList from "./Vibe64StarredFilesList.vue";

const props = defineProps({ bookmarks: { type: Object, required: true } });
const emit = defineEmits(["open-file"]);
const { xs: mobile } = useDisplay();
const opened = ref(false);
const query = ref("");
const menu = ref(null);
const panel = ref(null);
const searchField = ref(null);
const matchingFiles = computed(() => {
  const search = (query.value || "").trim().toLocaleLowerCase();
  return props.bookmarks.files.value.filter((file) => file.path.toLocaleLowerCase().includes(search));
});
let returnFocus = false;

function focusSearch() {
  if (opened.value) {
    searchField.value?.focus();
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
    void props.bookmarks.refresh();
  } else if (document.activeElement === menu.value?.activatorEl || panel.value?.$el?.contains(document.activeElement)) {
    returnFocus = true;
  }
}

function openFile(filePath) {
  returnFocus = false;
  opened.value = false;
  emit("open-file", { path: filePath });
}

function openFirstMatch() {
  const file = matchingFiles.value.find((entry) => entry.available);
  if (file) {
    openFile(file.path);
  }
}
</script>

<style scoped>
.starred-files-menu {
  width: min(25rem, calc(100vw - 1rem));
  max-height: min(32rem, 75dvh);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
}

.starred-files-menu__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem;
}

.starred-files-menu__list {
  overflow-y: auto;
  min-height: 0;
  overscroll-behavior: contain;
}

@media (max-width: 599px) {
  .starred-files-menu {
    width: 100%;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  }
}
</style>
