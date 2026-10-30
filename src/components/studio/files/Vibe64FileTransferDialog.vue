<template>
  <v-dialog
    :model-value="Boolean(item)"
    :aria-labelledby="titleId"
    :fullscreen="mobile"
    :persistent="busy"
    max-width="560"
    scrollable
    @after-leave="$emit('closed')"
    @update:model-value="$event || close()"
  >
    <v-card v-if="item" class="vibe64-transfer-dialog v64-focus-rings">
      <!-- A full-screen dialog on a phone keeps its action at the top, clear of the keyboard. -->
      <v-toolbar v-if="mobile" class="vibe64-transfer-dialog__bar" color="surface">
        <v-btn :icon="mdiClose" aria-label="Close" :disabled="busy" @click="close" />
        <v-toolbar-title :id="titleId" class="vibe64-transfer-dialog__title">{{ title }}</v-toolbar-title>
        <v-btn class="vibe64-transfer-dialog__bar-action me-2" color="primary" variant="text" :disabled="actionDisabled" :loading="busy" @click="confirm">{{ actionLabel }}</v-btn>
      </v-toolbar>
      <v-card-item>
        <v-card-title v-if="!mobile" :id="titleId" class="vibe64-transfer-dialog__title">{{ title }}</v-card-title>
        <v-card-subtitle class="vibe64-transfer-dialog__subtitle">
          <v-icon :icon="item.type === 'directory' ? mdiFolderOutline : mdiFileOutline" size="18" aria-hidden="true" />
          <span>{{ item.name }} · from {{ sourceLabel }}</span>
        </v-card-subtitle>
      </v-card-item>
      <v-card-text class="vibe64-transfer-dialog__body">
        <v-btn-toggle
          v-if="!readOnly"
          v-model="mode"
          class="vibe64-transfer-dialog__mode"
          color="primary"
          divided
          mandatory
          role="radiogroup"
          rounded="pill"
          variant="outlined"
          aria-label="Move or copy"
        >
          <v-btn value="copy" :prepend-icon="mdiContentCopy" role="radio" :aria-checked="String(mode === 'copy')">Copy</v-btn>
          <v-btn value="move" :prepend-icon="mdiFileMoveOutline" role="radio" :aria-checked="String(mode === 'move')">Move</v-btn>
        </v-btn-toggle>

        <h3 class="vibe64-transfer-dialog__label">Destination</h3>
        <v-chip-group v-model="destinationKey" class="vibe64-transfer-dialog__areas" column mandatory selected-class="vibe64-transfer-dialog__chip--selected" aria-label="Destination area" role="radiogroup">
          <v-chip
            v-for="option in destinations"
            :key="option.key"
            :aria-checked="String(destinationKey === option.key)"
            filter
            :prepend-icon="option.icon"
            role="radio"
            size="large"
            :value="option.key"
            variant="outlined"
          >
            <span class="vibe64-transfer-dialog__chip-label">{{ option.label }}</span>
          </v-chip>
        </v-chip-group>

        <nav class="vibe64-transfer-dialog__crumbs" aria-label="Destination folder">
          <template v-for="(crumb, index) in crumbs" :key="crumb.path">
            <v-icon v-if="index" :icon="mdiChevronRight" size="18" aria-hidden="true" />
            <span v-if="index === crumbs.length - 1" class="vibe64-transfer-dialog__crumb-current" aria-current="location">{{ crumb.title }}</span>
            <v-btn v-else :disabled="loading || busy" variant="text" @click="browse(crumb.path)">{{ crumb.title }}</v-btn>
          </template>
        </nav>

        <v-skeleton-loader v-if="loading" type="list-item@3" />
        <v-alert v-else-if="loadError" type="error" variant="tonal" density="compact">
          {{ loadError }}
          <template #append><v-btn variant="text" @click="browse(folder)">Retry</v-btn></template>
        </v-alert>
        <p v-else-if="expired" class="vibe64-transfer-dialog__hint">This Session Dropzone has expired.</p>
        <v-list v-else-if="folders.length" class="vibe64-transfer-dialog__folders" aria-label="Folders" role="group">
          <v-list-item
            v-for="entry in folders"
            :key="entry.path"
            role="button"
            :disabled="busy || insideItself(entry.path)"
            :prepend-icon="mdiFolderOutline"
            :title="entry.name"
            :append-icon="mdiChevronRight"
            @click="browse(entry.path)"
          />
        </v-list>
        <p v-else class="vibe64-transfer-dialog__hint">No folders here. {{ mode === "move" ? "Move" : "Copy" }} into this folder, or open another one.</p>
        <v-btn v-if="hasMore && !loading" variant="text" :disabled="busy" @click="browse(folder, true)">Show more folders</v-btn>
      </v-card-text>
      <v-divider />
      <div class="vibe64-transfer-dialog__footer">
        <p class="vibe64-transfer-dialog__target" :class="{ 'vibe64-transfer-dialog__target--blocked': blockedReason }" aria-live="polite">
          {{ blockedReason || `Into ${targetLabel}` }}
        </p>
        <div v-if="!mobile" class="vibe64-transfer-dialog__actions">
          <v-btn variant="text" :disabled="busy" @click="close">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="actionDisabled" :loading="busy" @click="confirm">{{ actionLabel }}</v-btn>
        </div>
      </div>
    </v-card>
    <Vibe64FileConflictDialog :folder-label="targetLabel" :names="conflictNames" @choose="resolveConflict" />
  </v-dialog>
</template>

<script setup>
import { computed, ref, useId, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiChevronRight, mdiClose, mdiContentCopy, mdiFileMoveOutline, mdiFileOutline, mdiFolderOutline } from "@mdi/js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import Vibe64FileConflictDialog from "./Vibe64FileConflictDialog.vue";

// Moves or copies one item to a folder in another area (or this one) on the
// server, so nothing is downloaded. Destinations carry the address used to
// browse their folders and, for another session, its session ID.
const props = defineProps({
  destinations: { type: Array, default: () => [] },
  item: { type: Object, default: null },
  readOnly: { type: Boolean, default: false },
  sourceArea: { type: String, required: true },
  sourceBase: { type: String, required: true },
  sourceLabel: { type: String, required: true }
});
const emit = defineEmits(["close", "closed", "done"]);
const { smAndDown: mobile } = useDisplay();
const feedback = useUiFeedback({ source: "vibe64.files.transfer" });
const mode = ref("copy");
const destinationKey = ref("");
const folder = ref("");
const folders = ref([]);
const hasMore = ref(false);
const nextOffset = ref(0);
const loading = ref(false);
const loadError = ref("");
const expired = ref(false);
const busy = ref(false);
const conflictNames = ref([]);
const titleId = `vibe64-transfer-dialog-${useId()}`;
let generation = 0;

const destination = computed(() => props.destinations.find((candidate) => candidate.key === destinationKey.value) || null);
const sameArea = computed(() => destination.value?.area === props.sourceArea && !destination.value?.sessionId);
const crumbs = computed(() => [
  { title: destination.value?.label || "", path: "" },
  ...folder.value.split("/").filter(Boolean).map((name, index, parts) => ({ title: name, path: parts.slice(0, index + 1).join("/") }))
]);
const targetLabel = computed(() => crumbs.value.map((crumb) => crumb.title).join(" › "));
const itemFolder = computed(() => props.item?.path.split("/").slice(0, -1).join("/") || "");

function insideItself(candidate) {
  return sameArea.value && props.item?.type === "directory" && (candidate === props.item.path || candidate.startsWith(`${props.item.path}/`));
}

const blockedReason = computed(() => {
  if (insideItself(folder.value)) return "A folder cannot go inside itself.";
  if (sameArea.value && mode.value === "move" && folder.value === itemFolder.value) return "It is already in this folder.";
  return "";
});
// Read-only items can only be copied, so their dialog does not offer Move.
const title = computed(() => props.readOnly ? "Copy to" : "Move or copy");
const actionLabel = computed(() => mode.value === "move" ? "Move here" : "Copy here");
const actionDisabled = computed(() => Boolean(blockedReason.value) || loading.value || Boolean(loadError.value) || expired.value);

async function request(url, options) {
  const result = await getHttpWebClient().request(url, options);
  if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "Move or copy failed."));
  return result;
}

async function browse(path = "", more = false) {
  const current = ++generation;
  const target = destination.value;
  if (!target) return;
  loading.value = true;
  loadError.value = "";
  try {
    const query = new URLSearchParams({ path, offset: more ? nextOffset.value : 0 });
    const result = await request(`${target.base}/tree?${query}`);
    if (current !== generation) return;
    folder.value = path;
    const found = result.tree.children.filter((entry) => entry.type === "directory");
    folders.value = more ? [...folders.value, ...found] : found;
    hasMore.value = result.tree.hasMore === true;
    nextOffset.value = result.tree.nextOffset;
    expired.value = result.expired === true;
  } catch (error) {
    if (current === generation) loadError.value = error.message;
  } finally {
    if (current === generation) loading.value = false;
  }
}

watch(() => props.item, (item) => {
  if (!item) return;
  mode.value = "copy";
  conflictNames.value = [];
  const preferred = props.destinations.find((candidate) => candidate.area !== props.sourceArea || candidate.sessionId);
  destinationKey.value = (preferred || props.destinations[0])?.key || "";
}, { immediate: true });
watch([() => props.item, destinationKey], ([item]) => {
  folder.value = "";
  folders.value = [];
  if (item) void browse("");
}, { immediate: true });

function close() {
  if (!busy.value) emit("close");
}

async function run(task) {
  busy.value = true;
  try {
    await task();
  } catch (error) {
    feedback.error(error, "Move or copy failed.");
  } finally {
    busy.value = false;
  }
}

async function transfer(conflict) {
  const target = destination.value;
  const result = await request(`${props.sourceBase}/transfer`, {
    method: "POST",
    body: {
      path: props.item.path, mode: mode.value, targetArea: target.area, targetPath: folder.value, conflict,
      ...(target.sessionId ? { targetSessionId: target.sessionId } : {})
    }
  });
  emit("done", { destination: target, item: props.item, mode: mode.value, path: result.path || "", skipped: result.skipped === true });
}

// The destination is checked first so a taken name is asked about once.
function confirm() {
  return run(async () => {
    const result = await request(`${destination.value.base}/conflicts`, {
      method: "POST", body: { path: folder.value, names: [props.item.name] }
    });
    if (result.existing?.length) {
      conflictNames.value = result.existing;
      return;
    }
    await transfer("fail");
  });
}

function resolveConflict(choice) {
  conflictNames.value = [];
  if (choice) void run(() => transfer(choice));
}
</script>

<style scoped>
.vibe64-transfer-dialog__title {
  font: var(--v64-type-headline-sm);
}

.vibe64-transfer-dialog__bar .vibe64-transfer-dialog__title {
  font: var(--v64-type-title-lg);
}

.vibe64-transfer-dialog__subtitle {
  color: var(--v64-on-surface-variant);
  opacity: 1;
  align-items: center;
  display: flex;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-1);
  white-space: normal;
}

.vibe64-transfer-dialog__subtitle span {
  overflow-wrap: anywhere;
}

.vibe64-transfer-dialog__body {
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-2);
}

.vibe64-transfer-dialog__mode {
  align-self: flex-start;
  block-size: 48px;
}

.vibe64-transfer-dialog__areas .v-chip {
  max-inline-size: 100%;
}

.vibe64-transfer-dialog__areas :deep(.v-chip__content) {
  min-inline-size: 0;
}

.vibe64-transfer-dialog__areas .vibe64-transfer-dialog__chip--selected {
  background: var(--v64-secondary-container);
  border-color: transparent;
  color: var(--v64-on-secondary-container);
}

.vibe64-transfer-dialog__chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-transfer-dialog__label {
  font: var(--v64-type-title-md);
  margin: var(--v64-space-2) 0 0;
}

.vibe64-transfer-dialog__hint {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.vibe64-transfer-dialog__crumbs {
  align-items: center;
  border-block-start: 1px solid var(--v64-outline-variant);
  display: flex;
  flex-wrap: wrap;
  padding-block-start: var(--v64-space-2);
}

.vibe64-transfer-dialog__crumbs .v-btn {
  min-inline-size: 0;
  padding-inline: var(--v64-space-2);
  text-transform: none;
}

.vibe64-transfer-dialog__crumb-current {
  color: rgb(var(--v-theme-on-surface));
  font: var(--v64-type-label-lg);
  overflow-wrap: anywhere;
  padding-inline: var(--v64-space-2);
}

@media (max-width: 959.98px) {
  .vibe64-transfer-dialog__crumbs .v-btn,
  .vibe64-transfer-dialog__bar-action,
  .vibe64-transfer-dialog__areas .v-chip {
    min-block-size: 48px;
  }
}

.vibe64-transfer-dialog__folders {
  background: transparent;
  padding: 0;
}

.vibe64-transfer-dialog__footer {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2);
  justify-content: flex-end;
  padding: var(--v64-space-2) var(--v64-space-4);
}

.vibe64-transfer-dialog__target {
  color: var(--v64-on-surface-variant);
  flex: 1 1 12rem;
  font: var(--v64-type-body-md);
  margin: 0;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}

.vibe64-transfer-dialog__target--blocked {
  color: rgb(var(--v-theme-error));
}

.vibe64-transfer-dialog__actions {
  display: flex;
  gap: var(--v64-space-2);
}
</style>
