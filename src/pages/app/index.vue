<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import { PROJECT_SELECTION_ENDPOINT } from "@/lib/studioGateApi.js";
import { lessonPath } from "@/lib/vibe64Learning.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Local /app has no Projects page: a local Vibe64 serves one started project.
// It resolves to the lesson's place during a lesson (its practice project, or
// the Learning page for a lesson without one), otherwise to the started
// project. The server refuses the started project during a lesson anyway.
const router = useRouter();
const learning = useVibe64Learning();
const error = ref("");
let resolving = false;

async function resolve() {
  if (resolving) return;
  resolving = true;
  error.value = "";
  try {
    const mode = await learning?.readLearningMode();
    if (mode?.on) {
      await router.replace(lessonPath(mode));
      return;
    }
    const slug = (await getHttpWebClient().request(PROJECT_SELECTION_ENDPOINT, { method: "GET" }))?.currentProject?.slug;
    if (!slug) throw new Error("This Vibe64 has no started project. Start Vibe64 in a project folder.");
    await router.replace(projectAppPath(slug));
  } catch (cause) {
    error.value = String(cause?.message || "Your project could not be opened. Try again.");
  } finally {
    resolving = false;
  }
}

// The learning mode read needs the signed-in viewer, which the Learning overlay binds.
watch(() => !learning || Boolean(learning.state.actorKey), ready => { if (ready) void resolve(); }, { immediate: true });
</script>

<template>
  <StudioAppShellLayout>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>
    <section class="vibe64-app-resolver">
      <StudioErrorNotice v-if="error" title="Project could not open" :error="error" compact>
        <template #actions>
          <v-btn color="primary" variant="flat" min-height="48" @click="resolve">Try again</v-btn>
        </template>
      </StudioErrorNotice>
      <v-skeleton-loader v-else type="article" aria-label="Opening your project" />
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-app-resolver {
  padding: clamp(1rem, 3vw, 2rem);
}
</style>
