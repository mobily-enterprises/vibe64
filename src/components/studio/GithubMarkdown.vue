<script setup>
import { computed } from "vue";
import DOMPurify from "dompurify";
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";
import { parseLongTextReviewBlocks } from "@jskit-ai/assistant-core/shared/conversation";

const props = defineProps({
  html: { type: String, default: "" },
  text: { type: String, default: "" }
});
// GitHub's authenticated rendering includes signed URLs for private attachments.
// Keep the original Markdown for editing and for comments still awaiting GitHub.
const sanitizedHtml = computed(() => DOMPurify.sanitize(props.html, {
  ALLOWED_TAGS: ["a", "b", "blockquote", "br", "code", "del", "details", "div", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "img", "li", "ol", "p", "pre", "s",
    "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul"],
  ALLOWED_ATTR: ["href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "start"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false
}));
const blocks = computed(() => parseLongTextReviewBlocks(props.text));
</script>

<template>
  <!-- Only the allowlisted DOMPurify result reaches v-html. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div v-if="html" class="github-markdown" v-html="sanitizedHtml" />
  <LongTextPreviewBlocks v-else :blocks="blocks" />
</template>

<style scoped>
.github-markdown { min-width: 0; overflow-wrap: anywhere; font-size: 0.88rem; line-height: 1.5; }
.github-markdown :deep(img) { max-width: 100%; height: auto; vertical-align: middle; }
.github-markdown :deep(p), .github-markdown :deep(ul), .github-markdown :deep(ol),
.github-markdown :deep(blockquote), .github-markdown :deep(pre), .github-markdown :deep(table) { margin-block: 0.6rem; }
.github-markdown :deep(:first-child) { margin-top: 0; }
.github-markdown :deep(:last-child) { margin-bottom: 0; }
.github-markdown :deep(ul), .github-markdown :deep(ol) { padding-inline-start: 1.5rem; }
.github-markdown :deep(pre) { overflow-x: auto; padding: 0.6rem; border-radius: 8px; }
.github-markdown :deep(code), .github-markdown :deep(pre) { background: rgba(var(--v-theme-surface-variant), 0.5); }
.github-markdown :deep(blockquote) { border-inline-start: 3px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding-inline-start: 1rem; }
.github-markdown :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.github-markdown :deep(th), .github-markdown :deep(td) { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding: 0.4rem 0.6rem; }
</style>
