<template>
  <section class="vibe64-project-files v64-focus-rings" :class="{ 'vibe64-project-files--mobile': mobile }" aria-label="Project files">
    <v-tabs v-model="area" class="vibe64-project-files__tabs" aria-label="Project file areas" color="primary" :density="mobile ? 'default' : 'compact'" :grow="mobile">
      <v-tab v-for="value in AREAS" :key="value" :value="value" :prepend-icon="mobile ? undefined : areaInfo(value).icon">
        {{ areaInfo(value).label }}
      </v-tab>
    </v-tabs>
    <Vibe64FileArea
      v-for="value in visited"
      v-show="area === value"
      :key="value"
      class="vibe64-project-files__area"
      :active="area === value"
      :area="value"
      :base="`${projectFilesBase}/${value}`"
      :destinations="destinations"
      :project-slug="projectSlug"
      :refresh-key="refreshKeys[value] || 0"
      @transferred="transferred"
    />
  </section>
</template>

<script setup>
import { computed, inject, reactive, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { VIBE64_ACTIVE_SESSION_NAV_KEY } from "@/lib/vibe64ActiveSessionNav.js";
import { vibe64FileArea as areaInfo } from "@/lib/vibe64FileAreas.js";
import Vibe64FileArea from "./Vibe64FileArea.vue";

// The project's own file areas, shared by every session. Items can also go to
// the Repo or Session Dropzone of the session open beside the dashboard.
const AREAS = ["project-drop-zone", "backups"];
const props = defineProps({
  projectSlug: { type: String, default: "" }
});
const { smAndDown: mobile } = useDisplay();
const activeSession = inject(VIBE64_ACTIVE_SESSION_NAV_KEY, null);
const projectFilesBase = computed(() => scopedDevelopmentApiUrl("/api/vibe64/project-files", props.projectSlug));
const area = ref(AREAS[0]);
const visited = ref([]);
watch(area, (value) => {
  if (!visited.value.includes(value)) visited.value.push(value);
}, { immediate: true });
const refreshKeys = reactive({});
const destinations = computed(() => {
  const session = activeSession?.value?.visible ? activeSession.value : null;
  const sessionsBase = scopedDevelopmentApiUrl("/api/vibe64/sessions", props.projectSlug);
  return [
    ...AREAS.map((value) => ({ key: value, area: value, base: `${projectFilesBase.value}/${value}`, ...areaInfo(value) })),
    ...(session?.sessionId ? ["repo", "drop-zone"].map((value) => ({
      ...areaInfo(value),
      key: `${session.sessionId}:${value}`,
      area: value,
      label: `${areaInfo(value).label} · ${session.label || "this session"}`,
      base: vibe64SessionPath(sessionsBase, session.sessionId, `/files/${value}`),
      sessionId: session.sessionId
    })) : [])
  ];
});

function transferred(event) {
  if (!event.destination.sessionId) refreshKeys[event.destination.area] = (refreshKeys[event.destination.area] || 0) + 1;
}
</script>

<style scoped>
.vibe64-project-files {
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-md);
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  /* Clipped rather than hidden, so the upload card sticks to the page scroller on a phone. */
  overflow: clip;
}

/* Growing tabs fill the width on a phone, never the height. */
.vibe64-project-files__tabs {
  flex: none;
}

.vibe64-project-files__area {
  block-size: clamp(26rem, calc(100dvh - 16rem), 56rem);
}

/* A phone scrolls the page itself instead of a pane inside it, so the upload
   card and the file bar stick to the page. */
.vibe64-project-files--mobile .vibe64-project-files__area {
  block-size: auto;
  min-block-size: 26rem;
  overflow: visible;
}
</style>
