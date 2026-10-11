<template>
  <section class="subsystem-inspector" :class="{ 'subsystem-inspector--embedded': embedded }" :aria-label="outline.owner.opaque ? 'External package interface' : 'Subsystem interface'">
    <header class="subsystem-inspector__header">
      <div><small>{{ outline.owner.opaque ? 'EXTERNAL DEPENDENCY' : outline.owner.placementKind === 'libraries' ? 'SHARED LIBRARY' : 'SUBSYSTEM' }}</small><h2>{{ outline.owner.title }}</h2><p>{{ outline.owner.root }}</p></div>
      <button v-if="!embedded" type="button" class="subsystem-inspector__close" aria-label="Back to architecture map" @click="$emit('close')">×</button>
    </header>
    <div class="subsystem-inspector__body">
      <div class="subsystem-inspector__description"><slot name="text" :text="outline.owner.description" source-path="genesis/subsystems.md">{{ outline.owner.description || 'This subsystem has no recorded description yet.' }}</slot></div>
      <p class="subsystem-inspector__summary">{{ outline.owner.opaque ? 'External package · source remains opaque' : `${outline.files.length} file${outline.files.length === 1 ? '' : 's'} · ${measuredFiles ? measuredLines.toLocaleString() + ' measured source lines' + (measuredFiles < outline.files.length ? ` (${measuredFiles}/${outline.files.length} files)` : '') : 'Source size unavailable'}` }}</p>
      <section class="subsystem-inspector__section" aria-label="Subsystem Program">
        <h3>What this subsystem does <span>{{ outline.programs?.length || 0 }}</span></h3>
        <details v-for="program in outline.programs || []" :key="program.id" class="subsystem-inspector__program nodrag nopan" @toggle="$event.target.open && expandedPrograms.add(program.id)">
          <summary><strong>{{ program.title }}</strong><span>{{ program.description }}</span></summary>
          <div v-if="expandedPrograms.has(program.id)">
            <slot name="text" :text="program.publicContract" :source-path="program.path"><p class="subsystem-inspector__contract">{{ program.publicContract }}</p></slot>
            <div class="subsystem-inspector__program-sources"><button v-for="path in program.sources" :key="path" type="button" @click="$emit('inspect', { path })">{{ path }} ↗</button></div>
            <button type="button" class="subsystem-inspector__program-document" @click="$emit('open-source', { path: program.path })">Read or edit Program explanation ↗</button>
          </div>
        </details>
        <p v-if="!outline.programs?.length" class="subsystem-inspector__hint" role="status">{{ outline.programStatus === 'valid' ? 'No authored explanation.' : 'Program unavailable. Refresh analysis.' }}</p>
        <p v-for="diagnostic in outline.programDiagnostics || []" :key="diagnostic.code + diagnostic.message" class="subsystem-inspector__coverage" role="status">{{ diagnostic.message }}</p>
      </section>
        <section class="subsystem-inspector__section" aria-label="Subsystem interface">
          <h3>Interface</h3>
          <p v-if="!outline.publicEntries.length" class="subsystem-inspector__hint">Intended API not declared.</p>
          <p v-if="outline.dependencyCoverage !== 'complete' && !outline.owner.opaque" class="subsystem-inspector__coverage" role="status" title="Unobserved imports do not prove an export is internal or unused.">Import analysis {{ outline.dependencyCoverage || 'unavailable' }}.</p>
          <label v-if="(outline.exportCount || outline.publicSymbols.length) > 12" class="subsystem-inspector__search">Find a signature<input v-model="symbolQuery" type="search" placeholder="Operation, component, value or type" /></label>
          <details v-for="group in signatureGroups" :key="group.key" class="subsystem-inspector__surface nodrag nopan" :open="group.primary" @toggle="$event.target.open && expandedGroups.add(group.key)">
            <summary :title="group.explanation">{{ group.title }} · {{ group.count }}</summary>
            <div v-if="group.primary || expandedGroups.has(group.key)">
              <div class="subsystem-inspector__signatures">
                <template v-for="symbol in group.symbols.slice(0, 200)" :key="`${symbol.source?.symbolId || symbol.importPaths?.join(',')}:${symbol.qualifiedName || symbol.name}:${symbol.start?.line || ''}`">
                  <button v-if="symbol.source" type="button" class="subsystem-inspector__signature nodrag nopan" :title="`Open ${symbol.source.path}:${symbol.source.line || ''}`" @click="$emit('inspect', symbol.source)">
                    <small>{{ symbol.kind || 'Declaration' }}</small><code :title="signature(symbol)">{{ signature(symbol) }}</code><span v-if="symbol.returnType" class="subsystem-inspector__returns">→ {{ symbol.returnType }}</span><span class="subsystem-inspector__source">{{ basename(symbol.source.path) }} ↗</span>
                    <span v-if="symbol.declared || symbol.importPaths?.length" class="subsystem-inspector__evidence">Declared export</span>
                    <span v-if="group.key === 'observed' && symbol.consumers?.length" class="subsystem-inspector__consumers" :title="symbol.consumers.map(file => file.path).join('\n')">Imported by {{ [...new Set(symbol.consumers.map(file => file.subsystemId))].length }} subsystem(s) · {{ symbol.consumers.length }} file(s)</span>
                  </button>
                  <div v-else class="subsystem-inspector__signature subsystem-inspector__signature--unresolved"><small>{{ symbol.kind || 'Declaration' }}</small><code :title="signature(symbol)">{{ signature(symbol) }}</code><span v-if="symbol.returnType" class="subsystem-inspector__returns">→ {{ symbol.returnType }}</span><span>{{ outline.owner.opaque ? 'External package' : 'Implementation location not resolved' }}</span></div>
                </template>
              </div>
              <p v-if="group.symbols.length > 200" class="subsystem-inspector__hint">Showing 200 matches. Refine the search.</p>
              <p v-if="symbolQuery && !group.symbols.length" class="subsystem-inspector__hint">No declarations match this search.</p>
            </div>
          </details>
          <details class="subsystem-inspector__technical nodrag nopan"><summary>Analysis details</summary>
            <p v-for="group in signatureGroups" :key="group.key"><strong>{{ group.title }}:</strong> {{ group.explanation }}</p>
            <p v-if="outline.publicEntries.some(entry => entry.coverage !== 'complete')">Partial export analysis. Unknown return types omitted.</p>
          </details>
          <details v-if="outline.publicEntries.length" class="subsystem-inspector__technical nodrag nopan"><summary>Import paths · {{ outline.publicEntries.length }}</summary>
            <div v-for="(entry, index) in outline.publicEntries" :key="index"><code>{{ entry.importPath }}</code><p>{{ entry.conditions.join(' · ') || 'Default conditions' }}<span v-if="entry.target"> · {{ entry.target }}</span></p><p v-if="!entry.symbols.length">Public declarations have not been resolved for this path.</p></div>
          </details>
        </section>
        <section v-if="outline.operations.length" class="subsystem-inspector__section">
          <h3>Receives UI calls <span>{{ outline.operations.length }}</span></h3>
          <button v-for="call in outline.operations" :key="call.id" type="button" class="subsystem-inspector__signature nodrag nopan" @click="$emit('inspect', { path: call.file.path, symbol: call.controllerSymbol })"><code>{{ [call.key?.protocol, call.key?.method, call.key?.operation].filter(Boolean).join(' · ') || call.id }}</code><span>{{ basename(call.file.path) }} ↗<template v-if="call.pages.length"> · {{ call.pages.map(page => page.title).join(', ') }}</template></span></button>
        </section>
      <section v-if="!outline.owner.opaque" class="subsystem-inspector__section subsystem-inspector__files">
          <h3>Files <span>{{ outline.files.length }}</span></h3><p class="subsystem-inspector__hint">Click a file to open it. Bars compare source size.</p>
          <div class="subsystem-inspector__file-tools nodrag nopan">
            <label class="subsystem-inspector__search">Find a file<input v-model="query" type="search" placeholder="Name or path" /></label>
            <label class="subsystem-inspector__sort">Sort<select v-model="sortBy"><option value="name">Name</option><option value="type">File type</option><option value="size">Size · largest first</option></select></label>
          </div>
          <Vibe64SubsystemTreeBranch :items="tree" :folder-state="folderState" :searching="!!query.trim()" :selected-id="selected?.id || ''" @select="selected = $event" @inspect="$emit('inspect', $event)" />
          <p v-if="!tree.length" class="subsystem-inspector__hint">No files match this search.</p>
      </section>
    </div>
  </section>
</template>
<script setup>
import { computed, ref, watch } from 'vue';
import Vibe64SubsystemTreeBranch from './Vibe64SubsystemTreeBranch.vue';
const props = defineProps({ outline: { type: Object, required: true }, embedded: Boolean });
defineEmits(['close', 'inspect', 'open-source']);
const query = ref('');
const folderState = ref(new Map());
const symbolQuery = ref('');
const sortBy = ref('name');
const selected = ref(null);
const expandedGroups = ref(new Set());
const expandedPrograms = ref(new Set());
const signatureGroups = computed(() => {
  const term = symbolQuery.value.trim().toLocaleLowerCase();
  const observed = props.outline.observedSymbols || [];
  const observedIds = new Set(observed.map(symbol => symbol.source.symbolId));
  return [
    { key: 'observed', title: 'Imported by other subsystems', primary: true, symbols: observed, explanation: 'These particular declarations are imported across this directory boundary. Imports do not prove runtime calls or intended API membership.' },
    { key: 'declared', title: 'Declared API', primary: !observed.length, symbols: props.outline.publicSymbols.filter(symbol => !observedIds.has(symbol.source?.symbolId)), explanation: 'Explicit package or module exports, including members with no observed consumers.' },
    { key: 'candidates', title: 'API review candidates', primary: !observed.length && !props.outline.publicSymbols.length, symbols: props.outline.boundarySymbols, explanation: 'Exports from externally imported files. Individual imports are unproven.' },
    { key: 'available', title: 'Other available exports', primary: false, symbols: props.outline.availableSymbols || [], explanation: 'Available under the language’s visibility rules. They may be internal, unused or useful to future consumers; current analysis does not decide intent.' }
  ].filter(group => group.symbols.length).map(group => ({ ...group, count: group.symbols.length, symbols: group.symbols.filter(symbol => !term || `${symbol.qualifiedName || ''} ${symbol.name || ''} ${symbol.source?.path || ''}`.toLocaleLowerCase().includes(term)) }));
});
const measuredFiles = computed(() => props.outline.files.filter(file => Number.isSafeInteger(file.sourceLines)).length);
const measuredLines = computed(() => props.outline.files.reduce((total, file) => total + (Number.isSafeInteger(file.sourceLines) ? file.sourceLines : 0), 0));
function signature(symbol) { return (symbol.qualifiedName || symbol.name) + (Array.isArray(symbol.parameters) ? `(${symbol.parameters.join(', ')})` : ''); }
function basename(path) { return path.split('/').pop(); }
const tree = computed(() => {
  const term = query.value.trim().toLocaleLowerCase();
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  function compare(a, b) {
    if (a.kind !== b.kind) return a.kind === 'file' ? -1 : 1;
    if (a.kind === 'file') {
      if (sortBy.value === 'size') {
        const size = item => Number.isSafeInteger(item.file.sourceLines) ? item.file.sourceLines : -1;
        if (size(a) !== size(b)) return size(b) - size(a);
      }
      if (sortBy.value === 'type') {
        const extension = item => item.name.includes('.') ? item.name.split('.').at(-1).toLocaleLowerCase() : '';
        const typeOrder = extension(a).localeCompare(extension(b));
        if (typeOrder) return typeOrder;
      }
    }
    return byName(a, b);
  }
  function arrange(items) {
    return items.flatMap(item => {
      if (item.kind === 'file') return !term || item.file.path.toLocaleLowerCase().includes(term) ? [item] : [];
      const children = arrange(item.children);
      return children.length ? [{ ...item, children }] : [];
    }).sort(compare);
  }
  return arrange(props.outline.tree);
});
watch(() => props.outline.owner.id, () => { query.value = ''; symbolQuery.value = ''; selected.value = null; sortBy.value = 'name'; folderState.value = new Map(); expandedGroups.value = new Set(); expandedPrograms.value = new Set(); });
</script>
<style scoped>
.subsystem-inspector { position: absolute; z-index: 10; top: 14px; bottom: 42px; right: 14px; width: min(560px, calc(100% - 28px)); display: flex; flex-direction: column; min-height: 0; color: #304b50; background: #fff; border: 1px solid #b6cfca; border-radius: 14px; box-shadow: 0 12px 40px #183e4329; }
.subsystem-inspector--embedded { position: relative; inset: auto; width: 100%; box-shadow: none; border: 0; }
.subsystem-inspector--embedded .subsystem-inspector__header small { display: none; }
.subsystem-inspector--embedded h2 { font-size: 18px; }
.subsystem-inspector__header { display: flex; justify-content: space-between; gap: 10px; padding: 12px 18px; border-bottom: 1px solid #deebe6; background: #f3f9f6; border-radius: 14px 14px 0 0; }
.subsystem-inspector__header small { color: #63867d; letter-spacing: .08em; font-size: 10px; }
.subsystem-inspector h2 { margin: 3px 0; font-size: 22px; }
.subsystem-inspector__header p { margin: 0; font: 13px/20px ui-monospace, monospace; color: #5f8278; overflow-wrap: anywhere; }
.subsystem-inspector__close { background: transparent; border: 0; cursor: pointer; align-self: flex-start; font-size: 24px; line-height: 32px; width: 32px; border-radius: 6px; color: #597970; }
.subsystem-inspector__body { padding: 10px 18px; overflow: auto; min-height: 0; overscroll-behavior: contain; }
.subsystem-inspector--embedded .subsystem-inspector__body { overflow: visible; }
.subsystem-inspector__description { font-size: 15px; line-height: 23px; margin: 0 0 8px; }
.subsystem-inspector__summary { color: #789187; font-size: 12px; margin: 0 0 8px; }
.subsystem-inspector__section { padding: 10px 0; border-top: 1px solid #e2eae7; }
.subsystem-inspector h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; }
.subsystem-inspector h3 span { font-size: 11px; color: #6b8b80; background: #ecf4ef; padding: 2px 6px; border-radius: 10px; margin-left: 5px; }
.subsystem-inspector__hint { font-size: 12px; line-height: 19px; color: #6b827a; margin: 4px 0 7px; }
.subsystem-inspector__coverage { font-size: 12px; line-height: 18px; color: #886233; margin: 4px 0 8px; }
.subsystem-inspector__surface { margin: 5px 0; }
.subsystem-inspector__signature .subsystem-inspector__evidence { grid-column: 1; color: #377d65; font-size: 10px; }
.subsystem-inspector__signature .subsystem-inspector__consumers { grid-column: 2 / -1; font-size: 11px; }
.subsystem-inspector__signatures { display: flex; flex-direction: column; gap: 4px; }
.subsystem-inspector__signature { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; width: 100%; min-height: 38px; text-align: left; padding: 7px 10px; color: #274f58; background: #f5f9f8; border: 1px solid #d9e7e2; cursor: pointer; border-radius: 8px; overflow-wrap: anywhere; }
.subsystem-inspector__signature:hover { background: #eaf4f2; border-color: #80b1a7; }
.subsystem-inspector__signature--unresolved { cursor: default; }
.subsystem-inspector__signature small { font-size: 10px; color: #6b8580; text-transform: uppercase; }
.subsystem-inspector__signature code { grid-column: 2; grid-row: 1; min-width: 0; font-size: 13px; line-height: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subsystem-inspector__signature:not(:has(small)) code { grid-column: 1 / 3; }
.subsystem-inspector__signature .subsystem-inspector__returns { grid-column: 2; font: 11px/16px ui-monospace, monospace; }
.subsystem-inspector__signature span { font-size: 11px; color: #6b8580; }
.subsystem-inspector__signature .subsystem-inspector__source { grid-column: 3; grid-row: 1; color: #367e8a; max-width: 160px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.subsystem-inspector__technical { margin-top: 14px; font-size: 12px; color: #6b827a; }
.subsystem-inspector__technical div { padding: 8px 0; border-bottom: 1px solid #e8eeeb; }
.subsystem-inspector__technical p { margin: 3px 0; overflow-wrap: anywhere; }
.subsystem-inspector summary { cursor: pointer; padding: 7px 0; font-size: 13px; }
.subsystem-inspector__search { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #6b827a; margin: 12px 0; }
.subsystem-inspector__search input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #d6e2dc; border-radius: 6px; color: #304b50; }
.subsystem-inspector__file-tools { display: flex; align-items: center; gap: 12px; margin: 8px 0; flex-wrap: wrap; }
.subsystem-inspector__file-tools .subsystem-inspector__search { flex: 1; margin: 0; }
.subsystem-inspector__file-tools input, .subsystem-inspector__sort select { min-height: 44px; font: inherit; }
.subsystem-inspector__sort { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #6b827a; }
.subsystem-inspector__sort select { max-width: 190px; padding: 6px 8px; border: 1px solid #d6e2dc; border-radius: 6px; background: white; color: #304b50; }
.subsystem-inspector button:focus-visible, .subsystem-inspector summary:focus-visible { outline: 2px solid #377dcb; outline-offset: 2px; }
@media (max-width: 600px) { .subsystem-inspector__signature { grid-template-columns: 64px minmax(0, 1fr); gap: 2px 6px; } .subsystem-inspector__signature .subsystem-inspector__source { grid-column: 2; grid-row: auto; max-width: 100%; } .subsystem-inspector__signature small { font-size: 9px; white-space: nowrap; } .subsystem-inspector:not(.subsystem-inspector--embedded) { top: 8px; right: 8px; bottom: 32px; width: calc(100% - 16px); } .subsystem-inspector__header { padding: 12px 16px; } .subsystem-inspector__body { padding: 10px 16px; } }
.subsystem-inspector__program { border-bottom: 1px solid #e2eae7; }
.subsystem-inspector__program summary { display: list-item; padding: 8px 0; }
.subsystem-inspector__program summary span { display: block; font-size: 12px; line-height: 18px; color: #6b827a; margin-top: 2px; }
.subsystem-inspector__program:not([open]) summary span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.subsystem-inspector__contract { white-space: pre-wrap; font-size: 13px; line-height: 20px; }
.subsystem-inspector__program-sources { display: flex; flex-wrap: wrap; gap: 4px 8px; }
.subsystem-inspector__program-sources button, .subsystem-inspector__program-document { border: 0; background: transparent; color: #367e8a; font-size: 12px; text-align: left; overflow-wrap: anywhere; min-height: 44px; cursor: pointer; }
</style>
