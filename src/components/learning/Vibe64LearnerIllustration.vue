<script setup>
// A smiling learner in a mortarboard, hand raised to a bright idea, built from
// circles and triangles: the welcome of Learn mode with no lesson in
// progress. Decorative only.
</script>

<template>
  <svg
    class="vibe64-learner-art"
    viewBox="0 0 320 240"
    aria-hidden="true"
    focusable="false"
  >
    <!-- Backdrop: a Learning yellow disc in a softer halo. -->
    <circle class="vibe64-learner-art__halo" cx="160" cy="130" r="108" />
    <circle class="vibe64-learner-art__disc" cx="160" cy="134" r="88" />
    <ellipse class="vibe64-learner-art__shadow" cx="160" cy="216" rx="64" ry="5" />

    <!-- Confetti. -->
    <polygon class="vibe64-learner-art__bit vibe64-learner-art__bit--primary" points="58,70 80,62 72,84" />
    <polygon class="vibe64-learner-art__bit vibe64-learner-art__bit--outline" points="266,150 284,160 264,170" />
    <polygon class="vibe64-learner-art__bit vibe64-learner-art__bit--learning" points="78,176 90,166 94,182" />
    <circle class="vibe64-learner-art__bit vibe64-learner-art__bit--learning" cx="94" cy="118" r="6" />
    <circle class="vibe64-learner-art__bit vibe64-learner-art__bit--ring" cx="56" cy="138" r="8" />
    <circle class="vibe64-learner-art__bit vibe64-learner-art__bit--primary" cx="246" cy="196" r="5" />
    <circle class="vibe64-learner-art__bit vibe64-learner-art__bit--primary" cx="284" cy="104" r="4" />

    <!-- The raised arm: a long triangle from the shoulder to a round hand. -->
    <g class="vibe64-learner-art__wave">
      <polygon class="vibe64-learner-art__body" points="174,170 190,160 230,88" />
      <circle class="vibe64-learner-art__skin" cx="230" cy="86" r="10" />
    </g>

    <!-- Body: a triangle, with a triangle collar. -->
    <polygon class="vibe64-learner-art__body" points="160,116 216,214 104,214" />
    <polygon class="vibe64-learner-art__collar" points="148,132 172,132 160,150" />

    <!-- Head: a circle with dot eyes, round cheeks and a half-circle smile. -->
    <circle class="vibe64-learner-art__skin" cx="160" cy="102" r="28" />
    <circle class="vibe64-learner-art__ink" cx="150" cy="100" r="3.4" />
    <circle class="vibe64-learner-art__ink" cx="170" cy="100" r="3.4" />
    <circle class="vibe64-learner-art__cheek" cx="143" cy="110" r="5" />
    <circle class="vibe64-learner-art__cheek" cx="177" cy="110" r="5" />
    <path class="vibe64-learner-art__smile" d="M150 110 A10 10 0 0 0 170 110 Z" />

    <!-- Mortarboard: a diamond on a cap, with a tassel. -->
    <polygon class="vibe64-learner-art__cap" points="140,80 180,80 176,90 144,90" />
    <polygon class="vibe64-learner-art__cap" points="120,74 160,60 200,74 160,88" />
    <polyline class="vibe64-learner-art__tassel" points="160,74 192,80 194,94" />
    <circle class="vibe64-learner-art__tassel-end" cx="194" cy="97" r="4.5" />

    <!-- The bright idea: a circle bulb with triangle rays. -->
    <g class="vibe64-learner-art__idea">
      <polygon class="vibe64-learner-art__ray" points="250,6 256,6 253,16" />
      <polygon class="vibe64-learner-art__ray" points="222,22 227,17 232,27" />
      <polygon class="vibe64-learner-art__ray" points="284,22 279,17 274,27" />
      <polygon class="vibe64-learner-art__ray" points="292,44 292,50 282,47" />
      <circle class="vibe64-learner-art__bulb" cx="253" cy="44" r="17" />
      <polygon class="vibe64-learner-art__base" points="245,62 261,62 257,72 249,72" />
    </g>
  </svg>
</template>

<style scoped>
.vibe64-learner-art {
  --learner-skin: #f4c7a1;
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

.vibe64-learner-art__shadow {
  fill: var(--learner-ink);
  opacity: 0.1;
}

.vibe64-learner-art__skin {
  fill: var(--learner-skin);
}

.vibe64-learner-art__body {
  fill: var(--v64-primary);
  stroke: var(--v64-primary);
  stroke-linejoin: round;
  stroke-width: 6;
}

.vibe64-learner-art__collar {
  fill: var(--v64-primary-container);
  stroke: var(--v64-primary-container);
  stroke-linejoin: round;
  stroke-width: 3;
}

.vibe64-learner-art__ink {
  fill: var(--learner-ink);
}

.vibe64-learner-art__cheek {
  fill: #f08a7e;
  opacity: 0.55;
}

.vibe64-learner-art__smile {
  fill: #8c2f22;
}

.vibe64-learner-art__cap {
  fill: var(--learner-ink);
  stroke: var(--learner-ink);
  stroke-linejoin: round;
  stroke-width: 3;
}

.vibe64-learner-art__tassel {
  fill: none;
  stroke: var(--v64-learning);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.5;
}

.vibe64-learner-art__tassel-end,
.vibe64-learner-art__bulb {
  fill: var(--v64-learning);
}

.vibe64-learner-art__bulb {
  filter: drop-shadow(0 0 8px var(--v64-learning-glow));
}

.vibe64-learner-art__base {
  fill: color-mix(in srgb, var(--learner-ink) 55%, #c9c4b8);
}

.vibe64-learner-art__ray,
.vibe64-learner-art__bit--learning {
  fill: var(--v64-learning-strong);
}

.vibe64-learner-art__bit--primary {
  fill: var(--v64-primary);
  opacity: 0.65;
}

.vibe64-learner-art__bit--outline,
.vibe64-learner-art__bit--ring {
  fill: none;
  stroke: var(--v64-primary);
  stroke-linejoin: round;
  stroke-opacity: 0.55;
  stroke-width: 3;
}

/* Gentle life: the idea floats, the hand waves, the confetti twinkles. */
.vibe64-learner-art__idea {
  animation: vibe64-learner-float 3.2s ease-in-out infinite;
}

.vibe64-learner-art__wave {
  animation: vibe64-learner-wave 2.4s ease-in-out infinite;
  transform-box: view-box;
  transform-origin: 182px 165px;
}

.vibe64-learner-art__bit {
  animation: vibe64-learner-twinkle 2.8s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}

.vibe64-learner-art__bit:nth-of-type(2n) {
  animation-delay: 0.9s;
}

.vibe64-learner-art__bit:nth-of-type(3n) {
  animation-delay: 1.7s;
}

@keyframes vibe64-learner-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-5px); }
}

@keyframes vibe64-learner-wave {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-7deg); }
}

@keyframes vibe64-learner-twinkle {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.75); }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-learner-art__idea,
  .vibe64-learner-art__wave,
  .vibe64-learner-art__bit {
    animation: none;
  }
}
</style>
