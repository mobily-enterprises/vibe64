<template>
  <Vibe64Terminal
    v-if="open"
    :collapsible="false"
    :command-preview="commandPreview"
    :disconnect-when-hidden="true"
    :error="error"
    :error-title="errorTitle"
    :expanded="true"
    :fill="fill"
    :floating-storage-key="floatingStorageKey"
    :height="height"
    mobile-takeover
    :presentation="presentation"
    show-close
    :show-copy="showCopy"
    :show-interrupt="showInterrupt"
    :stage="stage"
    :status="status"
    :subtitle="subtitle"
    :surface-class="surfaceClass"
    :surface-style="surfaceStyle"
    :terminal="terminal"
    :title="title"
    :visible="true"
    @close="hide"
    @copy="$emit('copy', $event)"
    @interrupt="$emit('interrupt')"
    @retry="$emit('retry')"
  >
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64Terminal>
</template>

<script setup>
import { watch } from "vue";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";

const props = defineProps({
  commandPreview: {
    default: "",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Run output needs attention",
    type: String
  },
  fill: {
    default: false,
    type: Boolean
  },
  floatingStorageKey: {
    default: "",
    type: String
  },
  height: {
    default: "clamp(18rem, 48vh, 34rem)",
    type: String
  },
  open: {
    default: false,
    type: Boolean
  },
  presentation: {
    default: "floating",
    type: String
  },
  showCopy: {
    default: true,
    type: Boolean
  },
  showInterrupt: {
    default: true,
    type: Boolean
  },
  stage: {
    default: "",
    type: String
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  surfaceClass: {
    default: "",
    type: [String, Array, Object]
  },
  surfaceStyle: {
    default: null,
    type: [String, Array, Object]
  },
  terminal: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Terminal>} */ (Object)
  },
  title: {
    default: "Run output",
    type: String
  }
});

const emit = defineEmits([
  "copy",
  "interrupt",
  "retry",
  "update:open"
]);

const forwardedSlots = [
  "actions-after",
  "actions-before",
  "before-terminal",
  "error-actions",
  "footer",
  "heading",
  "overlay"
];

function hide() {
  emit("update:open", false);
}

watch(() => props.open, (open) => {
  if (!open) {
    props.terminal.closeTerminalSocket();
  }
});
</script>
