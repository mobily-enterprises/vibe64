<script setup>
// A project's pages, Current and Archived: open one beside the chat, archive
// or restore it, and delete it once archived.
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { mdiArchiveArrowDownOutline, mdiArchiveArrowUpOutline, mdiDeleteOutline, mdiOpenInApp, mdiRefresh } from "@mdi/js";
import { pageAppPath } from "../shared/pageLinks.js";
import { archivePage, deletePage, listPages, pageTime, restorePage } from "./pagesRequests.js";

const props = defineProps({
  projectSlug: { type: String, required: true }
});

const router = useRouter();
const pages = ref([]);
const loading = ref(false);
const loaded = ref(false);
const error = ref("");
const tab = ref("current");
const busyPageId = ref("");
const deleting = ref(null);

const current = computed(() => pages.value.filter((page) => !page.archived));
const archived = computed(() => pages.value.filter((page) => page.archived));
const shown = computed(() => tab.value === "archived" ? archived.value : current.value);

async function refresh() {
  if (!props.projectSlug) return;
  loading.value = true;
  try {
    pages.value = (await listPages(props.projectSlug)).pages || [];
    error.value = "";
    loaded.value = true;
  } catch (cause) {
    error.value = cause?.message || "The pages could not load.";
  } finally {
    loading.value = false;
  }
}

async function change(page, operation) {
  busyPageId.value = page.id;
  try {
    await operation(props.projectSlug, page.id);
    error.value = "";
    await refresh();
  } catch (cause) {
    error.value = cause?.message || "The page could not change.";
  } finally {
    busyPageId.value = "";
  }
}

async function confirmDelete() {
  const page = deleting.value;
  deleting.value = null;
  if (page) await change(page, deletePage);
}

onMounted(refresh);
watch(() => props.projectSlug, refresh);
</script>

<template>
  <section class="vibe64-pages-list" data-test="pages-list">
    <div class="vibe64-pages-list__toolbar">
      <v-tabs v-model="tab" color="primary" density="compact" aria-label="Current and archived pages">
        <v-tab value="current" data-test="pages-tab-current">Current ({{ current.length }})</v-tab>
        <v-tab value="archived" data-test="pages-tab-archived">Archived ({{ archived.length }})</v-tab>
      </v-tabs>
      <v-btn :icon="mdiRefresh" :loading="loading" aria-label="Refresh pages" title="Refresh" variant="text" @click="refresh" />
    </div>
    <v-alert v-if="error" density="compact" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
    <p v-if="loaded && !shown.length" class="vibe64-pages-list__empty text-body-medium" data-test="pages-empty">
      <template v-if="tab === 'archived'">No archived pages.</template>
      <template v-else>
        No pages yet. Ask the AI in the chat to make one, for example:
        “Make a page summarising this project that my team can open.”
      </template>
    </p>
    <v-table v-else-if="shown.length" density="comfortable" class="vibe64-pages-list__table">
      <thead>
        <tr>
          <th scope="col">Page</th>
          <th scope="col">Refreshes</th>
          <th scope="col"><span class="v-sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="page in shown" :key="page.id" :data-page-id="page.id">
          <td class="vibe64-pages-list__page">
            <router-link class="vibe64-pages-list__title" :to="pageAppPath(projectSlug, page.id)">{{ page.title }}</router-link>
            <span class="vibe64-pages-list__meta text-body-small">
              Made by {{ page.createdBy?.name || page.createdBy?.id || "—" }} · updated {{ pageTime(page.updatedAt) }}
            </span>
          </td>
          <td class="text-medium-emphasis" title="This page has no refresh schedule">—</td>
          <td>
            <div class="vibe64-pages-list__actions">
              <v-btn :prepend-icon="mdiOpenInApp" size="small" variant="text" @click="router.push(pageAppPath(projectSlug, page.id))">
                Open
              </v-btn>
              <v-btn
                v-if="!page.archived"
                :disabled="Boolean(busyPageId)"
                :loading="busyPageId === page.id"
                :prepend-icon="mdiArchiveArrowDownOutline"
                size="small"
                variant="text"
                @click="change(page, archivePage)"
              >
                Archive
              </v-btn>
              <template v-else>
                <v-btn
                  :disabled="Boolean(busyPageId)"
                  :loading="busyPageId === page.id"
                  :prepend-icon="mdiArchiveArrowUpOutline"
                  size="small"
                  variant="text"
                  @click="change(page, restorePage)"
                >
                  Restore
                </v-btn>
                <v-btn
                  :disabled="Boolean(busyPageId)"
                  :prepend-icon="mdiDeleteOutline"
                  color="error"
                  size="small"
                  variant="text"
                  @click="deleting = page"
                >
                  Delete
                </v-btn>
              </template>
            </div>
          </td>
        </tr>
      </tbody>
    </v-table>
    <v-dialog :model-value="Boolean(deleting)" max-width="440" @update:model-value="!$event && (deleting = null)">
      <v-card v-if="deleting" title="Delete this page?">
        <v-card-text>
          “{{ deleting.title }}” and all its kept versions will be deleted for everyone in the project. This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = null">Cancel</v-btn>
          <v-btn color="error" variant="flat" data-test="pages-delete-confirm" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.vibe64-pages-list {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-pages-list__toolbar {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.vibe64-pages-list__empty {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  margin: 0.5rem 0;
}

.vibe64-pages-list__table {
  overflow-x: auto;
}

.vibe64-pages-list__page {
  min-width: 10rem;
  padding-block: 0.5rem;
}

.vibe64-pages-list__title {
  display: block;
  font-weight: 500;
  overflow-wrap: break-word;
}

.vibe64-pages-list__meta {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  display: block;
}

/* Beside the chat the pane is narrow: the actions wrap rather than push the table sideways. */
.vibe64-pages-list__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}
</style>
