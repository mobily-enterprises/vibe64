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
        <LongTextInlineParts
          :text="block.text"
          @link-click="emit('link-click', $event)"
        />
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
          <LongTextInlineParts
            :text="item.text"
            @link-click="emit('link-click', $event)"
          />
        </li>
      </component>
      <pre
        v-else-if="block.type === 'code'"
        class="studio-long-text-review__code"
      ><code>{{ block.text }}</code></pre>
      <div
        v-else-if="block.type === 'table'"
        class="studio-long-text-review__table-wrap"
      >
        <table class="studio-long-text-review__table">
          <thead>
            <tr>
              <th
                v-for="(header, columnIndex) in block.headers"
                :key="`header:${blockIndex}:${columnIndex}`"
                :class="tableCellClass(block, columnIndex)"
                scope="col"
              >
                <LongTextInlineParts
                  :text="header"
                  @link-click="emit('link-click', $event)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in block.rows"
              :key="`row:${blockIndex}:${rowIndex}`"
            >
              <td
                v-for="(cell, columnIndex) in row"
                :key="`cell:${blockIndex}:${rowIndex}:${columnIndex}`"
                :class="tableCellClass(block, columnIndex)"
              >
                <LongTextInlineParts
                  :text="cell"
                  @link-click="emit('link-click', $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <details
        v-else-if="block.type === 'details'"
        class="studio-long-text-review__details"
      >
        <summary class="studio-long-text-review__details-summary">
          <LongTextInlineParts
            :text="block.summary || 'Details'"
            @link-click="emit('link-click', $event)"
          />
        </summary>
        <LongTextPreviewBlocks
          class="studio-long-text-review__details-body"
          compact
          :blocks="block.blocks || []"
          @link-click="emit('link-click', $event)"
        />
      </details>
      <p
        v-else
        class="studio-long-text-review__paragraph"
      >
        <LongTextInlineParts
          :text="block.text"
          @link-click="emit('link-click', $event)"
        />
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
const emit = defineEmits(["link-click"]);

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

function tableCellClass(block = {}, columnIndex = 0) {
  const alignment = Array.isArray(block.alignments) ? block.alignments[columnIndex] : "";
  return {
    "studio-long-text-review__table-cell--center": alignment === "center",
    "studio-long-text-review__table-cell--right": alignment === "right"
  };
}
</script>

<style scoped>
.studio-long-text-review__blocks {
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.36rem;
  line-height: 1.4;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
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
  overflow-wrap: anywhere;
  word-break: break-word;
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
  word-break: break-word;
}

.studio-long-text-review__blocks--compact .studio-long-text-review__paragraph {
  font-size: 0.8rem;
}

.studio-long-text-review__list {
  display: grid;
  gap: 0.16rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-inline-start: 1.3rem;
}

.studio-long-text-review__list li {
  font-size: 0.92rem;
  line-height: 1.36;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-inline-start: 0.1rem;
  word-break: break-word;
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
  max-width: 100%;
  min-width: 0;
  overflow: auto;
  padding: 0.46rem 0.55rem;
  white-space: pre;
}

.studio-long-text-review__table-wrap {
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 8px;
  max-width: 100%;
  min-width: 0;
  overflow: auto;
}

.studio-long-text-review__table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 0.8rem;
  inline-size: 100%;
  line-height: 1.34;
  min-inline-size: min(38rem, 100%);
}

.studio-long-text-review__table th,
.studio-long-text-review__table td {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.22);
  min-width: 0;
  padding: 0.42rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.studio-long-text-review__table th {
  background: rgba(var(--v-theme-surface-variant), 0.48);
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-weight: 760;
  position: sticky;
  top: 0;
  white-space: nowrap;
  z-index: 1;
}

.studio-long-text-review__table tbody tr:last-child td {
  border-bottom: 0;
}

.studio-long-text-review__table td {
  max-inline-size: min(34rem, 64vw);
}

.studio-long-text-review__table-cell--right {
  font-variant-numeric: tabular-nums;
  text-align: right !important;
}

.studio-long-text-review__table-cell--center {
  text-align: center !important;
}

.studio-long-text-review__details {
  border: 1px solid rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  display: block;
  min-width: 0;
  overflow: hidden;
}

.studio-long-text-review__details-summary {
  background: rgba(var(--v-theme-surface-variant), 0.48);
  cursor: pointer;
  font-size: 0.82rem;
  font-weight: 650;
  line-height: 1.2;
  list-style-position: inside;
  padding: 0.42rem 0.55rem;
}

.studio-long-text-review__details-body {
  padding: 0.5rem 0.6rem 0.58rem;
}
</style>
