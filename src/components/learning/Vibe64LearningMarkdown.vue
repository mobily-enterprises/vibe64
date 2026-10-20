<script setup>
import { computed } from "vue";
import { Marked } from "marked";
import GithubMarkdown from "@/components/studio/GithubMarkdown.vue";
import { openLessonLink } from "@/lib/vibe64Learning.js";

// Lesson text is verified installed content; it is still rendered through the
// shared DOMPurify allowlist. Images are shown as their alt text: a lesson's
// pictures are its declared diagrams, never remote addresses. Links to other
// sites open in a new tab (openLessonLink), so the lesson stays open.
const props = defineProps({ text: { type: String, default: "" } });
const renderer = new Marked({
  async: false,
  gfm: true,
  walkTokens(token) {
    if (token.type !== "image") return;
    token.type = "text";
    token.raw = token.text = token.text || "";
    delete token.tokens;
  }
});
const html = computed(() => props.text ? renderer.parse(props.text) : "");
</script>

<template>
  <GithubMarkdown class="vibe64-learning-markdown" :html="html" @click="openLessonLink" />
</template>

<style scoped>
.vibe64-learning-markdown { font-size: 1rem; line-height: 1.6; }
.vibe64-learning-markdown :deep(h1), .vibe64-learning-markdown :deep(h2), .vibe64-learning-markdown :deep(h3) {
  font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif);
  margin-block: 1.25rem 0.5rem;
}
</style>
