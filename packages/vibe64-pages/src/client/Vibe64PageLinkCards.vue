<script setup>
// The pages a chat message links to, the AI's or pasted, each as a card with
// its title, last update and Open, which shows it beside the chat.
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { mdiFileDocumentOutline } from "@mdi/js";
import { pageLinksInText } from "../shared/pageLinks.js";
import { pageTime, readPage } from "./pagesRequests.js";

const props = defineProps({
  text: { type: String, default: "" }
});

const router = useRouter();
const links = computed(() => pageLinksInText(props.text, { origin: globalThis.location?.origin || "" }));
const answers = ref({});

watch(links, (next) => {
  for (const link of next) {
    if (answers.value[link.path]) continue;
    answers.value = { ...answers.value, [link.path]: { loading: true } };
    readPage(link.projectSlug, link.pageId).then(
      (answer) => { answers.value = { ...answers.value, [link.path]: { page: answer.page } }; },
      (cause) => {
        const missing = cause?.status === 404 || cause?.code === "vibe64_pages_not_found";
        answers.value = { ...answers.value, [link.path]: { error: missing ? "This page no longer exists." : cause?.message || "This page could not load." } };
      }
    );
  }
}, { immediate: true });
</script>

<template>
  <div v-if="links.length" class="vibe64-page-link-cards">
    <v-card
      v-for="link in links"
      :key="link.path"
      class="vibe64-page-link-card"
      data-test="page-link-card"
      :data-page-id="link.pageId"
      variant="outlined"
    >
      <div class="vibe64-page-link-card__body">
        <v-icon :icon="mdiFileDocumentOutline" color="primary" size="22" />
        <div class="vibe64-page-link-card__copy">
          <span class="vibe64-page-link-card__title text-title-small">
            {{ answers[link.path]?.page?.title || (answers[link.path]?.error ? "Page" : "Loading page…") }}
          </span>
          <span v-if="answers[link.path]?.page" class="vibe64-page-link-card__meta text-body-small">
            Updated {{ pageTime(answers[link.path].page.updatedAt) }}<template v-if="answers[link.path].page.archived"> · archived</template>
          </span>
          <span v-else-if="answers[link.path]?.error" class="vibe64-page-link-card__meta text-body-small" role="status">
            {{ answers[link.path].error }}
          </span>
        </div>
        <v-btn
          :disabled="!answers[link.path]?.page"
          color="primary"
          variant="tonal"
          data-test="page-link-card-open"
          @click="router.push(link.path)"
        >
          Open
        </v-btn>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.vibe64-page-link-cards {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
  max-width: 32rem;
}

.vibe64-page-link-card__body {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  padding: 0.75rem;
}

.vibe64-page-link-card__copy {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
}

.vibe64-page-link-card__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-page-link-card__meta {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
