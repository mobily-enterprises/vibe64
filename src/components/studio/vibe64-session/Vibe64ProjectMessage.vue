<template>
  <article class="vibe64-project-message" :class="{ 'vibe64-project-message--sent': sent }" :aria-label="sent ? 'Sent agent message' : 'Received agent message'">
    <header>
      <v-icon :icon="mdiRobotOutline" size="28" aria-hidden="true" />
      <div>
        <strong>{{ details.sourceProject }} assistant</strong>
        <div class="text-body-small">
          {{ sent ? 'To' : 'From' }}
          <a :href="projectLink">{{ sent ? details.projectSlug : details.sourceProject }}</a>
          · {{ sent ? details.sessionId : details.sourceSession }}
        </div>
      </div>
    </header>
    <p class="vibe64-project-message__body">{{ details.body }}</p>
    <p v-if="sent" class="text-body-small" :role="details.status === 'failed' ? 'alert' : 'status'">
      {{ details.status === 'delivered' ? 'Delivered to assistant' : details.status === 'failed' ? 'Delivery failed' : 'Accepted · delivery not confirmed' }}
      <template v-if="details.error"> — {{ details.error }}</template>
    </p>
    <small v-else>Agent coordination · existing permissions apply</small>
    <time v-if="at" class="vibe64-project-message__time">{{ at }}</time>
  </article>
</template>

<script setup>
import { computed } from "vue";
import { mdiRobotOutline } from "@mdi/js";

const props = defineProps({ details: { type: Object, required: true }, at: { type: String, default: "" } });
const sent = computed(() => props.details.direction === "sent");
const projectLink = computed(() => `/app/project/${encodeURIComponent(sent.value ? props.details.projectSlug : props.details.sourceProject)}?session=${encodeURIComponent(sent.value ? props.details.sessionId : props.details.sourceSession)}&chat=main`);
</script>

<style scoped>
.vibe64-project-message { width: fit-content; max-width: min(95%, 44rem); margin-right: auto; padding: 14px 16px; border-radius: 12px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.vibe64-project-message--sent { margin-right: 0; margin-left: auto; }
.vibe64-project-message__time { display: block; margin-top: 8px; font-size: .75rem; }
.vibe64-project-message header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.vibe64-project-message__body { white-space: pre-wrap; margin-bottom: 12px; }
.vibe64-project-message a { color: inherit; text-decoration: underline; }
</style>
