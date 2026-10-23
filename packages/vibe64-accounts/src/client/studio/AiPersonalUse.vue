<script>
// The single explanation of a personal-use AI subscription, named for the
// provider whose terms make it personal. Unknown providers get neutral wording.
const PERSONAL_PLANS = Object.freeze({
  anthropic: Object.freeze({ provider: "Anthropic", plan: "Claude subscription (Pro or Max)" }),
  openai: Object.freeze({ provider: "OpenAI", plan: "ChatGPT subscription" }),
  "zai-coding-plan": Object.freeze({ provider: "Z.AI", plan: "GLM Coding Plan" })
});

export function personalUsePlan(providerId = "") {
  return PERSONAL_PLANS[providerId] || { provider: "the provider", plan: "plan" };
}
</script>

<script setup>
import { computed, ref } from "vue";
import { mdiAccountLock } from "@mdi/js";

const props = defineProps({
  // The connection's model provider, such as anthropic, openai or zai-coding-plan.
  providerId: { type: String, default: "" },
  // chip: the marked label with the explanation link; badge: the marked label
  // alone, for places that cannot hold a link (a list option); note: a sentence
  // with the link; link: the link alone.
  variant: { type: String, default: "chip" }
});
const open = ref(false);
const plan = computed(() => personalUsePlan(props.providerId));
</script>

<template>
  <span class="ai-personal-use" :class="`ai-personal-use--${variant}`">
    <v-chip
      v-if="variant === 'chip' || variant === 'badge'" color="warning" variant="flat" size="small"
      :prepend-icon="mdiAccountLock" class="ai-personal-use__chip"
    >
      Personal use
    </v-chip>
    <span v-else-if="variant === 'note'" class="ai-personal-use__note">
      <v-icon :icon="mdiAccountLock" size="18" color="warning" aria-hidden="true" />
      <span><strong>Personal use:</strong> only the workspace owner can use this {{ plan.plan }}.</span>
    </span>
    <button v-if="variant !== 'badge'" type="button" class="ai-personal-use__link" @click.stop="open = true">What does this mean?</button>
    <v-dialog v-if="variant !== 'badge'" v-model="open" max-width="30rem" aria-labelledby="ai-personal-use-title">
      <v-card rounded="xl">
        <v-card-title id="ai-personal-use-title" class="d-flex align-center ga-2 text-wrap">
          <v-icon :icon="mdiAccountLock" color="warning" aria-hidden="true" />Personal use: only the owner can use it
        </v-card-title>
        <v-card-text>
          <p class="mb-3">This {{ plan.plan }} is a personal plan. Under {{ plan.provider }}'s terms only the person who subscribed may use it, so Vibe64 lets only the workspace owner work with it.</p>
          <p class="mb-3">Other people in this workspace cannot use it, even in the owner's projects. For them, the owner can connect a Workspace-use account, such as an API key billed by use.</p>
          <p>In Model routing, <strong>Fallback for personal models</strong> chooses the Workspace-use model that serves them wherever routing names a personal one.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="flat" color="primary" @click="open = false">Got it</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </span>
</template>

<style scoped>
.ai-personal-use { align-items: center; display: inline-flex; flex-wrap: wrap; gap: 4px 8px; }
.ai-personal-use--note { display: flex; }
.ai-personal-use__chip { font-weight: 600; letter-spacing: 0; }
.ai-personal-use__note { align-items: flex-start; display: inline-flex; gap: 6px; }
.ai-personal-use__link {
  background: none; border: 0; color: rgb(var(--v-theme-primary)); cursor: pointer; font: inherit;
  font-size: .875rem; min-height: 24px; padding: 0; text-decoration: underline; text-underline-offset: 2px;
}
.ai-personal-use__link:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
</style>
