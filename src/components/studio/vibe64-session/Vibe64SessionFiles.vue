<template>
  <section class="vibe64-session-files v64-focus-rings" :class="$attrs.class" :style="$attrs.style" aria-label="Session files">
    <v-tabs v-model="area" class="vibe64-session-files__tabs" color="primary" :density="mobile ? 'default' : 'compact'" :grow="mobile" aria-label="File areas" :disabled="loadingAreas">
      <v-tab :disabled="archived || !repoAvailable" value="repo" :prepend-icon="mobile ? undefined : areaInfo('repo').icon">Repo</v-tab>
      <v-tab v-for="tab in tabAreas" :key="tab" :value="tab" :prepend-icon="mobile ? undefined : areaInfo(tab).icon">{{ areaInfo(tab).label }}</v-tab>
    </v-tabs>
    <v-alert v-if="areaError" type="error" variant="tonal" density="compact">
      {{ areaError }}
      <v-btn variant="text" @click="loadAreas">Retry</v-btn>
    </v-alert>
    <Vibe64SessionSourceEditor
      v-if="!archived && repoAvailable"
      v-show="area === 'repo'"
      v-bind="$attrs"
      class="vibe64-session-files__content"
      :active="active && area === 'repo'"
      :agent-active="agentActive"
      :session-id="sessionId"
      :sessions-api-path="sessionsApiPath"
      :project-slug="projectSlug"
      :open-request="openRequest"
      :refresh-key="refreshKeys.repo"
      files-actions
      @ask-assistant-about-file="$emit('ask-assistant-about-file', $event)"
      @open-program="$emit('open-program', $event)"
      @transfer="repoTransfer = $event"
      @upload="uploadToRepo"
    />
    <input ref="repoUploadInput" type="file" multiple class="d-none" aria-label="Choose files to upload to Repo" @change="pickRepoFiles">
    <Vibe64FileUploadQueue
      v-if="area === 'repo'"
      :active="repoUploads.active.value"
      :items="repoUploads.items.value"
      @cancel="repoUploads.cancel"
      @cancel-all="repoUploads.cancelAll"
      @clear="repoUploads.clear"
      @remove="repoUploads.remove"
      @retry="repoUploads.retry"
    />
    <Vibe64FileConflictDialog
      :folder-label="repoFolderLabel(repoUploads.conflicts.value.folder)"
      :names="repoUploads.conflicts.value.names"
      @choose="repoUploads.resolveConflict"
      @closed="restoreRepoFocus"
    />
    <Vibe64FileArea
      v-for="visitedArea in mountedAreas"
      v-show="area === visitedArea"
      :key="`${sessionId}:${visitedArea}`"
      class="vibe64-session-files__content"
      :active="active && area === visitedArea"
      :agent-active="agentActive"
      :archived="archived"
      :area="visitedArea"
      :base="`${filesBase}/${visitedArea}`"
      :destinations="destinations"
      :project-slug="projectSlug"
      :refresh-key="refreshKeys[visitedArea] || 0"
      :session-id="sessionId"
      @transferred="transferred"
    />
    <Vibe64FileTransferDialog
      :destinations="destinations"
      :item="repoTransfer"
      source-area="repo"
      :source-base="`${filesBase}/repo`"
      :source-label="areaInfo('repo').label"
      @close="repoTransfer = null"
      @done="repoTransferred"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useVibe64FileUploads } from "@/composables/useVibe64FileUploads.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64FileArea as areaInfo, vibe64FileTransferMessage } from "@/lib/vibe64FileAreas.js";
import Vibe64SessionSourceEditor from "./Vibe64SessionSourceEditor.vue";
import Vibe64FileArea from "@/components/studio/files/Vibe64FileArea.vue";
import Vibe64FileConflictDialog from "@/components/studio/files/Vibe64FileConflictDialog.vue";
import Vibe64FileTransferDialog from "@/components/studio/files/Vibe64FileTransferDialog.vue";
import Vibe64FileUploadQueue from "@/components/studio/files/Vibe64FileUploadQueue.vue";

defineOptions({ inheritAttrs: false });
defineEmits(["ask-assistant-about-file", "open-program"]);
const props = defineProps({
  repoAvailable: { type: Boolean, default: true },
  archived: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  agentActive: { type: Boolean, default: false },
  sessionId: { type: String, required: true },
  sessionsApiPath: { type: String, required: true },
  projectSlug: { type: String, default: "" },
  openRequest: { type: Object, default: null }
});
const feedback = useUiFeedback({ source: "vibe64.files" });
const { smAndDown: mobile } = useDisplay();
const filesBase = computed(() => vibe64SessionPath(props.sessionsApiPath, props.sessionId, "/files"));
const area = ref(props.archived || !props.repoAvailable ? "drop-zone" : "repo");
const visitedAreas = ref([]);
watch(area, (value) => {
  if (value !== "repo" && !visitedAreas.value.includes(value)) visitedAreas.value.push(value);
}, { immediate: true });
const areas = ref(["repo"]);
const tabAreas = computed(() => areas.value.filter((value) => value !== "repo"));
const mountedAreas = computed(() => visitedAreas.value.filter((value) => areas.value.includes(value)));
// Items go to this session's writable areas or to the project's areas, which
// live on the project dashboard. An archived session can only send to the project.
const destinations = computed(() => [
  ...(props.archived ? [] : ["repo", "drop-zone"].filter((value) => value !== "repo" || props.repoAvailable)),
  "project-drop-zone", "backups"
].map((value) => ({ key: value, area: value, base: `${filesBase.value}/${value}`, ...areaInfo(value) })));
const refreshKeys = reactive({});
const repoTransfer = ref(null);
const areaError = ref("");
const loadingAreas = ref(false);
const repoUploadInput = ref(null);
let generation = 0;
let repoUploadFolder = "";
let repoUploadRefresh = null;
let repoReturnFocus = null;

// Repo uploads use the same queue and conflict question as the other areas;
// each file goes into the Repo folder chosen when it was added.
const repoUploads = useVibe64FileUploads({
  endpoint: computed(() => `${filesBase.value}/repo`),
  onAsk: () => { repoReturnFocus = globalThis.document?.activeElement || null; },
  onUploaded: () => {
    // A burst of small uploads refreshes Repo once.
    clearTimeout(repoUploadRefresh);
    repoUploadRefresh = setTimeout(() => { refreshKeys.repo = (refreshKeys.repo || 0) + 1; }, 250);
  }
});

function repoFolderLabel(folder = "") {
  return [areaInfo("repo").label, ...folder.split("/").filter(Boolean)].join(" › ");
}

// Dropped files arrive with the event; otherwise the file picker opens.
function uploadToRepo({ folder = "", files = null } = {}) {
  if (files) return startRepoUploads(files, folder);
  repoUploadFolder = folder;
  repoUploadInput.value?.click();
}

function pickRepoFiles(event) {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  return startRepoUploads(files, repoUploadFolder);
}

async function startRepoUploads(files, folder) {
  try {
    await repoUploads.start(files, folder);
  } catch (error) {
    feedback.error(error, "Upload failed.");
  }
}

async function restoreRepoFocus() {
  const target = repoReturnFocus;
  repoReturnFocus = null;
  await nextTick();
  if (target?.isConnected) target.focus();
}

function transferred(event) {
  refreshKeys[event.destination.area] = (refreshKeys[event.destination.area] || 0) + 1;
}

function repoTransferred(event) {
  repoTransfer.value = null;
  if (event.skipped) return;
  feedback.success(vibe64FileTransferMessage(event));
  if (event.mode === "move" || event.destination.area === "repo") refreshKeys.repo = (refreshKeys.repo || 0) + 1;
  transferred(event);
}

async function loadAreas() {
  const current = ++generation;
  areas.value = ["repo"];
  areaError.value = "";
  loadingAreas.value = true;
  try {
    const result = await getHttpWebClient().request(`${filesBase.value}`);
    if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "File areas could not load."));
    if (current !== generation) return;
    areas.value = result.areas;
    if (props.archived) area.value = areas.value.includes("session") ? "session" : "drop-zone";
    else if (!props.repoAvailable) area.value = "drop-zone";
    else if (!areas.value.includes(area.value)) area.value = "repo";
  } catch (error) {
    if (current === generation) {
      areaError.value = error.message;
      area.value = "repo";
    }
  } finally {
    if (current === generation) loadingAreas.value = false;
  }
}
watch(() => [props.sessionsApiPath, props.sessionId], loadAreas, { immediate: true });
watch(() => props.openRequest, () => { area.value = "repo"; });
onScopeDispose(() => {
  generation += 1;
  clearTimeout(repoUploadRefresh);
});
</script>

<style scoped>
.vibe64-session-files { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
/* Growing tabs fill the width on a phone, never the height. */
.vibe64-session-files__tabs { flex: none; }
.vibe64-session-files__content { flex: 1; min-height: 0; }
</style>
