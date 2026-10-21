<script setup>
// A smiling learner, hand raised, with an open book and a bright idea: the
// welcome of Learn mode with no lesson in progress. Decorative only.
</script>

<template>
  <svg
    class="vibe64-learner-art"
    viewBox="0 0 320 240"
    aria-hidden="true"
    focusable="false"
  >
    <!-- Backdrop: a Learning yellow disc, a softer halo and the learning path. -->
    <circle class="vibe64-learner-art__halo" cx="160" cy="128" r="112" />
    <circle class="vibe64-learner-art__disc" cx="160" cy="132" r="92" />
    <path
      class="vibe64-learner-art__path"
      d="M34 206 C60 170 66 128 98 104 C122 86 112 52 140 34"
    />
    <circle class="vibe64-learner-art__node" cx="34" cy="206" r="6" />
    <circle class="vibe64-learner-art__node" cx="98" cy="104" r="6" />
    <ellipse class="vibe64-learner-art__shadow" cx="160" cy="222" rx="74" ry="7" />

    <!-- Raised arm (behind the body), with the hand up: "me, me!". -->
    <g class="vibe64-learner-art__wave">
      <path class="vibe64-learner-art__sleeve" d="M194 150 C206 128 214 108 222 90" />
      <circle class="vibe64-learner-art__skin" cx="224" cy="82" r="10" />
      <path class="vibe64-learner-art__skin" d="M218 76 q-1 -12 4 -13 q4 0 4 10 z" />
    </g>

    <!-- Body: a cosy sweater with a collar. -->
    <path class="vibe64-learner-art__sweater" d="M106 222 C106 162 128 136 160 136 C192 136 214 162 214 222 Z" />
    <path class="vibe64-learner-art__collar" d="M146 138 L160 154 L174 138 Z" />
    <rect class="vibe64-learner-art__skin" x="151" y="122" width="18" height="18" rx="6" />

    <!-- Head: ears, face, hair, happy eyes, cheeks and a big smile. -->
    <circle class="vibe64-learner-art__skin" cx="129" cy="98" r="7" />
    <circle class="vibe64-learner-art__skin" cx="191" cy="98" r="7" />
    <circle class="vibe64-learner-art__skin" cx="160" cy="96" r="31" />
    <path
      class="vibe64-learner-art__hair"
      d="M128 94 C124 66 142 54 162 54 C186 54 198 70 192 94 C188 82 178 74 166 76 C170 70 168 66 166 64 C158 76 142 78 128 94 Z"
    />
    <path class="vibe64-learner-art__eye" d="M144 96 q6 -7 12 0" />
    <path class="vibe64-learner-art__eye" d="M164 96 q6 -7 12 0" />
    <circle class="vibe64-learner-art__cheek" cx="141" cy="107" r="5" />
    <circle class="vibe64-learner-art__cheek" cx="179" cy="107" r="5" />
    <path class="vibe64-learner-art__mouth" d="M149 108 Q160 123 171 108 Z" />

    <!-- An open book held at the chest. -->
    <path class="vibe64-learner-art__cover" d="M112 168 L160 176 L208 168 L208 206 L160 214 L112 206 Z" />
    <path class="vibe64-learner-art__page" d="M117 166 L160 174 L160 208 L117 200 Z" />
    <path class="vibe64-learner-art__page" d="M160 174 L203 166 L203 200 L160 208 Z" />
    <path class="vibe64-learner-art__line" d="M125 176 l26 5 M125 184 l26 5 M125 192 l18 3.5 M169 181 l26 -5 M169 189 l26 -5 M169 197 l18 -3.5" />
    <circle class="vibe64-learner-art__skin" cx="114" cy="190" r="9" />
    <circle class="vibe64-learner-art__skin" cx="206" cy="190" r="9" />

    <!-- The bright idea above the raised hand. -->
    <g class="vibe64-learner-art__idea">
      <path class="vibe64-learner-art__ray" d="M248 14 v-9 M270 24 l7 -7 M226 24 l-7 -7 M278 44 h9 M218 44 h-9" />
      <circle class="vibe64-learner-art__bulb" cx="248" cy="42" r="17" />
      <path class="vibe64-learner-art__filament" d="M242 46 q3 -8 6 0 q3 -8 6 0" />
      <rect class="vibe64-learner-art__base" x="241" y="58" width="14" height="9" rx="3" />
    </g>

    <!-- Sparkles. -->
    <path class="vibe64-learner-art__spark vibe64-learner-art__spark--a" d="M70 58 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" />
    <path class="vibe64-learner-art__spark vibe64-learner-art__spark--b" d="M276 112 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
    <path class="vibe64-learner-art__spark vibe64-learner-art__spark--c" d="M246 182 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5 z" />
  </svg>
</template>

<style scoped>
.vibe64-learner-art {
  --learner-skin: #f4c7a1;
  --learner-hair: #4a3326;
  --learner-ink: #2b2118;
  display: block;
  height: auto;
  max-width: 100%;
  overflow: visible;
  width: 17rem;
}

.vibe64-learner-art__halo {
  fill: var(--v64-learning-tint);
}

.vibe64-learner-art__disc {
  fill: var(--v64-learning-container);
}

.vibe64-learner-art__path {
  fill: none;
  stroke: var(--v64-primary);
  stroke-dasharray: 2 7;
  stroke-linecap: round;
  stroke-opacity: 0.45;
  stroke-width: 3;
}

.vibe64-learner-art__node {
  fill: color-mix(in srgb, var(--v64-primary) 55%, transparent);
}

.vibe64-learner-art__shadow {
  fill: var(--learner-ink);
  opacity: 0.1;
}

.vibe64-learner-art__skin {
  fill: var(--learner-skin);
}

.vibe64-learner-art__hair {
  fill: var(--learner-hair);
}

.vibe64-learner-art__sweater {
  fill: var(--v64-primary);
}

.vibe64-learner-art__sleeve {
  fill: none;
  stroke: var(--v64-primary);
  stroke-linecap: round;
  stroke-width: 20;
}

.vibe64-learner-art__collar {
  fill: var(--v64-primary-container);
}

.vibe64-learner-art__eye {
  fill: none;
  stroke: var(--learner-ink);
  stroke-linecap: round;
  stroke-width: 3.2;
}

.vibe64-learner-art__cheek {
  fill: #f08a7e;
  opacity: 0.55;
}

.vibe64-learner-art__mouth {
  fill: #8c2f22;
  stroke: #8c2f22;
  stroke-linejoin: round;
  stroke-width: 2;
}

.vibe64-learner-art__cover {
  fill: var(--v64-learning-strong);
}

.vibe64-learner-art__page {
  fill: #fffdf6;
  stroke: color-mix(in srgb, var(--v64-learning-strong) 60%, #fffdf6);
  stroke-linejoin: round;
  stroke-width: 1.5;
}

.vibe64-learner-art__line {
  fill: none;
  stroke: color-mix(in srgb, var(--v64-primary) 40%, #fffdf6);
  stroke-linecap: round;
  stroke-width: 2.4;
}

.vibe64-learner-art__bulb {
  fill: var(--v64-learning);
  filter: drop-shadow(0 0 8px var(--v64-learning-glow));
}

.vibe64-learner-art__filament {
  fill: none;
  stroke: #8a6a00;
  stroke-linecap: round;
  stroke-width: 2;
}

.vibe64-learner-art__base {
  fill: color-mix(in srgb, var(--learner-ink) 55%, #c9c4b8);
}

.vibe64-learner-art__ray {
  fill: none;
  stroke: var(--v64-learning-strong);
  stroke-linecap: round;
  stroke-width: 3.5;
}

.vibe64-learner-art__spark {
  fill: var(--v64-learning-strong);
}

.vibe64-learner-art__spark--b {
  fill: var(--v64-primary);
  opacity: 0.7;
}

/* Gentle life: the idea floats, the hand waves, the sparkles twinkle. */
.vibe64-learner-art__idea {
  animation: vibe64-learner-float 3.2s ease-in-out infinite;
}

.vibe64-learner-art__wave {
  animation: vibe64-learner-wave 2.4s ease-in-out infinite;
  transform-box: view-box;
  transform-origin: 194px 150px;
}

.vibe64-learner-art__spark {
  animation: vibe64-learner-twinkle 2.6s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

.vibe64-learner-art__spark--b {
  animation-delay: 0.9s;
}

.vibe64-learner-art__spark--c {
  animation-delay: 1.7s;
}

@keyframes vibe64-learner-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@keyframes vibe64-learner-wave {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-6deg); }
}

@keyframes vibe64-learner-twinkle {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.45; transform: scale(0.7); }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-learner-art__idea,
  .vibe64-learner-art__wave,
  .vibe64-learner-art__spark {
    animation: none;
  }
}
</style>
