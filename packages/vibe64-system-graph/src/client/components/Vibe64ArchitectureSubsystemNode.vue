<template>
  <article
    class="engine-subsystem" :class="{ 'engine-subsystem--compact': compact, 'engine-subsystem--library': data.library, 'engine-subsystem--support': data.placementKind === 'support', 'engine-subsystem--entry': data.entryFiles.length, 'engine-subsystem--cycle': data.cycleLabel, 'engine-subsystem--selected': selected, 'engine-subsystem--expanded': data.expanded, 'architecture-context': context }"
    :title="`${data.root}\n${data.description || 'Description not recorded.'}${data.sourceLines != null ? '\n' + data.sourceLines.toLocaleString() + ' measured source lines' : ''}${data.cycleLabel ? '\n' + data.cycleLabel : ''}${data.entryFiles.length ? '\nEntry files: ' + data.entryFiles.join(', ') : ''}`"
  >
    <template v-for="port in ports" :key="port.id"><Handle :id="port.id" :type="port.type" :position="port.position" /></template>
    <Handle
      v-for="(receiver, index) in data.receivers || []" :key="receiver.id" :id="`controller:${receiver.id}`" type="target" :position="Position.Left"
      :style="{ top: `${(index + 1) * 100 / (data.receivers.length + 1)}%` }"
    />
    <span v-if="data.arrangeable" class="engine-subsystem__grip" role="button" tabindex="0" aria-label="Rearrange subsystem" title="Drag to arrange. Arrow keys move sideways." @keydown.left.stop.prevent="emit('move', -1)" @keydown.right.stop.prevent="emit('move', 1)" @dblclick.stop>⠿</span>
    <div class="engine-subsystem__content">
      <div v-if="data.entryFiles.length" class="engine-subsystem__start">Start here</div>
      <div class="engine-subsystem__meta"><span>{{ data.library ? 'Shared library' : data.opaque ? 'Opaque package' : data.entryFiles.length ? 'Entry point' : data.provenance === 'fallback' ? 'Directory group' : 'Subsystem' }}</span><span v-if="data.version">{{ data.version }}</span></div>
      <h2>{{ data.title }}</h2>
      <div v-if="data.root" class="engine-subsystem__directory">{{ data.root }}</div>
      <p class="engine-subsystem__description">{{ data.description || (data.opaque ? 'Public package boundary. Internals stay opaque.' : 'Description not recorded.') }}</p>
      <div class="engine-subsystem__api" :title="data.publicSummary">{{ data.publicSummary }}</div>
      <div class="engine-subsystem__size" :title="data.opaque ? 'Package internals are not measured.' : `${data.measuredFiles} of ${data.fileIds.length} files measured; physical source lines include comments and blanks. Card area has a readability floor.`">
        {{ data.opaque ? 'Unmeasured package' : data.sourceLines == null ? 'Size unavailable' : `${data.sizePartial ? '~' : ''}${data.sourceLines.toLocaleString()} source lines` }}<span v-if="!data.opaque"> · {{ data.fileIds.length }} files</span>
      </div>
      <div v-if="data.receivers?.length" class="engine-subsystem__receivers"><span v-for="receiver in data.receivers.slice(0, 2)" :key="receiver.id" :title="receiver.path">↳ {{ receiver.path.split('/').pop() }}</span><span v-if="data.receivers.length > 2" :title="data.receivers.map(receiver => receiver.path).join('\n')">+ {{ data.receivers.length - 2 }} receiving files</span></div>
    </div>
    <div v-if="data.cycleLabel" class="engine-subsystem__warning" role="img" :aria-label="data.cycleLabel" :title="data.cycleLabel">{{ data.cycleLabel }}</div>
  </article>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core';

// One subsystem circle on the architecture map; `context` dims it while another subsystem is open.
defineProps({ data: { type: Object, required: true }, selected: Boolean, compact: Boolean, context: Boolean });
const emit = defineEmits(['move']);
const ports = [
  ['top-in', 'target', Position.Top], ['bottom-out', 'source', Position.Bottom],
  ['top-out', 'source', Position.Top], ['bottom-in', 'target', Position.Bottom],
  ['left-in', 'target', Position.Left], ['left-out', 'source', Position.Left],
  ['right-in', 'target', Position.Right], ['right-out', 'source', Position.Right]
].map(([id, type, position]) => ({ id, type, position }));
</script>

<style scoped>
.engine-subsystem, .engine-subsystem *, .engine-subsystem *::before, .engine-subsystem *::after { box-sizing: border-box; }
.engine-subsystem { position: relative; display: flex; align-items: center; justify-content: center; text-align: center; width: 100%; height: 100%; background: #fff; color: #213c40; border: 1px solid #bfcfce; border-radius: 50%; box-shadow: 0 3px 12px #30465d0b; }
.engine-subsystem__content { width: 72%; min-width: 0; }
.engine-subsystem--entry { border-color: #4b9386; border-width: 2px; }
.engine-subsystem__start { color: #34796e; font-size: 12px; font-weight: 650; margin-bottom: 6px; }
.engine-subsystem--support { background: #f0f2f5; border-style: dashed; color: #64717e; box-shadow: none; }
.engine-subsystem--support .engine-subsystem__directory { color: #64717e; }
.engine-subsystem--cycle { border-color: #c69a6f; background: #fffdf9; }
.engine-subsystem--overview { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 12px 16px; border-radius: 7px; box-shadow: none; }
.engine-subsystem--overview h2 { margin: 0; font-size: 17px; line-height: 20px; }
.engine-subsystem--overview .engine-subsystem__meta,
.engine-subsystem--overview .engine-subsystem__directory,
.engine-subsystem--overview .engine-subsystem__description,
.engine-subsystem--overview .engine-subsystem__size,
.engine-subsystem--overview .engine-subsystem__receivers { display: none; }
.engine-subsystem--overview .engine-subsystem__warning { position: absolute; top: 6px; right: 22px; margin: 0; width: 6px; height: 6px; border-radius: 50%; background: #ba8459; font-size: 0; }
.engine-subsystem__volume { position: absolute; bottom: 0; left: 0; height: 3px; max-width: 100%; background: #6f9b91; border-radius: 0 0 3px 3px; }
.engine-subsystem--overview .engine-subsystem__grip { font-size: 14px; top: 2px; right: 2px; padding: 0 3px; }
.engine-subsystem--selected { box-shadow: 0 0 0 3px #4b938633; border-color: #4b9386; }
.engine-subsystem__meta { display: flex; justify-content: center; gap: 8px; color: #6b8987; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
.engine-subsystem h2 { margin: 8px 0 5px; font-size: 18px; line-height: 24px; font-weight: 650; overflow-wrap: anywhere; }
.engine-subsystem__directory { font-family: ui-monospace, monospace; font-size: 11px; line-height: 17px; color: #4d7772; overflow-wrap: anywhere; }
.engine-subsystem__description { margin: 10px 0 8px; font-size: 12px; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.engine-subsystem__size { font-size: 11px; line-height: 17px; color: #708583; }
.engine-subsystem__receivers { display: flex; flex-direction: column; margin-top: 5px; font-family: ui-monospace, monospace; font-size: 10px; color: #7954b3; }
.engine-subsystem__warning { margin-top: 6px; color: #94602f; font-size: 10px; }
.engine-subsystem :deep(.vue-flow__handle) { width: 5px; height: 5px; background: #7895a4; border: 0; pointer-events: none; opacity: 0; }
.engine-subsystem__grip { position: absolute; top: 14%; right: 14%; padding: 2px 5px; font-size: 18px; line-height: 22px; color: #87a09b; cursor: grab; border-radius: 4px; touch-action: none; }
.engine-subsystem__grip:hover { color: #336d60; background: #e9f3ee; }
.engine-subsystem__grip:active { cursor: grabbing; }
.engine-subsystem__grip:focus-visible { outline: 2px solid #377dcb; }
.engine-subsystem--compact h2 { font-size: calc(14px * var(--diagram-label-scale)); line-height: 1.15; margin: 0 0 8px; }
.engine-subsystem--compact .engine-subsystem__directory { font-size: calc(8px * var(--diagram-label-scale)); line-height: 1.25; }
.engine-subsystem--compact .engine-subsystem__start { font-size: calc(9px * var(--diagram-label-scale)); }
.engine-subsystem--compact .engine-subsystem__meta,
.engine-subsystem--compact .engine-subsystem__description, .engine-subsystem--compact .engine-subsystem__receivers,
.engine-subsystem--compact .engine-subsystem__warning { display: none; }
.engine-subsystem--compact .engine-subsystem__size { font-size: calc(9px * var(--diagram-label-scale)); line-height: 1.3; }
.engine-subsystem--compact .engine-subsystem__grip { font-size: calc(12px * var(--diagram-label-scale)); }
.engine-subsystem--overview.engine-subsystem--compact h2 { font-size: 17px; line-height: 20px; max-height: none; overflow: visible; margin: 0; }
.engine-subsystem--overview.engine-subsystem--compact { padding: 12px 16px; }
.engine-subsystem--overview.engine-subsystem--compact .engine-subsystem__grip { font-size: 14px; }
.engine-subsystem--declared .engine-subsystem__directory { display: block; margin-top: 5px; }
.engine-subsystem__api { margin-top: 7px; color: #557c75; font-size: 11px; line-height: 17px; }
.engine-subsystem--library { border-color: #7b70aa; background: #fdfcff; }
.engine-subsystem--library .engine-subsystem__description { display: -webkit-box; margin: 7px 0 0; -webkit-line-clamp: 2; }
.engine-subsystem h2, .engine-subsystem__directory, .engine-subsystem__description, .engine-subsystem__api { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.engine-subsystem__api { -webkit-line-clamp: 1; }
.engine-subsystem--compact .engine-subsystem__size, .engine-subsystem--compact .engine-subsystem__api { display: none; }
</style>
