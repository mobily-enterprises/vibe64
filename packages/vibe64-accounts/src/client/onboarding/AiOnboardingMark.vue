<script setup>
import { mdiCrown } from "@mdi/js";

// A provider's monogram tile, one shape per provider; Claude's is gold, with a
// tilted crown above it that scales with the tile and glints once.
defineProps({
  provider: { type: Object, required: true },
  size: { type: Number, default: 48 },
  // Plays the crown's settle and glint once, after this delay in milliseconds.
  settleDelay: { type: Number, default: -1 }
});
const CROWN_MASK = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${mdiCrown}"/></svg>`)}")`;
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
  --aio-tone-bg: radial-gradient(120% 120% at 25% 15%, #ffe48a, #f2bd1d 55%, #d79c00);
  --aio-tone-fg: #2b2100;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 55%), inset 0 -2px 0 rgb(120 80 0 / 18%),
    0 calc(var(--aio-s) * 0.12) calc(var(--aio-s) * 0.3) calc(var(--aio-s) * -0.14) rgb(160 110 0 / 70%);
}
.aio-mark--secondary { --aio-tone-bg: var(--v64-secondary-container); --aio-tone-fg: var(--v64-on-secondary-container); }
.aio-mark--tertiary { --aio-tone-bg: color-mix(in srgb, #7d5260 18%, var(--v64-surface)); --aio-tone-fg: #633b48; }
.v-theme--dark .aio-mark--tertiary { --aio-tone-bg: color-mix(in srgb, #efb8c8 20%, var(--v64-surface)); --aio-tone-fg: #efb8c8; }
.aio-mark--neutral { --aio-tone-bg: var(--v64-surface-container-highest); --aio-tone-fg: var(--v64-on-surface); }

/* The crown sits above the tile's corner, tilted, sized with the tile. */
.aio-mark__crown {
  filter: drop-shadow(0 1px 1px rgb(120 80 0 / 45%));
  height: calc(var(--aio-s) * 0.42);
  left: calc(var(--aio-s) * -0.1);
  position: absolute;
  top: calc(var(--aio-s) * -0.28);
  transform: rotate(-12deg);
  width: calc(var(--aio-s) * 0.42);
}
.aio-mark__crown i {
  background: linear-gradient(105deg, #d89a00 0 38%, #fff3b8 48%, #f5c518 56%, #d89a00 70% 100%) 100% 0 / 320% 100%;
  display: block;
  height: 100%;
  -webkit-mask: var(--aio-crown-mask) center / contain no-repeat;
  mask: var(--aio-crown-mask) center / contain no-repeat;
  width: 100%;
}
.aio-mark__crown--settle { animation: aio-crown-settle var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) var(--aio-settle-delay) both; }
.aio-mark__crown--settle i { animation: aio-crown-glint 1100ms var(--v64-ease-standard) calc(var(--aio-settle-delay) + 350ms) both; }
@keyframes aio-crown-settle {
  from { opacity: 0; transform: translateY(-40%) rotate(-24deg) scale(0.6); }
  60% { opacity: 1; transform: translateY(4%) rotate(-10deg) scale(1.06); }
}
@keyframes aio-crown-glint { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .aio-mark__crown--settle, .aio-mark__crown--settle i { animation: none; }
}
</style>
