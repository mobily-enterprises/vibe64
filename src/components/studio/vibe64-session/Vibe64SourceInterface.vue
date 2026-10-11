<template>
  <section class="source-interface" aria-label="File public interface">
    <header class="source-interface__heading"><h3>{{ filePath?.split('/').pop() }}</h3><v-btn size="small" min-height="44" variant="text" @click="$emit('whole-file-code')">Code · whole file</v-btn><p>{{ filePath }}</p></header>
    <v-alert v-if="analysisError" type="error" variant="tonal" class="mb-3">{{ analysisError }}</v-alert>
    <v-alert v-if="dirty" type="info" variant="tonal" class="mb-3">This file has unsaved edits. Save before generating an explanation or using indexed symbol ranges.</v-alert>
    <v-alert v-else-if="!current" type="info" variant="tonal" class="mb-3">{{ indexed ? 'The index is out of date for this file.' : 'Symbol analysis is unavailable for this file.' }} Whole-file Description and Code remain available.</v-alert>
    <div class="source-interface__file-actions"><v-btn size="small" min-height="44" :variant="!selectedId && presentation === 'description' ? 'tonal' : 'text'" :disabled="!saved('file', '', 'description') && explanationDisabled" @click="$emit('explain', { presentation: 'description' })">File summary</v-btn><v-btn size="small" min-height="44" :variant="!selectedId && presentation === 'steps' ? 'tonal' : 'text'" :disabled="!saved('file', '', 'steps') && explanationDisabled" @click="$emit('explain', { presentation: 'steps' })">File steps</v-btn><v-btn size="small" min-height="44" variant="text" :loading="refreshing" @click="$emit('refresh-analysis')">Refresh analysis</v-btn></div>
    <p v-if="!assistantAvailable" class="source-interface__hint" role="status">{{ assistantUnavailableMessage }} Saved interpretations remain readable. Generating or refreshing them requires a Helper.</p>
    <p v-if="interpretationWarning" class="source-interface__hint" role="status">{{ interpretationWarning }}</p>
    <section v-if="!selectedSymbol" class="source-interface__interpretation" aria-label="File overview">
      <div class="source-interface__interpretation-heading"><strong>{{ presentation === 'steps' ? 'File steps' : 'File summary' }}</strong><v-btn v-if="selectedInterpretation" size="small" min-height="44" variant="text" :disabled="explanationDisabled" @click="$emit('explain', { presentation, force: true })">Regenerate</v-btn></div>
      <p v-if="selectedInterpretation" class="source-interface__hint">Informational interpretation · {{ isCurrentInterpretation(selectedInterpretation) ? 'Matches saved source' : 'Stale — source or guidance changed' }}</p>
      <slot v-if="activeInterpretation" name="explanation" />
      <LongTextPreviewBlocks v-else-if="selectedInterpretation" :blocks="interpretationBlocks" />
      <p v-else class="source-interface__hint">{{ busy ? 'Preparing an explanation…' : assistantAvailable ? 'A summary is generated when this file is opened, then saved for reuse.' : 'No saved explanation. Choose an available Helper to generate one.' }}</p>
    </section>
    <h4 class="source-interface__exports-heading">File exports <span>{{ symbols.length }}</span></h4>
    <p class="source-interface__hint">{{ coverage }}. Visibility follows the language’s rules; file exports may be internal to their subsystem. Unrecorded return information is omitted.</p>
    <div class="source-interface__layout">
      <nav class="source-interface__symbols" aria-label="Exported and public symbols">
        <button v-for="symbol in symbols" :key="symbol.id" type="button" :data-symbol-id="symbol.id" :disabled="!current || dirty" :aria-pressed="symbol.id === selectedId" :class="{ 'source-interface__symbol--selected': symbol.id === selectedId }" @click="$emit('select-symbol', symbol.id)"><small>{{ symbol.kind }}</small><code :title="signature(symbol)">{{ signature(symbol) }}</code><span v-if="symbol.returnType">Returns: {{ symbol.returnType }}</span><span v-if="!symbol.rangeAvailable || symbol.visibilityScope && symbol.visibilityScope !== 'public'">{{ symbol.rangeAvailable ? '' : 'Range unavailable' }}{{ symbol.visibilityScope && symbol.visibilityScope !== 'public' ? ` · Visibility: ${symbol.visibilityScope}` : '' }}</span><p v-if="saved('selection', symbol.id, 'description')" class="source-interface__symbol-summary">{{ saved('selection', symbol.id, 'description').summary }}<small v-if="!isCurrentInterpretation(saved('selection', symbol.id, 'description'))"> · Stale</small></p></button>
        <p v-if="!symbols.length" class="pa-3 text-body-small text-medium-emphasis">{{ current ? 'No public symbols were recorded. Coverage is partial; this does not prove the file has no public interface.' : 'Refresh analysis or use the whole-file controls.' }}</p>
      </nav>
      <section v-if="selectedSymbol" class="source-interface__detail" aria-label="Selected symbol">
        <h4><code>{{ signature(selectedSymbol) }}</code></h4><p v-if="selectedSymbol.returnType" class="source-interface__hint">Returns: {{ selectedSymbol.returnType }}</p>
        <div class="source-interface__modes" aria-label="Symbol presentation">
          <v-btn v-for="option in ['description', 'steps', 'code']" :key="option" size="small" min-height="44" :variant="presentation === option ? 'tonal' : 'text'" :disabled="(!selectedSymbol.rangeAvailable || !current || dirty) || (option !== 'code' && !saved('selection', selectedId, option) && explanationDisabled)" @click="$emit('present-symbol', option)">{{ option.charAt(0).toUpperCase() + option.slice(1) }}</v-btn>
          <v-btn v-if="presentation !== 'code' && selectedInterpretation" size="small" min-height="44" variant="text" :disabled="explanationDisabled" @click="$emit('present-symbol', presentation, true)">Regenerate</v-btn>
        </div>
        <pre v-if="presentation === 'code'" class="source-interface__code"><code>{{ source }}</code></pre>
        <template v-else>
          <p v-if="selectedInterpretation" class="source-interface__hint">Informational interpretation · {{ isCurrentInterpretation(selectedInterpretation) ? 'Matches saved source' : 'Stale — source or guidance changed' }}</p>
          <slot v-if="activeInterpretation" name="explanation" />
          <LongTextPreviewBlocks v-else-if="selectedInterpretation" :blocks="interpretationBlocks" />
          <p v-else class="source-interface__hint">{{ busy ? 'Preparing an explanation…' : 'No saved explanation for this declaration.' }}</p>
        </template>
      </section>
      <p v-else-if="symbols.length" class="source-interface__hint">Select a definition to read its details here.</p>
    </div>
  </section>
</template>
<script setup>
import { computed } from 'vue';
import { LongTextPreviewBlocks } from '@jskit-ai/assistant-core/client/conversation';
import { parseLongTextReviewBlocks } from '@jskit-ai/assistant-core/shared/conversation';
const props = defineProps({ filePath: String, fileHash: String, analysisError: String, symbols: { type: Array, default: () => [] }, interpretations: { type: Array, default: () => [] }, interpretationWarning: String, activeInterpretation: Boolean, selectedId: String, current: Boolean, indexed: Boolean, dirty: Boolean, busy: Boolean, refreshing: Boolean, assistantAvailable: Boolean, assistantUnavailableMessage: String, source: String, presentation: { type: String, default: 'description' }, coverage: { type: String, default: 'Partial static coverage' } });
defineEmits(['select-symbol', 'present-symbol', 'whole-file-code', 'explain', 'refresh-analysis']);
const selectedSymbol = computed(() => props.symbols.find(symbol => symbol.id === props.selectedId));
const explanationDisabled = computed(() => props.busy || props.dirty || !props.assistantAvailable);
function signature(symbol) { return (symbol.qualifiedName || symbol.name) + (Array.isArray(symbol.parameters) ? `(${symbol.parameters.join(', ')})` : ''); }
function saved(scope, symbolId, presentation) { return props.interpretations.find(record => record.path === props.filePath && record.scope === scope && (record.symbolId || '') === symbolId && record.presentation === presentation); }
function isCurrentInterpretation(record) { return record.status === 'current' && record.fileHash === props.fileHash && !props.dirty; }
const selectedInterpretation = computed(() => saved(selectedSymbol.value ? 'selection' : 'file', selectedSymbol.value?.id || '', props.presentation));
const interpretationBlocks = computed(() => parseLongTextReviewBlocks(selectedInterpretation.value?.body || ''));
</script>
<style scoped>
.source-interface { container-type: inline-size; overflow: auto; padding: 12px; min-width: 0; min-height: 0; }
.source-interface__heading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 3px 8px; margin-bottom: 6px; }
.source-interface__heading h3 { font-size: 20px; line-height: 26px; margin: 0; }.source-interface__heading p { grid-column: 1 / -1; font-size: 12px; line-height: 18px; margin: 0; opacity: .65; overflow-wrap: anywhere; }
.source-interface__hint { font-size: 12px; line-height: 18px; opacity: .72; margin: 0 0 6px; }
.source-interface__file-actions, .source-interface__modes { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.source-interface__file-actions :deep(.v-btn), .source-interface__modes :deep(.v-btn) { padding-inline: 8px; }
.source-interface__layout { display: flex; flex-direction: column; gap: 10px; }
.source-interface__exports-heading { font-size: 15px; margin: 10px 0 4px; }
.source-interface__exports-heading span { font-weight: normal; font-size: 12px; opacity: .65; }
.source-interface__interpretation { padding: 8px 10px; border: 1px solid #dbe6e3; border-radius: 8px; margin: 4px 0 10px; }
.source-interface__interpretation-heading { display: flex; align-items: center; justify-content: space-between; }
.source-interface__symbols, .source-interface__detail { min-width: 0; }
.source-interface__symbols { width: 100%; }
.source-interface__symbols button { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; text-align: left; min-height: 44px; width: 100%; padding: 6px 10px; gap: 2px 8px; border: 1px solid #dbe6e3; background: #f7faf9; border-radius: 6px; margin-bottom: 4px; color: inherit; cursor: pointer; overflow-wrap: anywhere; }
.source-interface__symbols button code { display: block; min-width: 0; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.source-interface__symbols button small { text-transform: uppercase; font-size: 10px; opacity: .7; }
.source-interface__symbols button span, .source-interface__symbol-summary { grid-column: 2; font-size: 12px; margin: 0; }
.source-interface__symbols button span { font-size: 12px; opacity: .65; }
.source-interface__symbols button:disabled { opacity: .5; cursor: default; }
.source-interface__symbol--selected { background: rgba(var(--v-theme-primary), .1); border-color: rgb(var(--v-theme-primary)) !important; }
.source-interface__detail { order: -1; width: 100%; border: 1px solid #dbe6e3; border-radius: 8px; padding: 10px; }
.source-interface__detail h4 { margin-bottom: 4px; overflow-wrap: anywhere; font-size: 14px; font-weight: normal; }
.source-interface__code { overflow: auto; padding: 16px; background: rgba(var(--v-theme-on-surface), .06); border-radius: 8px; font-size: 13px; tab-size: 2; }
button:focus-visible { outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
@container(max-width: 759px) { .source-interface__layout { grid-template-columns: minmax(0, 1fr); } .source-interface__detail { grid-row: 1; } }
@media(max-width: 759px) { .source-interface { padding: 12px; } }
</style>
