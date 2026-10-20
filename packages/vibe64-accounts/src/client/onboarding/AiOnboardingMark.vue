<script setup>
import { mdiCrown } from "@mdi/js";

// A provider's tile: its glyph in the provider tone; Claude's is gold and crowned.
defineProps({
  provider: { type: Object, required: true },
  size: { type: Number, default: 48 },
  // Plays the crown's settle once, after this delay in milliseconds.
  settleDelay: { type: Number, default: -1 }
});
</script>

<template>
  <span
    class="aio-mark" :class="[`aio-mark--${provider.tone}`, { 'aio-mark--crown': provider.crown }]"
    :style="{ '--aio-mark-size': `${size}px`, '--aio-settle-delay': `${Math.max(settleDelay, 0)}ms` }" aria-hidden="true"
  >
    {{ provider.mark }}
    <span v-if="provider.crown" class="aio-mark__crown" :class="{ 'aio-mark__crown--settle': settleDelay >= 0 }">
      <svg viewBox="0 0 24 24"><path :d="mdiCrown" /></svg>
    </span>
  </span>
</template>

<style scoped>
.aio-mark {
  align-items: center;
  background: var(--aio-tone-bg);
  border-radius: calc(var(--aio-mark-size) * 0.27);
  color: var(--aio-tone-fg);
  display: inline-flex;
  flex: none;
  font: 600 calc(var(--aio-mark-size) * 0.46) / 1 var(--v64-font-family);
  height: var(--aio-mark-size);
  justify-content: center;
  letter-spacing: -0.02em;
  position: relative;
  width: var(--aio-mark-size);
}
.aio-mark--primary {
  --aio-tone-bg: linear-gradient(135deg, #f9d65c, #e0a800);
  --aio-tone-fg: #2b2100;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 45%), 0 6px 16px -8px rgb(160 110 0 / 70%);
}
.aio-mark--secondary { --aio-tone-bg: var(--v64-secondary-container); --aio-tone-fg: var(--v64-on-secondary-container); }
.aio-mark--tertiary { --aio-tone-bg: color-mix(in srgb, #7d5260 16%, var(--v64-surface)); --aio-tone-fg: #633b48; }
.v-theme--dark .aio-mark--tertiary { --aio-tone-bg: color-mix(in srgb, #efb8c8 18%, var(--v64-surface)); --aio-tone-fg: #efb8c8; }
.aio-mark--neutral { --aio-tone-bg: var(--v64-surface-container-highest); --aio-tone-fg: var(--v64-on-surface); }
/* The crown is a badge on the tile: centred, upright, ringed by the surface. */
.aio-mark__crown {
  align-items: center;
  background: #f5c518;
  border-radius: var(--v64-shape-full);
  box-shadow: 0 0 0 2px var(--v64-surface);
  display: inline-flex;
  height: 22px;
  justify-content: center;
  left: calc(50% - 11px);
  position: absolute;
  top: -12px;
  width: 22px;
}
.aio-mark__crown svg { fill: #2b2100; height: 14px; width: 14px; }
.aio-mark__crown--settle {
  animation: aio-crown-settle var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) var(--aio-settle-delay) both;
}
@keyframes aio-crown-settle {
  from { opacity: 0; transform: translateY(-8px) scale(0.6); }
  60% { opacity: 1; transform: translateY(1px) scale(1.08); }
}
@media (prefers-reduced-motion: reduce) {
  .aio-mark__crown--settle { animation: none; }
}
</style>
