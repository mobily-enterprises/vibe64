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
      transfer-available
      @ask-assistant-about-file="$emit('ask-assistant-about-file', $event)"
      @open-program="$emit('open-program', $event)"
      @transfer="repoTransfer = $event"
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
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64FileArea as areaInfo, vibe64FileTransferMessage } from "@/lib/vibe64FileAreas.js";
import Vibe64SessionSourceEditor from "./Vibe64SessionSourceEditor.vue";
import Vibe64FileArea from "@/components/studio/files/Vibe64FileArea.vue";
import Vibe64FileTransferDialog from "@/components/studio/files/Vibe64FileTransferDialog.vue";

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
let generation = 0;

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
onScopeDispose(() => { generation += 1; });
</script>

<style scoped>
.vibe64-session-files { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
/* Growing tabs fill the width on a phone, never the height. */
.vibe64-session-files__tabs { flex: none; }
.vibe64-session-files__content { flex: 1; min-height: 0; }
</style>
