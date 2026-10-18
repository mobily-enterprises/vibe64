<script setup>
import { computed } from "vue";
import { courseArt, courseMonogram } from "./courseArt.js";

// Decorative course cover. The pattern comes from the course ID; the lesson
// path mirrors the supplied saved statuses only (it is hidden from assistive
// technology because the card states the same progress in text).
const props = defineProps({
  courseId: { type: String, required: true },
  title: { type: String, default: "" },
  statuses: { type: Array, default: () => [] }
});
const art = computed(() => courseArt(props.courseId));
const monogram = computed(() => courseMonogram(props.title));
const rand = index => ((art.value.seed >>> (index % 24)) ^ (index * 2654435761)) >>> 0;

const waves = computed(() => [0, 1, 2].map(row => {
  const y = 34 + row * 30 + rand(row) % 10;
  const amp = 8 + rand(row + 3) % 10;
  return `M -10 ${y} C 60 ${y - amp}, 100 ${y + amp}, 170 ${y} S 280 ${y - amp}, 340 ${y}`;
}));
const orbits = computed(() => ({ cx: 230 + rand(1) % 60, cy: 20 + rand(2) % 50, radii: [26, 52, 80, 110] }));
const dots = computed(() => {
  const list = [];
  for (let y = 14; y < 120; y += 18) for (let x = 120; x < 330; x += 18) list.push({ x, y, on: rand(x * 7 + y) % 7 === 0 });
  return list;
});
const peaks = computed(() => [0, 1, 2].map(layer => {
  const base = 120;
  const step = 70 - layer * 12;
  let d = `M -10 ${base}`;
  for (let x = -10, i = 0; x < 340; x += step, i++) d += ` L ${x + step / 2} ${50 + layer * 18 + rand(layer * 9 + i) % 26} L ${x + step} ${base - 10 + layer * 4}`;
  return `${d} L 340 ${base} Z`;
}));

// One node per lesson (capped) along a gentle path across the cover.
const path = computed(() => {
  const statuses = props.statuses.slice(0, 12);
  const count = statuses.length;
  if (!count) return null;
  const start = 108; const end = 300;
  const nodes = statuses.map((status, index) => {
    const x = count === 1 ? (start + end) / 2 : start + (end - start) * index / (count - 1);
    const y = 84 - Math.sin(index / Math.max(1, count - 1) * Math.PI) * 26;
    return { x, y, status };
  });
  const d = nodes.map((node, index) => `${index ? "L" : "M"} ${node.x.toFixed(1)} ${node.y.toFixed(1)}`).join(" ");
  return { nodes, d };
});
</script>

<template>
  <div class="training-course-art" aria-hidden="true">
    <svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient :id="`${art.id}-bg`" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" :stop-color="art.from" />
          <stop offset="1" :stop-color="art.to" />
        </linearGradient>
        <radialGradient :id="`${art.id}-glow`" cx="0.85" cy="0.1" r="0.7">
          <stop offset="0" :stop-color="art.accent" stop-opacity="0.55" />
          <stop offset="1" :stop-color="art.accent" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="120" :fill="`url(#${art.id}-bg)`" />
      <rect width="320" height="120" :fill="`url(#${art.id}-glow)`" />
      <g v-if="art.pattern === 'waves'" fill="none" stroke="#fff" stroke-linecap="round">
        <path v-for="(d, index) in waves" :key="index" :d="d" :stroke-opacity="0.14 + index * 0.06" :stroke-width="10 - index * 3" />
      </g>
      <g v-else-if="art.pattern === 'orbits'" fill="none" stroke="#fff">
        <circle v-for="(r, index) in orbits.radii" :key="r" :cx="orbits.cx" :cy="orbits.cy" :r="r" :stroke-opacity="0.26 - index * 0.05" stroke-width="2" />
        <circle :cx="orbits.cx" :cy="orbits.cy" r="10" :fill="art.accent" fill-opacity="0.7" stroke="none" />
      </g>
      <g v-else-if="art.pattern === 'grid'">
        <circle v-for="dot in dots" :key="`${dot.x}-${dot.y}`" :cx="dot.x" :cy="dot.y" :r="dot.on ? 3.2 : 1.6"
          :fill="dot.on ? art.accent : '#fff'" :fill-opacity="dot.on ? 0.9 : 0.28" />
      </g>
      <g v-else fill="#fff">
        <path v-for="(d, index) in peaks" :key="index" :d="d" :fill-opacity="0.08 + index * 0.06" />
      </g>
      <g v-if="path" class="training-course-art__path">
        <path :d="path.d" fill="none" stroke="#fff" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="2 6" stroke-linecap="round" />
        <g v-for="(node, index) in path.nodes" :key="index">
          <circle :cx="node.x" :cy="node.y" r="7.5" :fill="node.status === 'completed' ? '#fff' : 'rgba(0,0,0,0.18)'"
            stroke="#fff" :stroke-opacity="node.status === 'not-started' ? 0.6 : 1" stroke-width="2" />
          <path v-if="node.status === 'completed'" :d="`M ${node.x - 3.2} ${node.y} l 2.2 2.3 l 4.2 -4.6`" fill="none"
            :stroke="art.from" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle v-else-if="node.status === 'in-progress'" :cx="node.x" :cy="node.y" r="3" fill="#fff" />
        </g>
      </g>
    </svg>
    <span class="training-course-art__monogram">{{ monogram }}</span>
  </div>
</template>

<style scoped>
.training-course-art { position: relative; height: 112px; overflow: hidden; isolation: isolate; }
.training-course-art svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.training-course-art__monogram {
  position: absolute; left: var(--v64-space-4, 16px); bottom: var(--v64-space-3, 12px);
  display: grid; place-items: center; width: 48px; height: 48px;
  border-radius: var(--v64-shape-md, 12px);
  background: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(6px); color: #fff; font: 700 1.125rem/1 system-ui, sans-serif; letter-spacing: 0.02em;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
</style>
