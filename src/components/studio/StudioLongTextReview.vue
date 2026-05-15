<template>
  <div class="studio-long-text-review">
    <section class="studio-long-text-review__surface" :class="{ 'studio-long-text-review__surface--empty': !contentText }">
      <header class="studio-long-text-review__header">
        <div class="studio-long-text-review__title-block">
          <h3>{{ label }}</h3>
          <span>{{ contentMeta }}</span>
        </div>
        <div class="studio-long-text-review__actions">
          <v-btn
            :icon="mdiContentCopy"
            :disabled="!contentText"
            :aria-label="copyButtonLabel"
            :title="copyButtonLabel"
            size="small"
            variant="text"
            @click="copyText"
          />
          <v-btn
            :icon="mdiFullscreen"
            :aria-label="expandButtonLabel"
            :title="expandButtonLabel"
            size="small"
            variant="text"
            @click="openExpandedReview"
          />
        </div>
      </header>

      <div class="studio-long-text-review__preview studio-long-text-review__preview--compact">
        <LongTextPreviewBlocks
          v-if="contentBlocks.length"
          :blocks="contentBlocks"
          compact
        />
        <p v-else class="studio-long-text-review__empty">{{ emptyMessage }}</p>
      </div>

      <footer class="studio-long-text-review__footer">
        <span>{{ copyStatus || footerText }}</span>
        <v-btn
          color="primary"
          density="compact"
          size="small"
          variant="tonal"
          @click="openExpandedReview"
        >
          {{ reviewButtonLabel }}
        </v-btn>
      </footer>
    </section>

    <v-dialog
      v-model="expanded"
      fullscreen
      transition="dialog-bottom-transition"
    >
      <v-card class="studio-long-text-review__dialog">
        <v-toolbar
          border
          class="studio-long-text-review__toolbar"
          color="surface"
          density="comfortable"
        >
          <v-btn
            :icon="mdiClose"
            :aria-label="closeButtonLabel"
            :title="closeButtonLabel"
            variant="text"
            @click="closeExpandedReview"
          />
          <v-toolbar-title class="studio-long-text-review__toolbar-title">
            {{ label }}
          </v-toolbar-title>
          <v-spacer />
          <v-btn-toggle
            v-model="expandedMode"
            mandatory
            density="compact"
            variant="tonal"
            class="studio-long-text-review__mode-toggle"
          >
            <v-btn value="preview" size="small" :prepend-icon="mdiEyeOutline">
              Preview
            </v-btn>
            <v-btn value="edit" size="small" :prepend-icon="mdiPencilOutline">
              Edit
            </v-btn>
          </v-btn-toggle>
          <v-btn
            :icon="mdiContentCopy"
            :disabled="!contentText"
            :aria-label="copyButtonLabel"
            :title="copyButtonLabel"
            variant="text"
            @click="copyText"
          />
          <v-btn
            v-if="showSubmit"
            color="primary"
            variant="flat"
            :disabled="submitDisabled"
            :loading="submitLoading"
            :prepend-icon="mdiCheckCircleOutline"
            @click="$emit('submit', $event)"
          >
            {{ submitLabel }}
          </v-btn>
        </v-toolbar>

        <v-card-text class="studio-long-text-review__dialog-body">
          <div class="studio-long-text-review__dialog-meta">
            <span>{{ contentMeta }}</span>
            <span v-if="copyStatus">{{ copyStatus }}</span>
          </div>

          <div v-if="expandedMode === 'preview'" class="studio-long-text-review__preview studio-long-text-review__preview--expanded">
            <LongTextPreviewBlocks
              v-if="contentBlocks.length"
              :blocks="contentBlocks"
            />
            <p v-else class="studio-long-text-review__empty">{{ emptyMessage }}</p>
          </div>

          <v-textarea
            v-else
            v-model="editableText"
            :label="label"
            :placeholder="placeholder || ''"
            variant="outlined"
            auto-grow
            rows="18"
            class="studio-long-text-review__editor"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { computed, defineComponent, h, ref } from "vue";
import {
  mdiCheckCircleOutline,
  mdiClose,
  mdiContentCopy,
  mdiEyeOutline,
  mdiFullscreen,
  mdiPencilOutline
} from "@mdi/js";

const props = defineProps({
  label: {
    type: String,
    default: "Text"
  },
  contentLabel: {
    type: String,
    default: ""
  },
  emptyMessage: {
    type: String,
    default: ""
  },
  footerText: {
    type: String,
    default: "Expand for focused review and editing."
  },
  modelValue: {
    type: String,
    default: ""
  },
  placeholder: {
    type: String,
    default: ""
  },
  reviewButtonLabel: {
    type: String,
    default: ""
  },
  showSubmit: {
    type: Boolean,
    default: false
  },
  submitDisabled: {
    type: Boolean,
    default: false
  },
  submitLabel: {
    type: String,
    default: "Save"
  },
  submitLoading: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(["submit", "update:modelValue"]);

const expanded = ref(false);
const expandedMode = ref("preview");
const copyStatus = ref("");

const editableText = computed({
  get() {
    return props.modelValue || "";
  },
  set(value) {
    emit("update:modelValue", value);
  }
});

const contentText = computed(() => String(props.modelValue || "").trim());
const contentBlocks = computed(() => parseMarkdownBlocks(contentText.value));
const normalizedContentLabel = computed(() => {
  const label = String(props.contentLabel || props.label || "text").trim();
  return label ? label.toLowerCase() : "text";
});
const contentMeta = computed(() => {
  if (!contentText.value) {
    return "Empty";
  }
  const lineCount = contentText.value.split("\n").length;
  const wordCount = contentText.value.split(/\s+/u).filter(Boolean).length;
  return `${wordCount} words - ${lineCount} lines`;
});
const copyButtonLabel = computed(() => `Copy ${normalizedContentLabel.value}`);
const expandButtonLabel = computed(() => `Expand ${normalizedContentLabel.value}`);
const closeButtonLabel = computed(() => `Close ${normalizedContentLabel.value} review`);
const emptyMessage = computed(() => props.emptyMessage || props.placeholder || `No ${normalizedContentLabel.value} yet.`);
const reviewButtonLabel = computed(() => props.reviewButtonLabel || `Review full ${normalizedContentLabel.value}`);

function openExpandedReview() {
  expandedMode.value = "preview";
  expanded.value = true;
}

function closeExpandedReview() {
  expanded.value = false;
}

async function copyText() {
  if (!contentText.value || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  try {
    await navigator.clipboard.writeText(contentText.value);
    copyStatus.value = `${sentenceCase(normalizedContentLabel.value)} copied.`;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
  }
}

function sentenceCase(value) {
  const text = String(value || "").trim();
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : "Text";
}

function parseMarkdownBlocks(value) {
  const lines = String(value || "").replace(/\r\n/gu, "\n").split("\n");
  const blocks = [];
  let paragraphLines = [];
  let listBlock = null;
  let codeLines = null;

  const flushParagraph = () => {
    const text = paragraphLines.join(" ").replace(/\s+/gu, " ").trim();
    paragraphLines = [];
    if (text) {
      blocks.push({
        text,
        type: "paragraph"
      });
    }
  };

  const flushList = () => {
    if (listBlock?.items.length) {
      blocks.push(listBlock);
    }
    listBlock = null;
  };

  const flushCode = () => {
    if (codeLines) {
      blocks.push({
        text: codeLines.join("\n").replace(/\n+$/u, ""),
        type: "code"
      });
    }
    codeLines = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/u, "");
    const trimmed = line.trim();

    if (codeLines) {
      if (/^```/u.test(trimmed)) {
        flushCode();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (/^```/u.test(trimmed)) {
      flushParagraph();
      flushList();
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/u);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
        type: "heading"
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/u);
    const orderedMatch = trimmed.match(/^\d+[.)]\s+(.*)$/u);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const type = orderedMatch ? "ol" : "ul";
      if (!listBlock || listBlock.type !== type) {
        flushList();
        listBlock = {
          items: [],
          type
        };
      }
      listBlock.items.push({
        text: (orderedMatch?.[1] || unorderedMatch?.[1] || "").trim()
      });
      continue;
    }

    flushList();
    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushCode();
  return blocks;
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

const LongTextPreviewBlocks = defineComponent({
  name: "LongTextPreviewBlocks",
  props: {
    blocks: {
      type: Array,
      required: true
    },
    compact: {
      type: Boolean,
      default: false
    }
  },
  setup(componentProps) {
    return () => h(
      "div",
      {
        class: [
          "studio-long-text-review__blocks",
          {
            "studio-long-text-review__blocks--compact": componentProps.compact
          }
        ]
      },
      componentProps.blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          return h(
            headingTag(block.level),
            {
              class: "studio-long-text-review__heading",
              key: `heading:${blockIndex}`
            },
            block.text
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          return h(
            block.type,
            {
              class: "studio-long-text-review__list",
              key: `list:${blockIndex}`
            },
            block.items.map((item, itemIndex) => h(
              "li",
              {
                key: `item:${itemIndex}`
              },
              item.text
            ))
          );
        }
        if (block.type === "code") {
          return h(
            "pre",
            {
              class: "studio-long-text-review__code",
              key: `code:${blockIndex}`
            },
            h("code", block.text)
          );
        }
        return h(
          "p",
          {
            class: "studio-long-text-review__paragraph",
            key: `paragraph:${blockIndex}`
          },
          block.text
        );
      })
    );
  }
});
</script>

<style scoped>
.studio-long-text-review {
  min-width: 0;
}

.studio-long-text-review__surface {
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-border-color), 0.42);
  border-radius: 8px;
  display: grid;
  min-width: 0;
  overflow: hidden;
}

.studio-long-text-review__surface--empty {
  border-style: dashed;
}

.studio-long-text-review__header,
.studio-long-text-review__footer {
  align-items: center;
  display: flex;
  gap: 0.55rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.44rem 0.56rem;
}

.studio-long-text-review__header {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.28);
}

.studio-long-text-review__footer {
  background: rgba(var(--v-theme-surface-variant), 0.32);
  border-top: 1px solid rgba(var(--v-border-color), 0.24);
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  line-height: 1.25;
}

.studio-long-text-review__title-block {
  min-width: 0;
}

.studio-long-text-review__title-block h3 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.86rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.studio-long-text-review__title-block span,
.studio-long-text-review__dialog-meta {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.7rem;
  font-weight: 560;
  letter-spacing: 0;
  line-height: 1.25;
}

.studio-long-text-review__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.18rem;
}

.studio-long-text-review__preview {
  min-width: 0;
  overflow: auto;
  overscroll-behavior: contain;
}

.studio-long-text-review__preview--compact {
  max-height: clamp(8rem, 21vh, 13rem);
  padding: 0.46rem 0.56rem;
}

.studio-long-text-review__preview--expanded {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.32);
  border-radius: 8px;
  margin-inline: auto;
  max-width: 76rem;
  padding: clamp(0.86rem, 1.8vw, 1.35rem);
  width: 100%;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__blocks) {
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.36rem;
  line-height: 1.4;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__blocks--compact) {
  gap: 0.24rem;
  line-height: 1.28;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__heading) {
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.studio-long-text-review__preview :deep(h3.studio-long-text-review__heading) {
  font-size: 1.1rem;
}

.studio-long-text-review__preview :deep(h4.studio-long-text-review__heading) {
  font-size: 0.98rem;
}

.studio-long-text-review__preview :deep(h5.studio-long-text-review__heading) {
  font-size: 0.9rem;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__paragraph) {
  font-size: 0.88rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__blocks--compact .studio-long-text-review__paragraph) {
  font-size: 0.8rem;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__list) {
  display: grid;
  gap: 0.16rem;
  margin: 0;
  padding-inline-start: 1.3rem;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__list li) {
  font-size: 0.92rem;
  line-height: 1.36;
  padding-inline-start: 0.1rem;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__blocks--compact .studio-long-text-review__list li) {
  font-size: 0.8rem;
}

.studio-long-text-review__preview :deep(.studio-long-text-review__code) {
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

.studio-long-text-review__empty {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
  margin: 0;
}

.studio-long-text-review__dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100dvh;
  overflow: hidden;
}

.studio-long-text-review__toolbar {
  flex: 0 0 auto;
}

.studio-long-text-review__toolbar-title {
  font-size: 1rem;
  font-weight: 720;
  letter-spacing: 0;
  min-width: 8rem;
}

.studio-long-text-review__dialog-body {
  background: rgba(var(--v-theme-surface-variant), 0.2);
  display: grid;
  gap: 0.8rem;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: auto;
  padding: clamp(0.75rem, 1.8vw, 1.2rem);
}

.studio-long-text-review__dialog-meta {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-inline: auto;
  max-width: 76rem;
  width: 100%;
}

.studio-long-text-review__editor {
  margin-inline: auto;
  max-width: 76rem;
  width: 100%;
}

.studio-long-text-review__editor :deep(.v-field__input) {
  align-items: flex-start;
  min-height: min(56rem, calc(100dvh - 10rem));
}

.studio-long-text-review__editor :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  line-height: 1.45;
}

@media (max-width: 720px) {
  .studio-long-text-review__toolbar {
    align-items: flex-start;
    flex-wrap: wrap;
    padding-bottom: 0.4rem;
  }

  .studio-long-text-review__toolbar-title {
    flex: 1 1 calc(100% - 3rem);
  }

  .studio-long-text-review__mode-toggle {
    order: 4;
    width: 100%;
  }

  .studio-long-text-review__mode-toggle :deep(.v-btn) {
    flex: 1 1 0;
  }

  .studio-long-text-review__header,
  .studio-long-text-review__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .studio-long-text-review__actions {
    align-self: flex-end;
  }

  .studio-long-text-review__footer .v-btn {
    align-self: stretch;
  }
}
</style>
