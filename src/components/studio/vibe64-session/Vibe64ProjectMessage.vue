<template>
  <article class="vibe64-project-message" :class="{ 'vibe64-project-message--sent': sent }" :aria-label="sent ? 'Sent agent message' : 'Received agent message'">
    <span class="vibe64-project-message__avatar" aria-hidden="true">
      <v-icon :icon="mdiRobotOutline" size="20" />
    </span>
    <div class="vibe64-project-message__bubble">
      <header>
        <div>
          <strong>{{ details.sourceProject }} assistant</strong>
          <div class="text-body-small">
            {{ sent ? 'To' : 'From' }}
            <a :href="projectLink">{{ sent ? details.projectSlug : details.sourceProject }}</a>
            · {{ sent ? details.sessionId : details.sourceSession }}
          </div>
        </div>
      </header>
      <LongTextPreviewBlocks class="vibe64-project-message__body" :blocks="blocks" />
      <button v-if="preview" type="button" class="vibe64-project-message__toggle" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? 'Show less' : 'Read more' }}
      </button>
      <p v-if="sent" class="text-body-small" :role="details.status === 'failed' ? 'alert' : 'status'">
        {{ details.status === 'delivered' ? 'Delivered to assistant' : details.status === 'failed' ? 'Delivery failed' : 'Accepted · delivery not confirmed' }}
        <template v-if="details.error"> — {{ details.error }}</template>
      </p>
      <time v-if="at" class="vibe64-project-message__time">{{ at }}</time>
    </div>
  </article>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiRobotOutline } from "@mdi/js";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";

const props = defineProps({ details: { type: Object, required: true }, at: { type: String, default: "" } });
const sent = computed(() => props.details.direction === "sent");
const expanded = ref(false);
watch(() => props.details.body, () => { expanded.value = false; });
const preview = computed(() => {
  const text = String(props.details.body || "");
  const lines = text.split(/\r\n?|\n/u);
  if ([...text].length <= 360 && lines.length <= 4) return "";
  return `${[...lines.slice(0, 4).join("\n")].slice(0, 280).join("").trimEnd()}…`;
});
const blocks = computed(() => parseLongTextReviewBlocks(
  !expanded.value && preview.value ? preview.value : props.details.body,
  { preserveParagraphLineBreaks: true }
));
const projectLink = computed(() => `/app/project/${encodeURIComponent(sent.value ? props.details.projectSlug : props.details.sourceProject)}?session=${encodeURIComponent(sent.value ? props.details.sessionId : props.details.sourceSession)}&chat=main`);
</script>

<style scoped>
.vibe64-project-message { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: .65rem; width: fit-content; max-width: min(28rem, 88%); margin-right: auto; color: rgb(var(--v-theme-on-surface)); overflow-wrap: anywhere; }
.vibe64-project-message--sent { grid-template-columns: minmax(0, 1fr) auto; margin-right: 0; margin-left: auto; }
.vibe64-project-message__avatar { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; margin-top: .2rem; border-radius: 50%; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.vibe64-project-message--sent .vibe64-project-message__avatar { grid-column: 2; grid-row: 1; }
.vibe64-project-message__bubble { min-width: 0; padding: .75rem 1rem .72rem; border: 1px solid rgba(var(--v-theme-on-surface), .18); border-radius: 16px; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.vibe64-project-message--sent .vibe64-project-message__bubble { grid-column: 1; grid-row: 1; }
.vibe64-project-message__time { display: block; margin-top: 8px; font-size: .75rem; }
.vibe64-project-message header { margin-bottom: 12px; }
.vibe64-project-message__body { margin-bottom: 12px; }
.vibe64-project-message__toggle { display: block; margin-bottom: 12px; color: rgb(var(--v-theme-primary)); font: inherit; text-align: left; }
.vibe64-project-message a { color: inherit; text-decoration: underline; }
</style>
