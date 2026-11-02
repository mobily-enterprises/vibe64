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
.storyboard-page__usage { margin-left: auto; color: #367e70; cursor: pointer; text-transform: none; letter-spacing: normal; font-size: 11px; border-radius: 4px; padding: 0 4px; }
.storyboard-page__usage:hover { background: #dcece6; }
.storyboard-page__usage:focus-visible { outline: 2px solid #377dcb; }
.storyboard-page { width: 100%; height: 100%; padding: 18px 20px; border: 1px solid #ccd6e2; border-radius: 12px; background: #fff; color: #213549; box-shadow: 0 3px 12px #30465d0b; }
.storyboard-page--root { border-top: 4px solid #4582c1; padding-top: 15px; }
.storyboard-page--selected { border-color: #377dcb; box-shadow: 0 0 0 3px #377dcb22; }
.storyboard-page__meta { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; letter-spacing: .04em; color: #6e8195; text-transform: uppercase; }
.storyboard-page h2 { margin: 10px 0 6px; font-size: 19px; font-weight: 650; line-height: 26px; overflow-wrap: anywhere; }
.storyboard-page__routes { display: flex; flex-direction: column; font-family: ui-monospace, monospace; font-size: 12px; line-height: 20px; color: #4b6985; overflow-wrap: anywhere; }
.storyboard-page__unregistered { margin: 0; font-size: 11px; color: #7a8b9b; }
.storyboard-page :deep(.vue-flow__handle) { width: 6px; height: 6px; border: 0; background: #93a7ba; pointer-events: none; }
.storyboard-page__unresolved { font-size: 10px; color: #94602f; }
.storyboard-page--compact { display: flex; flex-direction: column; justify-content: center; padding: 12px; }
.storyboard-page--compact h2 { font-size: 19px; line-height: 26px; margin: 0 0 6px; overflow-wrap: anywhere; }
.storyboard-page--compact .storyboard-page__meta, .storyboard-page--compact .storyboard-page__unregistered { display: none; }
.storyboard-page--compact .storyboard-page__routes { font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
</style>
