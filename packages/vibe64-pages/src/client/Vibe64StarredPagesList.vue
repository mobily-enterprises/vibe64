<script setup>
// Your starred pages in the chat's Starred menu. One click opens a page beside
// the chat; its viewing link and the page route's code are asked for as the
// menu opens (the first few) and as a row is pointed at or focused, so the
// click only has to show the page.
import { computed } from "vue";
import { loadRouteLocation, useRouter } from "vue-router";
import { mdiFileDocumentOutline, mdiStar } from "@mdi/js";
import { pageAppPath } from "../shared/pageLinks.js";
import { preparePageView, usePageStars, usePageViewTheme } from "./pageStars.js";
import { pageTime } from "./pagesRequests.js";

const props = defineProps({
  projectSlug: { type: String, required: true },
  query: { type: String, default: "" }
});
const emit = defineEmits(["opened"]);

const router = useRouter();
const stars = usePageStars(() => props.projectSlug);
const theme = usePageViewTheme();
const shown = computed(() => {
  const search = props.query.trim().toLocaleLowerCase();
  return stars.pages.value.filter((page) => page.title.toLocaleLowerCase().includes(search));
});

function prepare(page) {
  preparePageView(props.projectSlug, page.id, theme.value);
  void loadRouteLocation(router.resolve(pageAppPath(props.projectSlug, page.id))).catch(() => {});
}

function open(page) {
  prepare(page);
  emit("opened", page);
  void router.push(pageAppPath(props.projectSlug, page.id));
}

/** Asks ahead for the viewing links of the first few pages shown. @param {number} count */
function prepareFirst(count) {
  shown.value.slice(0, count).forEach(prepare);
}

/** Opens the first page shown; false when none is. */
function openFirst() {
  if (!shown.value.length) return false;
  open(shown.value[0]);
  return true;
}

defineExpose({ openFirst, prepareFirst });
</script>

<template>
  <div class="vibe64-starred-pages">
    <v-alert v-if="stars.error.value" density="compact" type="error" variant="tonal">
      {{ stars.error.value }}
      <v-btn size="small" variant="text" @click="stars.refresh">Retry</v-btn>
    </v-alert>
    <v-skeleton-loader v-if="stars.loading.value && !stars.loaded.value" type="list-item" />
    <p v-else-if="!stars.pages.value.length" class="vibe64-starred-pages__empty">
      Star a page on its chat card, its panel or in Pages to open it from here. Only you see your stars.
    </p>
    <p v-else-if="!shown.length" class="vibe64-starred-pages__empty">No matching starred pages.</p>
    <ul v-else aria-label="Starred pages">
      <li v-for="page in shown" :key="page.id">
        <button
          class="vibe64-starred-pages__open"
          data-test="starred-page-open"
          :data-page-id="page.id"
          type="button"
          @click="open(page)"
          @focus="prepare(page)"
          @pointerenter="prepare(page)"
        >
          <v-icon :icon="mdiFileDocumentOutline" color="primary" size="18" />
          <span class="vibe64-starred-pages__copy">
            <strong>{{ page.title }}</strong>
            <span>Updated {{ pageTime(page.updatedAt) }}</span>
          </span>
        </button>
        <v-btn
          :aria-label="`Unstar ${page.title}`"
          :disabled="stars.pendingIds.value.includes(page.id)"
          :icon="mdiStar"
          size="small"
          title="Unstar page"
          variant="text"
          @click="stars.toggle(page)"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.vibe64-starred-pages ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.vibe64-starred-pages li {
  align-items: center;
  display: flex;
  gap: 0.25rem;
}

.vibe64-starred-pages__open {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 0.5rem;
  color: inherit;
  display: flex;
  flex: 1;
  font: inherit;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.5rem;
  text-align: left;
}

.vibe64-starred-pages__open:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.vibe64-starred-pages__open:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.vibe64-starred-pages__copy {
  display: grid;
  min-width: 0;
}

.vibe64-starred-pages__copy strong {
  font-size: 0.875rem;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.vibe64-starred-pages__copy span {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.75rem;
}

.vibe64-starred-pages__empty {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.8125rem;
  margin: 0;
  padding: 0.5rem;
}
</style>
