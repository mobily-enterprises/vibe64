<template>
  <section class="program-inspector" aria-label="Program explanation">
    <header><small>PROGRAM</small><h2>{{ program.title }}</h2><p>{{ owner?.title }}</p></header>
    <button type="button" class="program-inspector__anchor" @click="$emit('inspect', { path: program.mainSource })"><small>Main source file</small><strong>{{ program.mainSource }} →</strong></button>
    <nav v-if="supportingFiles.length"><button type="button" @click="filesElement?.scrollIntoView({ block: 'start' })">Supporting files {{ supportingFiles.length }} ↓</button></nav>
    <div class="program-inspector__explanation"><slot name="text" :text="program.description" :source-path="program.path">{{ program.description }}</slot></div>
    <div class="program-inspector__explanation"><slot name="text" :text="program.publicContract" :source-path="program.path">{{ program.publicContract }}</slot></div>
    <section ref="filesElement"><h3>Source files <small>{{ files.length }}</small></h3><Vibe64SubsystemTreeBranch :items="[...mainFiles, ...supportingFiles]" @inspect="$emit('inspect', $event)" /></section>
  </section>
</template>
<script setup>
import { computed, ref } from 'vue';
import Vibe64SubsystemTreeBranch from './Vibe64SubsystemTreeBranch.vue';
const props = defineProps({ program: { type: Object, required: true }, architecture: { type: Object, required: true }, owner: Object });
defineEmits(['inspect']);
const filesElement = ref(null);
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
.program-inspector__explanation { max-width: 92ch; font-size: 14px; line-height: 1.65; overflow-wrap: anywhere; }
.program-inspector h3 { margin: 18px 0 8px; font-size: 15px; }
.program-inspector h3 small { font-weight: normal; }
.program-inspector__anchor { display: block; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 6px; border: 1px solid #bd974d; border-radius: 6px; background: #fcfaf5; cursor: pointer; overflow-wrap: anywhere; }
.program-inspector__anchor small, .program-inspector__anchor strong { display: block; }
.program-inspector__anchor small { color: #755616; font-size: 11px; }
.program-inspector__anchor strong { font-size: 13px; }
.program-inspector nav button { color: #367e70; min-height: 44px; padding: 0 8px; cursor: pointer; }
.program-inspector :deep(.subsystem-tree) { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
</style>
