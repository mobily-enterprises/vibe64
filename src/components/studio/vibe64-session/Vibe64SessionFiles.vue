<template>
  <section class="vibe64-session-files" :class="$attrs.class" :style="$attrs.style" aria-label="Session files">
    <v-tabs v-model="area" density="compact" aria-label="File areas" :disabled="loadingAreas">
      <v-tab :disabled="archived || !repoAvailable" value="repo" :prepend-icon="mdiSourceRepository">Repo</v-tab>
      <v-tab v-if="areas.includes('drop-zone')" value="drop-zone" :prepend-icon="mdiTrayArrowUp">Drop Zone</v-tab>
      <v-tab v-if="areas.includes('session')" value="session" :prepend-icon="mdiArchiveClockOutline">Session</v-tab>
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
      :session-id="sessionId"
      :sessions-api-path="sessionsApiPath"
      :project-slug="projectSlug"
      :open-request="openRequest"
      @ask-codex-about-file="$emit('ask-codex-about-file', $event)"
    />
    <Vibe64SessionFileArea
      v-for="visitedArea in mountedAreas"
      v-show="area === visitedArea"
      :key="`${sessionId}:${visitedArea}`"
      class="vibe64-session-files__content"
      :active="active && area === visitedArea"
      :area="visitedArea"
      :archived="archived"
      :session-id="sessionId"
      :sessions-api-path="sessionsApiPath"
      :project-slug="projectSlug"
      :agent-active="$attrs.agentActive ?? $attrs['agent-active'] ?? false"
    />
  </section>
</template>

<script setup>
import { computed, onScopeDispose, ref, watch } from "vue";
import { mdiArchiveClockOutline, mdiSourceRepository, mdiTrayArrowUp } from "@mdi/js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import Vibe64SessionSourceEditor from "./Vibe64SessionSourceEditor.vue";
import Vibe64SessionFileArea from "./Vibe64SessionFileArea.vue";

defineOptions({ inheritAttrs: false });
defineEmits(["ask-codex-about-file"]);
const props = defineProps({
  repoAvailable: { type: Boolean, default: true },
  archived: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  sessionId: { type: String, required: true },
  sessionsApiPath: { type: String, required: true },
  projectSlug: { type: String, default: "" },
  openRequest: { type: Object, default: null }
});
const area = ref(props.archived || !props.repoAvailable ? "drop-zone" : "repo");
const visitedAreas = ref([]);
watch(area, (value) => {
  if (value !== "repo" && !visitedAreas.value.includes(value)) visitedAreas.value.push(value);
}, { immediate: true });
const areas = ref(["repo"]);
const mountedAreas = computed(() => visitedAreas.value.filter((value) => areas.value.includes(value)));
const areaError = ref("");
const loadingAreas = ref(false);
let generation = 0;
async function loadAreas() {
  const current = ++generation;
  areas.value = ["repo"];
  areaError.value = "";
  loadingAreas.value = true;
  try {
    const result = await getHttpWebClient().request(`${props.sessionsApiPath}/${encodeURIComponent(props.sessionId)}/files`);
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
.vibe64-session-files__content { flex: 1; min-height: 0; }
</style>
