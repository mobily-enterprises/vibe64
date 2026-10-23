<template>
  <v-sheet
    class="vibe64-team-ai-gate"
    rounded="lg"
    border
    role="status"
    data-test="team-ai-gate"
  >
    <div class="vibe64-team-ai-gate__icon">
      <v-icon :icon="mdiAccountGroupOutline" size="28" />
    </div>
    <h2 class="vibe64-team-ai-gate__title">Team AI isn't set up yet</h2>
    <p class="vibe64-team-ai-gate__text">
      {{ ownerAtStart }} needs to set up AI for team members before you can open projects here.
    </p>
    <p class="vibe64-team-ai-gate__ask" data-test="team-ai-gate-ask">
      Ask {{ owner }} to set up AI for team members.
    </p>
    <div class="vibe64-team-ai-gate__actions">
      <v-btn
        color="primary"
        variant="flat"
        min-height="48"
        :loading="checking"
        data-test="team-ai-gate-check"
        @click="$emit('check')"
      >
        Check again
      </v-btn>
      <v-btn
        v-if="projectsPath"
        variant="text"
        min-height="48"
        :to="projectsPath"
        data-test="team-ai-gate-projects"
      >
        Back to projects
      </v-btn>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed } from "vue";
import { mdiAccountGroupOutline } from "@mdi/js";

const props = defineProps({
  checking: { type: Boolean, default: false },
  ownerName: { type: String, default: "" },
  // The host's project list, when it has one.
  projectsPath: { type: String, default: "" }
});

defineEmits(["check"]);

const owner = computed(() => props.ownerName.trim() || "the workspace owner");
const ownerAtStart = computed(() => props.ownerName.trim() || "The workspace owner");
</script>

<style scoped>
.vibe64-team-ai-gate {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
  margin-inline: auto;
  max-width: min(36rem, 100%);
  padding: 1.5rem;
  width: 100%;
}

.vibe64-team-ai-gate__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  height: 3rem;
  justify-content: center;
  width: 3rem;
}

.vibe64-team-ai-gate__title {
  font-size: 1.25rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.vibe64-team-ai-gate__text {
  color: rgba(var(--v-theme-on-surface), 0.72);
  margin: 0;
}

.vibe64-team-ai-gate__ask {
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 0.5rem;
  font-weight: 600;
  margin: 0.25rem 0;
  padding: 0.85rem 1rem;
  width: 100%;
}

.vibe64-team-ai-gate__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 599px) {
  .vibe64-team-ai-gate {
    padding: 1.25rem 1rem;
  }

  .vibe64-team-ai-gate__actions {
    display: grid;
    width: 100%;
  }
}
</style>
