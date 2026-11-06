<template>
  <article class="storyboard-page" :class="{ 'storyboard-page--compact': compact, 'storyboard-page--root': !data.parentId, 'storyboard-page--selected': selected, 'architecture-context': context }" :title="[data.title, ...data.identities, data.file].filter(Boolean).join('\n')">
    <Handle v-if="data.parentId" id="parent" type="target" :position="Position.Top" />
    <div class="storyboard-page__meta"><span>{{ data.kind }}</span><span>{{ data.surface }}</span><button v-if="data.file" type="button" class="storyboard-page__usage nodrag nopan" :aria-label="`Show usage of ${data.title}`" @click.stop="emit('show-usage', { q: data.file })">Show usage</button></div>
    <h2>{{ data.title }}</h2>
    <div v-if="data.identities.length" class="storyboard-page__routes"><span v-for="identity in data.identities" :key="identity">{{ identity }}</span></div>
    <p v-else class="storyboard-page__unregistered">No navigation identity recorded</p>
    <span v-if="data.unresolvedCalls" class="storyboard-page__unresolved">{{ data.unresolvedCalls }} unresolved calls</span>
    <Handle v-if="data.callCount" id="engine-out" type="source" :position="Position.Right" />
    <Handle v-if="data.childCount" id="children" type="source" :position="Position.Bottom" />
  </article>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core';

// One page, screen or scene card on the architecture map; `context` dims it while a subsystem is open.
defineProps({ data: { type: Object, required: true }, selected: Boolean, compact: Boolean, context: Boolean });
const emit = defineEmits(['show-usage']);
</script>

<style scoped>
.storyboard-page, .storyboard-page *, .storyboard-page *::before, .storyboard-page *::after { box-sizing: border-box; }
.storyboard-page__usage { margin-left: auto; color: rgb(var(--v-theme-subsystem)); cursor: pointer; text-transform: none; letter-spacing: normal; font-size: 11px; border-radius: 4px; padding: 0 4px; }
.storyboard-page__usage:hover { background: rgba(var(--v-theme-subsystem), 0.08); }
.storyboard-page__usage:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); }
.storyboard-page { width: 100%; height: 100%; padding: 18px 20px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 12px; background: rgb(var(--v-theme-surface-container-lowest)); color: rgb(var(--v-theme-on-surface)); box-shadow: 0 3px 12px rgba(var(--v-theme-shadow), 0.04); }
.storyboard-page--root { border-top: 4px solid rgb(var(--v-theme-primary)); padding-top: 15px; }
.storyboard-page--selected { border-color: rgb(var(--v-theme-primary)); box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.13); }
.storyboard-page__meta { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; letter-spacing: .04em; color: rgb(var(--v-theme-on-surface-variant)); text-transform: uppercase; }
.storyboard-page h2 { margin: 10px 0 6px; font-size: 19px; font-weight: 650; line-height: 26px; overflow-wrap: anywhere; }
.storyboard-page__routes { display: flex; flex-direction: column; font-family: ui-monospace, monospace; font-size: 12px; line-height: 20px; color: rgb(var(--v-theme-on-surface-variant)); overflow-wrap: anywhere; }
.storyboard-page__unregistered { margin: 0; font-size: 11px; color: rgb(var(--v-theme-on-surface-variant)); }
.storyboard-page :deep(.vue-flow__handle) { width: 6px; height: 6px; border: 0; background: rgb(var(--v-theme-outline)); pointer-events: none; }
.storyboard-page__unresolved { font-size: 10px; color: rgb(var(--v-theme-warning)); }
.storyboard-page--compact { display: flex; flex-direction: column; justify-content: center; padding: 12px; }
.storyboard-page--compact h2 { font-size: 19px; line-height: 26px; margin: 0 0 6px; overflow-wrap: anywhere; }
.storyboard-page--compact .storyboard-page__meta, .storyboard-page--compact .storyboard-page__unregistered { display: none; }
.storyboard-page--compact .storyboard-page__routes { font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
</style>
