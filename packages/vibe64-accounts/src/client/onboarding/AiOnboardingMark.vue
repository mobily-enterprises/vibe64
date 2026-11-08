<script setup>
import { crownedMark } from "../../theme/palettes.js";

// A provider's monogram tile, one shape per provider; Claude's is gold, wearing
// a wide, low crown that scales with the tile and glints once.
defineProps({
  provider: { type: Object, required: true },
  size: { type: Number, default: 48 },
  // Plays the crown's settle and glint once, after this delay in milliseconds.
  settleDelay: { type: Number, default: -1 }
});
// Five points on a band, with a jewel on the outer and centre points.
const CROWN = "M10 22 4 9 26 16 48 4 70 16 92 9 86 22ZM10 23.5h76V27H10Z" +
  "M1 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0M44.7 3.5a3.3 3.3 0 1 0 6.6 0a3.3 3.3 0 1 0-6.6 0M89 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0";
const CROWN_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 28"><path d="${CROWN}"/></svg>`)}")`;
</script>

<template>
  <span
    class="aio-mark" :class="[`aio-mark--${provider.tone}`, `aio-mark--${provider.shape}`]"
    :style="{ '--aio-mark-size': `${size}px`, '--aio-settle-delay': `${Math.max(settleDelay, 0)}ms`, '--aio-crown-mask': CROWN_MASK }"
    aria-hidden="true"
  >
    <span class="aio-mark__tile"><span class="aio-mark__glyph">{{ provider.mark }}</span></span>
    <span v-if="provider.crown" class="aio-mark__crown" :class="{ 'aio-mark__crown--settle': settleDelay >= 0 }"><i /></span>
  </span>
</template>

<style scoped>
.aio-mark {
  --aio-s: var(--aio-mark-size);
  display: inline-flex;
  flex: none;
  height: var(--aio-s);
  position: relative;
  width: var(--aio-s);
}
.aio-mark__tile {
  align-items: center;
  background: var(--aio-tone-bg);
  color: var(--aio-tone-fg);
  display: flex;
  font: 650 calc(var(--aio-s) * 0.46) / 1 var(--v64-font-family);
  height: 100%;
  justify-content: center;
  letter-spacing: -0.03em;
  width: 100%;
}
/* One silhouette per provider, so the tiles never read as the same placeholder. */
.aio-mark--squircle .aio-mark__tile { border-radius: 30%; }
.aio-mark--circle .aio-mark__tile { border-radius: 50%; }
.aio-mark--hexagon .aio-mark__tile { clip-path: polygon(25% 4%, 75% 4%, 100% 50%, 75% 96%, 25% 96%, 0 50%); }
.aio-mark--diamond .aio-mark__tile { border-radius: 22%; transform: rotate(45deg) scale(0.78); }
.aio-mark--diamond .aio-mark__glyph { transform: rotate(-45deg) scale(1.28); }
.aio-mark--primary .aio-mark__tile {
  --aio-tone-bg: radial-gradient(120% 120% at 25% 15%, color-mix(in srgb, var(--v64-learning), rgb(var(--v-theme-surface-container-lowest)) 45%), var(--v64-learning) 55%, color-mix(in srgb, var(--v64-learning), var(--v64-learning-strong) 35%));
  --aio-tone-fg: var(--v64-on-learning);
  box-shadow: inset 0 1px 0 v-bind("crownedMark.tileHighlight"), inset 0 -2px 0 v-bind("crownedMark.tileInnerShade"),
    0 calc(var(--aio-s) * 0.12) calc(var(--aio-s) * 0.3) calc(var(--aio-s) * -0.14) v-bind("crownedMark.tileShadow");
}
.aio-mark--secondary { --aio-tone-bg: rgb(var(--v-theme-secondary-container)); --aio-tone-fg: rgb(var(--v-theme-on-secondary-container)); }
.aio-mark--tertiary { --aio-tone-bg: rgb(var(--v-theme-tertiary-container)); --aio-tone-fg: rgb(var(--v-theme-on-tertiary-container)); }
.aio-mark--neutral { --aio-tone-bg: rgb(var(--v-theme-surface-container-highest)); --aio-tone-fg: rgb(var(--v-theme-on-surface)); }

/* The crown sits on the tile's top edge: much wider than the tile, under half as tall. */
.aio-mark__crown {
  filter: drop-shadow(0 1px 1px v-bind("crownedMark.crownShadow"));
  height: calc(var(--aio-s) * 0.51);
  left: calc(var(--aio-s) * -0.375);
  position: absolute;
  top: calc(var(--aio-s) * -0.44);
  width: calc(var(--aio-s) * 1.75);
}
.aio-mark__crown i {
  background:
    linear-gradient(105deg, transparent 38%, v-bind("crownedMark.crownGlint") 48%, transparent 58%) 100% 0 / 320% 100%,
    linear-gradient(180deg, color-mix(in srgb, var(--v64-learning), rgb(var(--v-theme-surface-container-lowest)) 45%), var(--v64-learning) 50%, color-mix(in srgb, var(--v64-learning), var(--v64-learning-strong) 35%));
  display: block;
  height: 100%;
  -webkit-mask: var(--aio-crown-mask) center / contain no-repeat;
  mask: var(--aio-crown-mask) center / contain no-repeat;
  width: 100%;
}
.aio-mark__crown--settle { animation: aio-crown-settle var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) var(--aio-settle-delay) both; }
.aio-mark__crown--settle i { animation: aio-crown-glint 1100ms var(--v64-ease-standard) calc(var(--aio-settle-delay) + 350ms) both; }
@keyframes aio-crown-settle {
  from { opacity: 0; transform: translateY(-60%) scale(0.7); }
  60% { opacity: 1; transform: translateY(6%) scale(1.04); }
}
@keyframes aio-crown-glint { from { background-position: 100% 0, 0 0; } to { background-position: 0 0, 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .aio-mark__crown--settle, .aio-mark__crown--settle i { animation: none; }
}
</style>
