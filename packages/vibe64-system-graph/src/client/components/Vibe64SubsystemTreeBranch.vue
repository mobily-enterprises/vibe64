<template>
  <ul class="subsystem-tree" :class="{ 'subsystem-tree--branch': depth > 0 }">
    <li v-for="item in items" :key="item.path || item.id" :class="{ 'subsystem-tree__directory': item.kind === 'directory' }">
      <details v-if="item.kind === 'directory'" :open="searching || (folderState.get(item.path) ?? depth < 1)" @toggle="!searching && folderState.set(item.path, $event.target.open)">
        <summary><svg class="subsystem-tree__folder" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiFolderOutline" /></svg><span>{{ item.name }}</span><small>{{ item.count }} file{{ item.count === 1 ? '' : 's' }}</small></summary>
        <Vibe64SubsystemTreeBranch :items="item.children" :folder-state="folderState" :depth="depth + 1" :searching="searching" :selected-id="selectedId" @select="$emit('select', $event)" @inspect="$emit('inspect', $event)" />
      </details>
      <button v-else type="button" class="subsystem-tree__file nodrag nopan" data-zoom-kind="file" :data-file-path="item.file.path" :class="{ 'subsystem-tree__file--selected': selectedId === item.id, 'subsystem-tree__file--main': item.programs?.some(program => program.mainSource === item.file.path) }"
        :aria-pressed="selectedId === item.id" :style="{ '--file-volume': item.volume ?? 0 }" :title="`${item.file.path}\n${item.reasons.join(' · ')}\nClick to open this file's interface.`"
        @click="$emit('select', item.file); $emit('inspect', item.file)" @keydown.enter.stop.prevent="$emit('select', item.file); $emit('inspect', item.file)">
        <span class="subsystem-tree__type" aria-hidden="true"><svg class="subsystem-tree__document" viewBox="0 0 24 24" :style="{ color: icon(item.name).color }"><path :d="icon(item.name).path" /></svg><small>{{ item.name.includes('.') ? item.name.split('.').at(-1) : 'file' }}</small></span><span class="subsystem-tree__name">{{ item.name }}</span>
        <span v-for="program in item.programs?.filter(program => program.mainSource === item.file.path)" :key="program.id" class="subsystem-tree__program subsystem-tree__program--main" :title="program.title"><svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiStarOutline" /></svg> Main · {{ program.title }}</span>
        <span v-if="item.programs?.some(program => program.mainSource !== item.file.path)" class="subsystem-tree__program" :title="item.programs.filter(program => program.mainSource !== item.file.path).map(program => program.title).join('\n')">Part of · {{ item.programs.filter(program => program.mainSource !== item.file.path).length === 1 ? item.programs.find(program => program.mainSource !== item.file.path).title : `${item.programs.filter(program => program.mainSource !== item.file.path).length} Programs` }}</span>
        <span v-if="item.reasons.length" class="subsystem-tree__entry" :title="item.reasons.join(' · ')">Entry</span>
        <span class="subsystem-tree__volume" :title="item.volume == null ? 'Size unavailable' : `${item.file.sourceLines.toLocaleString()} source lines; bar relative to other files in this subsystem.`">
          <span v-if="item.volume != null" class="subsystem-tree__bar"><i :style="{ width: `${item.volume * 100}%` }" /></span>
          <small>{{ item.volume == null ? '—' : item.file.sourceLines.toLocaleString() }}</small>
        </span>
      </button>
    </li>
  </ul>
</template>
<script setup>
import { mdiCodeJson, mdiConsoleLine, mdiFileCodeOutline, mdiFileCogOutline, mdiFileDocumentOutline, mdiFileImageOutline, mdiFileTableOutline, mdiFolderOutline, mdiStarOutline,
  mdiLanguageCpp, mdiLanguageCsharp, mdiLanguageCss3, mdiLanguageGo, mdiLanguageHtml5, mdiLanguageJava, mdiLanguageJavascript, mdiLanguageKotlin, mdiLanguagePhp, mdiLanguagePython, mdiLanguageRuby, mdiLanguageRust, mdiLanguageTypescript, mdiVuejs } from '@mdi/js';
defineProps({ items: { type: Array, required: true }, depth: { type: Number, default: 0 }, selectedId: { type: String, default: '' }, searching: Boolean, folderState: { type: Map, default: () => new Map() } });
defineEmits(['select', 'inspect']);
// File-name decoration only. Analysers, not these icons, identify code semantics.
const icons = [
  [['js', 'mjs', 'cjs', 'jsx'], mdiLanguageJavascript, '#aa8215'], [['ts', 'tsx', 'mts', 'cts'], mdiLanguageTypescript, '#397fc3'],
  [['vue'], mdiVuejs, '#38866c'], [['py', 'pyi'], mdiLanguagePython, '#3e79a1'], [['rs'], mdiLanguageRust, '#936344'],
  [['go'], mdiLanguageGo, '#298998'], [['java'], mdiLanguageJava, '#bc674d'], [['kt', 'kts'], mdiLanguageKotlin, '#8163b0'],
  [['cs'], mdiLanguageCsharp, '#7760ac'], [['c', 'h', 'cc', 'cpp', 'hpp'], mdiLanguageCpp, '#4b7aaa'], [['rb'], mdiLanguageRuby, '#b75757'],
  [['php'], mdiLanguagePhp, '#7a72a6'], [['css', 'scss', 'sass', 'less'], mdiLanguageCss3, '#4f86bc'], [['html', 'htm'], mdiLanguageHtml5, '#bd7050'],
  [['json', 'jsonc'], mdiCodeJson, '#938140'], [['yaml', 'yml', 'toml', 'ini', 'conf'], mdiFileCogOutline, '#7b8190'],
  [['sh', 'bash', 'zsh', 'ps1'], mdiConsoleLine, '#698171'], [['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'], mdiFileImageOutline, '#9a74a3'],
  [['csv', 'tsv', 'sql'], mdiFileTableOutline, '#408b89'], [['md', 'txt', 'rst'], mdiFileDocumentOutline, '#6d8592']
];
function icon(name) {
  const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
  const match = icons.find(([extensions]) => extensions.includes(extension));
  return match ? { path: match[1], color: match[2] } : { path: mdiFileCodeOutline, color: '#698b80' };
}
</script>
<style scoped>
.subsystem-tree { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; font-size: 13px; color: #304b50; }
.subsystem-tree__directory { grid-column: 1 / -1; }
.subsystem-tree--branch { margin-left: 12px; padding-left: 9px; border-left: 1px solid #d4e0df; }
.subsystem-tree summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; border-radius: 5px; padding: 3px 7px; font-weight: 600; }
.subsystem-tree summary::before { content: '›'; color: #6d8584; width: 9px; font-size: 17px; }
.subsystem-tree details[open] > summary::before { transform: rotate(90deg); }
.subsystem-tree summary:hover { background: #eef4f3; }
.subsystem-tree summary small { margin-left: auto; font-weight: 400; color: #718582; white-space: nowrap; }
.subsystem-tree__folder { fill: currentColor; color: #b68b49; width: 20px; height: 20px; }
.subsystem-tree__file { border: 1px solid #d8e3df; cursor: pointer; font: inherit; display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left; width: 100%; min-height: calc(92px + 48px * var(--file-volume)); padding: 10px 12px; border-radius: 7px; background: #f8fbfa; color: inherit; }
.subsystem-tree__file:hover { background: #eef4f3; }
.subsystem-tree__file--selected { background: #e4f0ed; box-shadow: inset 3px 0 #38897a; }
.subsystem-tree__file--main { border-color: #bd974d; background: #fcfaf5; box-shadow: inset 3px 0 #aa812c; }
.subsystem-tree__file--main:hover { background: #f7f0e1; }
.subsystem-tree__file--main.subsystem-tree__file--selected { outline: 2px solid #38897a; outline-offset: -2px; }
.subsystem-tree__file:focus-visible, .subsystem-tree summary:focus-visible { outline: 2px solid #377dcb; outline-offset: 1px; }
.subsystem-tree__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.subsystem-tree__type { display: flex; align-items: center; gap: 6px; color: #758a83; }
.subsystem-tree__type small { font-size: 10px; text-transform: uppercase; }
.subsystem-tree__document { display: block; width: 28px; height: 28px; fill: currentColor; }
.subsystem-tree__entry { align-self: flex-start; font-size: 10px; padding: 1px 5px; color: #307b6c; background: #dceee8; border-radius: 4px; }
.subsystem-tree__volume { display: flex; align-items: center; gap: 7px; color: #788b87; }
.subsystem-tree__volume small { margin-left: auto; text-align: right; font-variant-numeric: tabular-nums; }
.subsystem-tree__bar { display: block; flex: 1; height: 3px; background: #e3ebe9; border-radius: 2px; }
.subsystem-tree__bar i { display: block; height: 100%; min-width: 1px; background: #89b7ab; border-radius: 2px; }
@media (max-width: 600px) { .subsystem-tree__bar { display: none; } .subsystem-tree--branch { margin-left: 7px; padding-left: 4px; } }
.subsystem-tree__program { font-size: 11px; line-height: 16px; color: #65827a; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.subsystem-tree__program--main { color: #755616; font-weight: 600; }
.subsystem-tree__program svg { width: 14px; height: 14px; fill: currentColor; vertical-align: text-bottom; }
</style>
