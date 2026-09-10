<template>
  <BaseEdge :id="id" :path="path[0]" :style="style" :marker-end="markerEnd" :interaction-width="20" />
  <EdgeText :x="path[1]" :y="path[2]" :label="label" :label-show-bg="true" :label-bg-padding="[4, 3]" />
</template>
<script setup>
import { computed } from "vue";
import { BaseEdge, EdgeText, getSmoothStepPath } from "@vue-flow/core";
import { erdPolylinePath } from "../erdRouting.js";
const props = defineProps({
  id: { type: String, required: true },
  sourceX: { type: Number, required: true },
  sourceY: { type: Number, required: true },
  targetX: { type: Number, required: true },
  targetY: { type: Number, required: true },
  sourcePosition: { type: String, required: true },
  targetPosition: { type: String, required: true },
  label: { type: String, default: "" },
  markerEnd: { type: String, default: "" },
  data: { type: Object, required: true },
  style: { type: Object, default: () => ({}) }
});
defineOptions({ inheritAttrs: false });
const path = computed(() => props.data.dragging ? getSmoothStepPath(props) : erdPolylinePath(props.data.points));
</script>
