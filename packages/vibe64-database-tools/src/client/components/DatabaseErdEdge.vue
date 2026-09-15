<template>
  <BaseEdge
    :id="id"
    :interaction-width="20"
    :marker-end="markerEnd"
    :path="edgePath[0]"
    :style="style"
  />
  <EdgeText
    v-if="data.emphasized"
    :x="sourceX + (sourcePosition === 'left' ? -38 : 38)"
    :y="sourceY - 12"
    :label="data.cardinality.parent"
    :label-show-bg="true"
    :label-bg-padding="[3, 2]"
  />
  <EdgeText
    v-if="data.emphasized"
    :x="targetX + (targetPosition === 'left' ? -38 : 38)"
    :y="targetY - 12"
    :label="data.cardinality.child"
    :label-show-bg="true"
    :label-bg-padding="[3, 2]"
  />
</template>

<script setup>
import { computed } from "vue";
import { BaseEdge, EdgeText } from "@vue-flow/core";
import { erdPolylinePath } from "../../shared/erdRouting.js";

defineOptions({ inheritAttrs: false });

const props = defineProps({
  data: { default: () => ({}), type: Object },
  id: { required: true, type: String },
  markerEnd: { default: "", type: String },
  sourceX: { required: true, type: Number },
  sourceY: { required: true, type: Number },
  sourcePosition: { default: "right", type: String },
  targetX: { required: true, type: Number },
  targetY: { required: true, type: Number },
  targetPosition: { default: "left", type: String },
  style: { default: () => ({}), type: Object }
});
const edgePath = computed(() => erdPolylinePath(props.data.points));
</script>
