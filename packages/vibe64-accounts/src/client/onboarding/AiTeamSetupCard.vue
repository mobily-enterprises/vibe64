<script setup>
import { mdiAccountGroupOutline, mdiAlertCircleOutline, mdiCheckCircle } from "@mdi/js";

// The owner's guided team step: once Claude is the main AI, one DeepSeek key
// (running inside Claude Code) gives team members their own models.
defineProps({
  // "offer" before the team setup has a model, "ready" once this card filled it.
  state: { type: String, default: "offer" },
  // DeepSeek already works in Claude Code: no key step.
  keyConnected: Boolean,
  busy: Boolean,
  error: { type: String, default: "" },
  summary: { type: String, default: "" }
});
const emit = defineEmits(["add", "snooze", "review"]);
</script>

<template>
  <section class="ai-team-card" :class="{ 'ai-team-card--ready': state === 'ready' }" aria-labelledby="ai-team-card-title" tabindex="-1">
    <span class="ai-team-card__icon" aria-hidden="true">
      <v-icon :icon="state === 'ready' ? mdiCheckCircle : mdiAccountGroupOutline" size="24" />
    </span>
    <div class="ai-team-card__body">
      <h2 id="ai-team-card-title" class="ai-team-card__title">{{ state === "ready" ? "Team AI is ready" : "Let your team use this workspace" }}</h2>
      <p v-if="state === 'ready'" class="ai-team-card__text">{{ summary }}</p>
      <p v-else class="ai-team-card__text">
        Your Claude plan is for you only. Add a DeepSeek key (runs inside Claude Code) and team members get Colleague,
        Fix it with AI and helpers. You still approve what they send to main chat.
      </p>
      <p v-if="error" class="ai-team-card__error" role="alert">
        <v-icon :icon="mdiAlertCircleOutline" size="18" aria-hidden="true" />{{ error }}
      </p>
      <div class="ai-team-card__actions">
        <v-btn v-if="state === 'ready'" color="primary" variant="tonal" @click="emit('review')">Review team models</v-btn>
        <template v-else>
          <v-btn color="primary" variant="flat" :loading="busy" :disabled="busy" @click="emit('add')">
            {{ keyConnected ? "Use DeepSeek for team members" : "Add a DeepSeek key" }}
          </v-btn>
          <v-btn variant="text" :disabled="busy" @click="emit('snooze')">Not now</v-btn>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-team-card {
  background: color-mix(in srgb, var(--v64-primary-container) 40%, var(--v64-surface));
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  gap: var(--v64-space-4);
  margin: 0 0 var(--v64-space-6);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.ai-team-card:focus-visible { outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color); outline-offset: var(--v64-focus-ring-offset); }
.ai-team-card--ready { background: color-mix(in srgb, var(--v64-success-container) 55%, var(--v64-surface)); }
.ai-team-card__icon {
  align-items: center;
  background: var(--v64-surface);
  border-radius: var(--v64-shape-full);
  color: var(--v64-primary);
  display: inline-flex;
  flex: none;
  height: 44px;
  justify-content: center;
  width: 44px;
}
.ai-team-card--ready .ai-team-card__icon { color: var(--v64-success); }
.ai-team-card__body { display: grid; gap: var(--v64-space-2); min-width: 0; }
.ai-team-card__title { font: var(--v64-type-title-md); margin: 0; }
.ai-team-card__text { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 0; max-width: 62ch; }
.ai-team-card__error { align-items: center; color: rgb(var(--v-theme-error)); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.ai-team-card__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-2); margin-top: var(--v64-space-1); }
.ai-team-card__actions .v-btn { min-height: 44px; }
@media (max-width: 599.98px) {
  .ai-team-card { padding: var(--v64-space-4); }
  .ai-team-card__actions .v-btn { flex: 1 1 100%; min-height: 48px; }
}
</style>
