<template>
  <ul class="subsystem-tree" :class="{ 'subsystem-tree--branch': depth > 0 }">
    <li v-for="item in items" :key="item.path || item.id" :class="{ 'subsystem-tree__directory': item.kind === 'directory' }">
      <details v-if="item.kind === 'directory'" :open="searching || (folderState.get(item.path) ?? depth < 1)" @toggle="!searching && folderState.set(item.path, $event.target.open)">
        <summary><v-icon class="subsystem-tree__folder" icon="$folder" size="20" aria-hidden="true" /><span>{{ item.name }}</span><small>{{ item.count }} file{{ item.count === 1 ? '' : 's' }}</small></summary>
        <Vibe64SubsystemTreeBranch :items="item.children" :folder-state="folderState" :depth="depth + 1" :searching="searching" :selected-id="selectedId" @select="$emit('select', $event)" @inspect="$emit('inspect', $event)" />
      </details>
      <button
        v-else type="button" class="subsystem-tree__file nodrag nopan" data-zoom-kind="file" :data-file-path="item.file.path" :class="{ 'subsystem-tree__file--selected': selectedId === item.id, 'subsystem-tree__file--main': item.programs?.some(program => program.mainSource === item.file.path) }"
        :aria-pressed="selectedId === item.id" :style="{ '--file-volume': item.volume ?? 0 }" :title="`${item.file.path}\n${item.reasons.join(' · ')}\nClick to open this file's interface.`"
        @click="$emit('select', item.file); $emit('inspect', item.file)" @keydown.enter.stop.prevent="$emit('select', item.file); $emit('inspect', item.file)"
      >
        <span class="subsystem-tree__type" aria-hidden="true"><v-icon class="subsystem-tree__document" :icon="icon(item.name).icon" :style="{ color: icon(item.name).color }" /><small>{{ item.name.includes('.') ? item.name.split('.').at(-1) : 'file' }}</small></span><span class="subsystem-tree__name">{{ item.name }}</span>
        <span v-for="program in item.programs?.filter(program => program.mainSource === item.file.path)" :key="program.id" class="subsystem-tree__program subsystem-tree__program--main" :title="program.title"><v-icon icon="$star" aria-hidden="true" /> Main · {{ program.title }}</span>
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
import { fileTypeTints } from "../../theme/palettes.js";
defineProps({
  items: { type: Array, required: true },
  depth: { type: Number, default: 0 },
  selectedId: { type: String, default: '' },
  searching: Boolean,
  // Which folders are open, by path: one map for every branch of a tree, kept by the tree's owner.
  folderState: { type: /** @type {import('vue').PropType<Map<string, boolean>>} */ (Map), required: true }
});
defineEmits(['select', 'inspect']);
// File-name decoration only. Analysers, not these icons, identify code semantics.
const icons = [
  [['js', 'mjs', 'cjs', 'jsx'], "$languageJavascript", fileTypeTints.javascript], [['ts', 'tsx', 'mts', 'cts'], "$languageTypescript", fileTypeTints.typescript],
  [['vue'], "$vuejs", fileTypeTints.vue], [['py', 'pyi'], "$languagePython", fileTypeTints.python], [['rs'], "$languageRust", fileTypeTints.rust],
  [['go'], "$languageGo", fileTypeTints.go], [['java'], "$languageJava", fileTypeTints.java], [['kt', 'kts'], "$languageKotlin", fileTypeTints.kotlin],
  [['cs'], "$languageCsharp", fileTypeTints.csharp], [['c', 'h', 'cc', 'cpp', 'hpp'], "$languageCpp", fileTypeTints.cpp], [['rb'], "$languageRuby", fileTypeTints.ruby],
  [['php'], "$languagePhp", fileTypeTints.php], [['css', 'scss', 'sass', 'less'], "$languageCss3", fileTypeTints.css], [['html', 'htm'], "$languageHtml5", fileTypeTints.html],
  [['json', 'jsonc'], "$dataObject", fileTypeTints.json], [['yaml', 'yml', 'toml', 'ini', 'conf'], "$settingsApplications", fileTypeTints.config],
  [['sh', 'bash', 'zsh', 'ps1'], "$terminal", fileTypeTints.shell], [['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'ico'], "$image", fileTypeTints.image],
  [['csv', 'tsv', 'sql'], "$tableView", fileTypeTints.data], [['md', 'txt', 'rst'], "$description", fileTypeTints.text]
];
function icon(name) {
  const extension = name.includes('.') ? name.split('.').at(-1).toLowerCase() : '';
  const match = icons.find(([extensions]) => extensions.includes(extension));
  return match ? { icon: match[1], color: match[2] } : { icon: "$codeBlocks", color: fileTypeTints.code };
}
</script>
<style scoped>
.subsystem-tree { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr)); gap: 8px; list-style: none; padding: 0; margin: 0; font-size: 13px; color: rgb(var(--v-theme-on-surface)); }
.subsystem-tree__directory { grid-column: 1 / -1; }
.subsystem-tree--branch { margin-left: 12px; padding-left: 9px; border-left: 1px solid rgb(var(--v-theme-outline-variant)); }
.subsystem-tree summary { display: flex; align-items: center; gap: 8px; min-height: 44px; cursor: pointer; border-radius: 5px; padding: 3px 7px; font-weight: 600; }
.subsystem-tree summary::before { content: '›'; color: rgb(var(--v-theme-on-surface-variant)); width: 9px; font-size: 17px; }
.subsystem-tree details[open] > summary::before { transform: rotate(90deg); }
.subsystem-tree summary:hover { background: rgba(var(--v-theme-subsystem), 0.08); }
.subsystem-tree summary small { margin-left: auto; font-weight: 400; color: rgb(var(--v-theme-on-surface-variant)); white-space: nowrap; }
.subsystem-tree__folder { color: v-bind("fileTypeTints.folder"); }
.subsystem-tree__file { border: 1px solid rgb(var(--v-theme-outline-variant)); cursor: pointer; font: inherit; display: flex; flex-direction: column; align-items: stretch; gap: 6px; text-align: left; width: 100%; min-height: calc(92px + 48px * var(--file-volume)); padding: 10px 12px; border-radius: 7px; background: rgb(var(--v-theme-surface-container-low)); color: inherit; }
.subsystem-tree__file:hover { background: rgba(var(--v-theme-subsystem), 0.08); }
.subsystem-tree__file--selected { background: rgba(var(--v-theme-subsystem), 0.12); box-shadow: inset 3px 0 rgb(var(--v-theme-subsystem)); }
.subsystem-tree__file--main { border-color: rgb(var(--v-theme-warning)); background: color-mix(in srgb, rgb(var(--v-theme-warning-container)) 35%, rgb(var(--v-theme-surface-container-lowest))); box-shadow: inset 3px 0 rgb(var(--v-theme-warning)); }
.subsystem-tree__file--main:hover { background: color-mix(in srgb, rgb(var(--v-theme-warning-container)) 55%, rgb(var(--v-theme-surface-container-lowest))); }
.subsystem-tree__file--main.subsystem-tree__file--selected { outline: 2px solid rgb(var(--v-theme-subsystem)); outline-offset: -2px; }
.subsystem-tree__file:focus-visible, .subsystem-tree summary:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 1px; }
.subsystem-tree__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.subsystem-tree__type { display: flex; align-items: center; gap: 6px; color: rgb(var(--v-theme-on-surface-variant)); }
.subsystem-tree__type small { font-size: 10px; text-transform: uppercase; }
.subsystem-tree__document { display: block; font-size: 28px; width: 28px; height: 28px; }
.subsystem-tree__entry { align-self: flex-start; font-size: 10px; padding: 1px 5px; color: rgb(var(--v-theme-on-subsystem-container)); background: rgb(var(--v-theme-subsystem-container)); border-radius: 4px; }
.subsystem-tree__volume { display: flex; align-items: center; gap: 7px; color: rgb(var(--v-theme-on-surface-variant)); }
.subsystem-tree__volume small { margin-left: auto; text-align: right; font-variant-numeric: tabular-nums; }
.subsystem-tree__bar { display: block; flex: 1; height: 3px; background: rgb(var(--v-theme-outline-variant)); border-radius: 2px; }
.subsystem-tree__bar i { display: block; height: 100%; min-width: 1px; background: rgba(var(--v-theme-subsystem), 0.6); border-radius: 2px; }
@media (max-width: 600px) { .subsystem-tree__bar { display: none; } .subsystem-tree--branch { margin-left: 7px; padding-left: 4px; } }
.subsystem-tree__program { font-size: 11px; line-height: 16px; color: rgb(var(--v-theme-on-surface-variant)); display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.subsystem-tree__program--main { color: rgb(var(--v-theme-warning)); font-weight: 600; }
.subsystem-tree__program .v-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: text-bottom; }
</style>
