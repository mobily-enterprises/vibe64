<template>
  <div
    class="studio-long-text-review__blocks"
    :class="{ 'studio-long-text-review__blocks--compact': compact }"
  >
    <template
      v-for="(block, blockIndex) in blocks"
      :key="blockKey(block, blockIndex)"
    >
      <component
        :is="headingTag(block.level)"
        v-if="block.type === 'heading'"
        class="studio-long-text-review__heading"
      >
        <LongTextInlineParts :text="block.text" />
      </component>
      <component
        :is="block.type"
        v-else-if="isListBlock(block)"
        class="studio-long-text-review__list"
      >
        <li
          v-for="(item, itemIndex) in block.items"
          :key="`item:${blockIndex}:${itemIndex}`"
        >
          <LongTextInlineParts :text="item.text" />
        </li>
      </component>
      <pre
        v-else-if="block.type === 'code'"
        class="studio-long-text-review__code"
      ><code>{{ block.text }}</code></pre>
      <p
        v-else
        class="studio-long-text-review__paragraph"
      >
        <LongTextInlineParts :text="block.text" />
      </p>
    </template>
  </div>
</template>

<script setup>
import LongTextInlineParts from "@/components/studio/LongTextInlineParts.vue";

defineProps({
  blocks: {
    type: Array,
    required: true
  },
  compact: {
    type: Boolean,
    default: false
  }
});

function isListBlock(block) {
  return block.type === "ul" || block.type === "ol";
}

function blockKey(block, blockIndex) {
  return `${block.type}:${blockIndex}`;
}

function headingTag(level) {
  if (level <= 1) {
    return "h3";
  }
  if (level === 2) {
    return "h4";
  }
  return "h5";
}
</script>

<style scoped>
.studio-long-text-review__blocks {
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.36rem;
  line-height: 1.4;
}

.studio-long-text-review__blocks--compact {
  gap: 0.24rem;
  line-height: 1.28;
}

.studio-long-text-review__heading {
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

h3.studio-long-text-review__heading {
  font-size: 1.1rem;
}

h4.studio-long-text-review__heading {
  font-size: 0.98rem;
}

h5.studio-long-text-review__heading {
  font-size: 0.9rem;
}

.studio-long-text-review__paragraph {
  font-size: 0.88rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-long-text-review__blocks--compact .studio-long-text-review__paragraph {
  font-size: 0.8rem;
}

.studio-long-text-review__list {
  display: grid;
  gap: 0.16rem;
  margin: 0;
  padding-inline-start: 1.3rem;
}

.studio-long-text-review__list li {
  font-size: 0.92rem;
  line-height: 1.36;
  padding-inline-start: 0.1rem;
}

.studio-long-text-review__blocks--compact .studio-long-text-review__list li {
  font-size: 0.8rem;
}

.studio-long-text-review__code {
  background: rgba(var(--v-theme-surface-variant), 0.58);
  border: 1px solid rgba(var(--v-border-color), 0.26);
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.36;
  margin: 0;
  overflow: auto;
  padding: 0.46rem 0.55rem;
  white-space: pre;
}
</style>
