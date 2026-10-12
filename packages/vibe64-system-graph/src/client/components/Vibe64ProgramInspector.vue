<template>
  <section class="program-inspector" aria-label="Program explanation">
    <header><small>PROGRAM</small><h2>{{ program.title }}</h2><p>{{ owner?.title }}</p></header>
    <button type="button" class="program-inspector__anchor" @click="$emit('inspect', { path: program.mainSource })"><small>Main source file</small><strong>{{ program.mainSource }} →</strong></button>
    <nav v-if="supportingFiles.length"><button type="button" @click="filesElement?.scrollIntoView({ block: 'start' })">Supporting files {{ supportingFiles.length }} ↓</button></nav>
    <div class="program-inspector__preview"><slot name="text" :text="preview" :source-path="program.path">{{ preview }}</slot></div>
    <v-dialog v-model="explanationOpen" max-width="800" scrollable class="program-explanation-dialog" :aria-labelledby="dialogTitleId">
      <template #activator="{ props: activatorProps }"><button v-bind="activatorProps" type="button" class="program-inspector__read" aria-haspopup="dialog">Read full explanation</button></template>
      <v-card>
        <header class="program-explanation-dialog__header"><h2 :id="dialogTitleId">{{ program.title }}</h2><button type="button" aria-label="Close Program explanation" @click="explanationOpen = false">×</button></header>
        <v-card-text class="program-explanation-dialog__body">
          <div><slot name="text" :text="program.description" :source-path="program.path">{{ program.description }}</slot></div>
          <div><slot name="text" :text="program.publicContract" :source-path="program.path">{{ program.publicContract }}</slot></div>
        </v-card-text>
      </v-card>
    </v-dialog>
    <section ref="filesElement"><h3>Source files <small>{{ files.length }}</small></h3><Vibe64SubsystemTreeBranch :items="[...mainFiles, ...supportingFiles]" @inspect="$emit('inspect', $event)" /></section>
  </section>
</template>
<script setup>
import { computed, ref, useId, watch } from 'vue';
import Vibe64SubsystemTreeBranch from './Vibe64SubsystemTreeBranch.vue';
const props = defineProps({ program: { type: Object, required: true }, architecture: { type: Object, required: true }, owner: Object, active: { type: Boolean, default: true } });
defineEmits(['inspect']);
const filesElement = ref(null);
const explanationOpen = ref(false);
const dialogTitleId = useId();
const preview = computed(() => props.program.description.trim().split(/\n\s*\n/u)[0]);
watch([() => props.program.id, () => props.active], () => { explanationOpen.value = false; });
const files = computed(() => {
  const sources = new Set(props.program.sources);
  const indexed = props.architecture.files.filter(file => sources.has(file.path));
  const largest = Math.max(1, ...indexed.map(file => file.sourceLines || 0));
  return indexed.map(file => ({ kind: 'file', id: file.id, name: file.path, file, programs: [props.program], reasons: [], volume: Number.isSafeInteger(file.sourceLines) ? file.sourceLines / largest : null }));
});
const mainFiles = computed(() => files.value.filter(item => item.file.path === props.program.mainSource));
const supportingFiles = computed(() => files.value.filter(item => item.file.path !== props.program.mainSource).sort((a, b) => a.name.localeCompare(b.name)));
</script>
<style scoped>
.program-inspector { padding: 16px 22px; color: #304b50; user-select: text; overflow: auto; min-height: 0; flex: 1; }
.program-inspector header { margin-bottom: 16px; }
.program-inspector header small { font-size: 10px; color: #69847d; }
.program-inspector h2 { margin: 2px 0; font-size: 20px; }
.program-inspector header p { margin: 0; font-size: 12px; color: #69847d; }
.program-inspector__preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; max-height: 4.8em; overflow: hidden; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.program-inspector__preview :deep(p) { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 4px 0; }
.program-inspector__read { min-height: 44px; padding: 4px 8px; color: #367e70; cursor: pointer; }
.program-inspector__read:focus-visible, .program-explanation-dialog__header button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.program-explanation-dialog__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .12); }
.program-explanation-dialog__header h2 { margin: 0; font-size: 20px; overflow-wrap: anywhere; }
.program-explanation-dialog__header button { flex: none; min-width: 44px; min-height: 44px; font-size: 26px; cursor: pointer; }
.program-explanation-dialog__body { font-size: 15px; line-height: 1.65; overflow-wrap: anywhere; user-select: text; overscroll-behavior: contain; }
@media (max-width: 600px) { .program-explanation-dialog :deep(.v-overlay__content) { margin: 0; width: 100%; max-width: 100%; height: 100dvh; max-height: 100dvh; } .program-explanation-dialog :deep(.v-card) { height: 100%; border-radius: 0; } }
.program-inspector h3 { margin: 18px 0 8px; font-size: 15px; }
.program-inspector h3 small { font-weight: normal; }
.program-inspector__anchor { display: block; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 6px; border: 1px solid #bd974d; border-radius: 6px; background: #fcfaf5; cursor: pointer; overflow-wrap: anywhere; }
.program-inspector__anchor small, .program-inspector__anchor strong { display: block; }
.program-inspector__anchor small { color: #755616; font-size: 11px; }
.program-inspector__anchor strong { font-size: 13px; }
.program-inspector nav button { color: #367e70; min-height: 44px; padding: 0 8px; cursor: pointer; }
.program-inspector :deep(.subsystem-tree) { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
</style>
