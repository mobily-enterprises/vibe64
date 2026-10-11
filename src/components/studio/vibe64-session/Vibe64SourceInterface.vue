<template>
  <section class="source-interface" aria-label="File public interface">
    <header class="source-interface__heading"><h3>{{ filePath?.split('/').pop() }}</h3><div class="source-interface__modes"><v-btn size="small" min-height="44" variant="text" @click="$emit('whole-file-code')">Code · whole file</v-btn></div><p>{{ filePath }}</p></header>
    <v-alert v-if="analysisError" type="error" variant="tonal" class="mb-3">{{ analysisError }}</v-alert>
    <v-alert v-if="dirty" type="info" variant="tonal" class="mb-3">This file has unsaved edits. Save before generating an explanation or using indexed symbol ranges.</v-alert>
    <v-alert v-else-if="!current" type="info" variant="tonal" class="mb-3">{{ indexed ? 'Index out of date.' : 'Symbols not indexed.' }} Open whole-file Code. Update the index from Architecture → ⋯.</v-alert>
    <section class="source-interface__overview" aria-label="File explanation">
      <header class="source-interface__field-heading">
        <h4>Explanation</h4>
        <span v-if="fileInterpretation" class="source-interface__freshness" :class="{ 'source-interface__freshness--stale': !isCurrentInterpretation(fileInterpretation) }">{{ isCurrentInterpretation(fileInterpretation) ? 'Saved' : 'Out of date' }}</span>
        <v-btn size="small" min-height="44" variant="text" :disabled="explanationDisabled" @click="$emit('explain-file', Boolean(fileInterpretation))">{{ fileInterpretation ? 'Update explanation' : 'Generate explanation' }}</v-btn>
      </header>
      <div class="source-interface__explanation" :class="{ 'source-interface__explanation--empty': !fileInterpretation && !activeFileInterpretation }">
        <slot v-if="activeFileInterpretation" name="explanation" :saved-body="fileInterpretation?.body || ''" />
        <LongTextPreviewBlocks v-else-if="fileInterpretation" :blocks="parseLongTextReviewBlocks(fileInterpretation.body)" @link-click="openProgramLink" />
        <p v-else class="source-interface__hint">{{ !assistantAvailable ? 'Choose a Helper in Model routing to generate an explanation.' : 'No explanation yet.' }}</p>
      </div>
    </section>
    <section v-if="mainPrograms.length" class="source-interface__interpretation" aria-label="Main Program file">
      <details v-for="program in mainPrograms" :key="program.id" class="source-interface__program" @toggle="$event.target.open && expandedPrograms.add(program.id)">
        <summary><small class="source-interface__main">Main</small><strong>{{ program.title }}</strong></summary>
        <p class="source-interface__program-description">{{ program.description }}</p>
        <div v-if="expandedPrograms.has(program.id)"><LongTextPreviewBlocks :blocks="parseLongTextReviewBlocks(program.publicContract)" @link-click="openProgramLink($event, program.path)" />
          <div class="source-interface__program-sources"><button v-for="path in program.sources" :key="path" type="button" :title="path" @click="$emit('open-source', { path })">{{ path }} ↗</button></div>
          <v-btn size="small" min-height="44" variant="text" @click="$emit('open-source', { path: program.path, presentation: 'code' })">Read Program</v-btn>
        </div>
      </details>
    </section>
    <nav v-if="memberPrograms.length === 1" class="source-interface__membership" aria-label="Program membership">
      <span v-for="program in memberPrograms" :key="program.id">Part of <button type="button" :title="program.mainSource ? `Open main source: ${program.mainSource}` : 'Read Program document'" @click="$emit('open-source', { path: program.mainSource || program.path, ...(program.mainSource ? {} : { presentation: 'code' }) })">{{ program.title }} ↗</button></span>
    </nav>
    <details v-else-if="memberPrograms.length > 1" class="source-interface__memberships">
      <summary>Part of {{ memberPrograms.length }} {{ mainPrograms.length ? 'other Programs' : 'Programs' }}</summary>
      <nav class="source-interface__membership" aria-label="Program membership"><span v-for="program in memberPrograms" :key="program.id"><button type="button" :title="program.mainSource ? `Open main source: ${program.mainSource}` : 'Read Program document'" @click="$emit('open-source', { path: program.mainSource || program.path, ...(program.mainSource ? {} : { presentation: 'code' }) })">{{ program.title }} ↗</button></span></nav>
    </details>
    <p v-if="interpretationWarning" class="source-interface__hint" role="status">{{ interpretationWarning }}</p>
    <h4 class="source-interface__exports-heading">File exports <span>{{ symbols.length }}</span></h4>
    <details class="source-interface__analysis"><summary>Analysis details</summary><p class="source-interface__hint">{{ coverage }}. File exports may be internal to the subsystem. Unrecorded returns are omitted.</p><p v-if="programStatus !== 'valid'" class="source-interface__hint">Program unavailable.</p><p v-if="!assistantAvailable" class="source-interface__hint">{{ assistantUnavailableMessage || 'A Helper is needed to generate explanations.' }}</p></details>
    <div class="source-interface__layout">
      <nav class="source-interface__symbols" aria-label="Exported and public symbols">
        <div v-for="symbol in symbols" :key="symbol.id" class="source-interface__symbol-row">
          <button class="source-interface__symbol" type="button" :data-symbol-id="symbol.id" :disabled="!current || dirty" :aria-pressed="symbol.id === selectedId" :class="{ 'source-interface__symbol--selected': symbol.id === selectedId }" @click="$emit('select-symbol', symbol.id)"><small>{{ symbol.kind }}</small><code :title="signature(symbol)">{{ signature(symbol) }}</code><span v-if="symbol.returnType">Returns: {{ symbol.returnType }}</span><span v-if="!symbol.rangeAvailable || symbol.visibilityScope && symbol.visibilityScope !== 'public'">{{ symbol.rangeAvailable ? '' : 'Range unavailable' }}{{ symbol.visibilityScope && symbol.visibilityScope !== 'public' ? ` · Visibility: ${symbol.visibilityScope}` : '' }}</span></button>
          <section v-if="symbol.id === selectedId" class="source-interface__detail" aria-label="Selected symbol">
        <p v-if="selectedSymbol.returnType" class="source-interface__hint">Returns: {{ selectedSymbol.returnType }}</p>
        <div class="source-interface__modes" aria-label="Symbol presentation">
          <h4 v-if="Array.isArray(selectedSymbol.parameters)">Pseudocode</h4>
          <v-btn v-if="presentation === 'code' && selectedInterpretation" size="small" min-height="44" variant="text" @click="$emit('select-symbol', selectedId)">Pseudocode</v-btn>
          <v-btn v-if="Array.isArray(selectedSymbol.parameters)" size="small" min-height="44" variant="text" :disabled="!selectedSymbol.rangeAvailable || !current || dirty || explanationDisabled" @click="$emit('present-symbol', 'steps', Boolean(selectedInterpretation))">{{ selectedInterpretation ? 'Update pseudocode' : 'Generate pseudocode' }}</v-btn>
          <v-btn size="small" min-height="44" variant="text" :disabled="!selectedSymbol.rangeAvailable || !current || dirty" @click="$emit('present-symbol', 'code')">Code</v-btn>
        </div>
        <p v-if="Array.isArray(selectedSymbol.parameters) && !assistantAvailable && !saved('selection', selectedId, 'steps')" class="source-interface__hint">Choose a Helper to generate pseudocode.</p>
        <pre v-if="presentation === 'code'" class="source-interface__code"><code>{{ source }}</code></pre>
        <template v-else-if="Array.isArray(selectedSymbol.parameters)">
          <p v-if="selectedInterpretation" class="source-interface__hint">{{ isCurrentInterpretation(selectedInterpretation) ? 'Saved · matches source' : 'Out of date · source or guidance changed' }}</p>
          <slot v-if="activeInterpretation" name="explanation" :saved-body="selectedInterpretation?.body || ''" />
          <LongTextPreviewBlocks v-else-if="selectedInterpretation" :blocks="interpretationBlocks" @link-click="openProgramLink" />
          <p v-else class="source-interface__hint">No pseudocode yet.</p>
        </template>
      </section>
        </div>
        <p v-if="!symbols.length" class="source-interface__hint">{{ current ? 'No exports recorded; analysis may be incomplete.' : 'Open whole-file Code.' }}</p>
      </nav>
    </div>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import { LongTextPreviewBlocks } from '@jskit-ai/assistant-core/client/conversation';
import { sourceEditorLinkTarget } from '@/lib/vibe64SourceEditorLinks.js';
import { parseLongTextReviewBlocks } from '@jskit-ai/assistant-core/shared/conversation';
const props = defineProps({ filePath: String, fileHash: String, analysisError: String, symbols: { type: Array, default: () => [] }, programs: { type: Array, default: () => [] }, programStatus: String, interpretations: { type: Array, default: () => [] }, interpretationWarning: String, activeInterpretation: Boolean, activeFileInterpretation: Boolean, selectedId: String, current: Boolean, indexed: Boolean, dirty: Boolean, busy: Boolean, assistantAvailable: Boolean, assistantUnavailableMessage: String, source: String, presentation: { type: String, default: 'description' }, coverage: { type: String, default: 'Partial static coverage' } });
const emit = defineEmits(['select-symbol', 'present-symbol', 'explain-file', 'whole-file-code', 'open-source']);
const expandedPrograms = ref(new Set());
const mainPrograms = computed(() => props.programs.filter(program => program.mainSource === props.filePath));
const memberPrograms = computed(() => props.programs.filter(program => program.mainSource !== props.filePath));
function openProgramLink({ event, href }, sourcePath) {
  const relative = href && !/^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(href);
  const target = sourceEditorLinkTarget({ href: relative && sourcePath ? new URL(href, `https://source.invalid/${sourcePath}`).pathname.slice(1) : href });
  if (!target) return;
  event?.preventDefault();
  emit('open-source', target);
}
const selectedSymbol = computed(() => props.symbols.find(symbol => symbol.id === props.selectedId));
const explanationDisabled = computed(() => props.busy || props.dirty || !props.assistantAvailable);
function signature(symbol) { return (symbol.qualifiedName || symbol.name) + (Array.isArray(symbol.parameters) ? `(${symbol.parameters.join(', ')})` : ''); }
function saved(scope, symbolId, presentation) { return props.interpretations.find(record => record.path === props.filePath && record.scope === scope && (record.symbolId || '') === symbolId && record.presentation === presentation); }
function isCurrentInterpretation(record) { return record.status === 'current' && record.fileHash === props.fileHash && !props.dirty; }
const selectedInterpretation = computed(() => saved('selection', selectedSymbol.value?.id || '', 'steps'));
const fileInterpretation = computed(() => saved('file', '', 'description'));
const interpretationBlocks = computed(() => parseLongTextReviewBlocks(selectedInterpretation.value?.body || ''));
</script>
<style scoped>
.source-interface { container-type: inline-size; overflow: auto; padding: 16px 22px; min-width: 0; min-height: 0; color: #304b50; }
.source-interface__heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 8px; margin-bottom: 6px; }
.source-interface__heading h3 { font-size: 20px; line-height: 26px; margin: 0; }.source-interface__heading p { grid-column: 1 / -1; font-size: 12px; line-height: 18px; margin: 0; opacity: .65; overflow-wrap: anywhere; }
.source-interface__heading > .source-interface__modes { justify-content: flex-end; margin: 0; }
.source-interface__overview { margin: 12px 0 18px; }
.source-interface__field-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 44px; }
.source-interface__field-heading h4 { margin: 0; font-size: 14px; font-weight: 650; }
.source-interface__field-heading :deep(.v-btn) { margin-left: auto; padding-inline: 10px; font-size: 12px; }
.source-interface__freshness { font-size: 11px; color: #69847d; }
.source-interface__freshness--stale { color: #936b2d; }
.source-interface__explanation { padding: 2px 0; max-width: 92ch; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
.source-interface__explanation :deep(p), .source-interface__explanation :deep(ul), .source-interface__explanation :deep(ol) { margin: 0 0 .7em; }
.source-interface__explanation :deep(h2), .source-interface__explanation :deep(h3), .source-interface__explanation :deep(h4) { font-size: 14px; margin: 1em 0 .3em; }
.source-interface__explanation--empty { padding: 12px; border: 1px dashed #d5e1dc; border-radius: 6px; }
.source-interface__explanation--empty .source-interface__hint { margin: 0; }
.source-interface__hint { font-size: 12px; line-height: 18px; opacity: .72; margin: 0 0 6px; }
.source-interface__modes { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.source-interface__detail .source-interface__modes { align-items: center; }
.source-interface__detail .source-interface__modes h4 { margin: 0 auto 0 0; font-size: 12px; font-weight: 600; color: #617b74; }
.source-interface__modes :deep(.v-btn) { padding-inline: 8px; }
.source-interface__layout { display: flex; flex-direction: column; gap: 10px; }
.source-interface__exports-heading { font-size: 15px; margin: 10px 0 4px; }
.source-interface__exports-heading span { font-weight: normal; font-size: 12px; opacity: .65; }
.source-interface__interpretation { padding: 0 10px; border: 1px solid #d8c18e; border-left: 3px solid #aa812c; border-radius: 6px; margin: 4px 0 8px; background: #fcfaf5; }
.source-interface__membership { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: center; font-size: 12px; margin: 2px 0 6px; color: #69847d; }
.source-interface__membership button { color: #367e8a; min-height: 44px; text-align: left; }
.source-interface__memberships { font-size: 12px; margin: 2px 0 6px; color: #69847d; }
.source-interface__memberships summary { cursor: pointer; min-height: 44px; align-content: center; }
.source-interface__main { display: inline-block; color: #755616; background: #f1e5c6; border-radius: 4px; padding: 2px 5px; font-size: 10px; text-transform: uppercase; margin-right: 8px; }
.source-interface__symbols, .source-interface__detail { min-width: 0; }
.source-interface__symbols { width: 100%; }
.source-interface__symbol-row { display: flex; flex-direction: column; align-items: stretch; margin-bottom: 4px; border: 1px solid #dbe6e3; border-radius: 6px; overflow: hidden; }
.source-interface__symbol-row > button:first-child { min-width: 0; flex: 1; margin-bottom: 0; }
.source-interface__symbol-row > :deep(.v-btn) { flex: 0 0 auto; padding-inline: 8px; }
.source-interface__symbols .source-interface__symbol { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; text-align: left; min-height: 44px; width: 100%; padding: 8px 10px; gap: 2px 8px; border: 0; background: #f7faf9; color: inherit; cursor: pointer; overflow-wrap: anywhere; }
.source-interface__symbols .source-interface__symbol code { display: block; min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-interface__symbols .source-interface__symbol small { text-transform: uppercase; font-size: 10px; opacity: .7; }
.source-interface__symbols .source-interface__symbol span, .source-interface__symbol-summary { grid-column: 2; font-size: 12px; margin: 0; }
.source-interface__symbols .source-interface__symbol span { font-size: 12px; opacity: .65; }
.source-interface__symbols .source-interface__symbol:disabled { opacity: .5; cursor: default; }
.source-interface__symbol--selected { background: rgba(var(--v-theme-primary), .1); border-color: rgb(var(--v-theme-primary)) !important; }
.source-interface__symbol--selected code { white-space: normal !important; overflow: visible !important; }
.source-interface__detail { width: 100%; padding: 8px 12px 12px; border-top: 1px solid #dbe6e3; font-size: 14px; line-height: 1.65; }
.source-interface__detail h4 { margin-bottom: 4px; overflow-wrap: anywhere; font-size: 14px; font-weight: normal; }
.source-interface__code { overflow: auto; padding: 16px; background: rgba(var(--v-theme-on-surface), .06); border-radius: 8px; font-size: 13px; tab-size: 2; }
button:focus-visible { outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
@container(max-width: 759px) { .source-interface__layout { grid-template-columns: minmax(0, 1fr); } .source-interface__detail { grid-row: 1; } .source-interface__heading { grid-template-columns: minmax(0, 1fr); } .source-interface__heading > .source-interface__modes { justify-content: flex-start; } .source-interface__symbols .source-interface__symbol { grid-template-columns: minmax(0, 1fr); } .source-interface__symbols .source-interface__symbol span { grid-column: 1; } }
@media(max-width: 759px) { .source-interface { padding: 12px; } }
.source-interface__analysis { font-size: 12px; opacity: .72; margin-bottom: 6px; }
.source-interface__analysis summary { cursor: pointer; }
.source-interface__program { padding: 6px 0; }
.source-interface__program summary { cursor: pointer; font-size: 13px; min-height: 44px; align-content: center; }
.source-interface__program-description { margin: 0 0 6px; font-size: 12px; line-height: 18px; }
.source-interface__program-sources { display: flex; gap: 4px 8px; flex-wrap: wrap; }
.source-interface__program-sources button { background: transparent; border: 0; cursor: pointer; color: #367e8a; min-height: 44px; overflow-wrap: anywhere; text-align: left; font-size: 12px; }
</style>
