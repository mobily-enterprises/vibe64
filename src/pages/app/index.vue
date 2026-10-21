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
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Local /app has no Projects page; it resolves by mode. Develop: the one
// started project. Learn: Learn's place (the current lesson's practice
// project, or no project selected).
const router = useRouter();
const learning = useVibe64Learning();
const error = ref("");
let resolving = false;

// Local project reads exist only inside a project's scope; the server knows
// the started project and redirects a request for /app to it. That redirect
// is followed here without leaving the page, so the Courses overlay keeps its place.
async function startedProjectPath() {
  const response = await globalThis.fetch("/app", { method: "HEAD", credentials: "same-origin" });
  const path = new URL(response.url).pathname.replace(/\/+$/u, "");
  return path.startsWith("/app/project/") ? path : "";
}

async function resolve() {
  if (resolving) return;
  resolving = true;
  error.value = "";
  try {
    if (learning?.learnMode) {
      await router.replace(learning.modePlace());
      return;
    }
    const path = await startedProjectPath();
    if (!path) throw new Error("This Vibe64 has no started project. Start Vibe64 in a project folder.");
    await router.replace(path);
  } catch (cause) {
    error.value = String(cause?.message || "Your project could not be opened. Try again.");
  } finally {
    resolving = false;
  }
}

// The mode is read once the overlay binds the viewer (without Learning: Develop).
watch(() => !learning || learning.state.modeRead, ready => { if (ready) void resolve(); }, { immediate: true });
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
