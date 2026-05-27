<template>
  <v-dialog v-model="dialogOpen" fullscreen>
    <v-card class="vibe64-fix-codex-dialog">
      <v-card-text>
        <Vibe64FixCodexTerminal
          v-if="job && terminal"
          :job="job"
          :terminal="terminal"
          @closed="dialogOpen = false"
        />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";
import Vibe64FixCodexTerminal from "@/components/studio/Vibe64FixCodexTerminal.vue";

const props = defineProps({
  job: {
    default: null,
    type: Object
  },
  modelValue: {
    default: false,
    type: Boolean
  },
  terminal: {
    default: null,
    type: Object
  }
});
const emit = defineEmits(["update:modelValue"]);

const dialogOpen = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    emit("update:modelValue", value === true);
  }
});
</script>

<style scoped>
.vibe64-fix-codex-dialog {
  min-height: 100%;
}
</style>
