<template>
  <section class="project-settings__section" aria-labelledby="connected-projects-title">
    <div class="project-settings__section-copy text-body-medium">
      <h2 id="connected-projects-title" class="text-title-medium font-weight-bold">Connected projects</h2>
      <p>Libraries and source projects you contribute to from this project.</p>
      <p>Saved in this source checkout’s <code>vibe64.connections.json</code>. Changes follow normal project Save.</p>
    </div>
    <div class="project-settings__content text-body-medium">
      <p v-if="!state.available">{{ state.unavailableReason || 'Select a session to configure connected projects.' }}</p>
      <template v-else>
        <p v-if="!state.exists">No connection file yet. Add projects below, then save the list.</p>
        <v-alert v-if="stale" type="warning" variant="tonal">
          The saved list changed while you were editing. Reload the saved list and review your changes before saving.
          <v-btn variant="text" @click="resetDraft">Reload saved list</v-btn>
        </v-alert>
        <fieldset v-for="(entry, index) in draft" :key="index" class="connection-entry" :disabled="!state.canEdit || saving">
          <legend class="text-label-large">Connected project {{ index + 1 }}</legend>
          <v-text-field :disabled="!state.canEdit || saving" v-model="entry.name" label="Name" maxlength="100" variant="outlined" hide-details="auto" />
          <v-text-field :disabled="!state.canEdit || saving" v-model="entry.repository" label="GitHub repository URL" placeholder="https://github.com/owner/repository" variant="outlined" hide-details="auto" />
          <v-select :disabled="!state.canEdit || saving" v-model="entry.relationship" label="Relationship" :items="relationships" item-title="label" item-value="value" variant="outlined" hide-details="auto" />
          <v-select :disabled="!state.canEdit || saving" :model-value="entry.type || ''" @update:model-value="setPackageType(entry, $event)" label="Package type" :items="packageTypes" item-title="label" item-value="value" variant="outlined" hide-details="auto" />
          <v-text-field :disabled="!state.canEdit || saving || !scriptAllowed(entry)" :model-value="entry.script || ''" @update:model-value="setScript(entry, $event)" label="Preparation script (project-relative)" placeholder="tooling/prepare-native-worker.mjs" maxlength="1024" hint="Required for custom. Relative to this project's root; Stack declares the runtime." persistent-hint variant="outlined" hide-details="auto" />
          <v-btn :disabled="!state.canEdit || saving" variant="text" :aria-label="`Remove ${entry.name || 'connected project'}`" @click="draft.splice(index, 1)">Remove</v-btn>
        </fieldset>
        <p v-if="state.exists && !draft.length">No connected projects.</p>
        <p class="text-body-small">Removing a connection preserves its existing contributions and pending work.</p>
        <div class="connection-actions">
          <v-btn :disabled="!state.canEdit || saving || draft.length >= CONNECTED_PROJECTS_LIMIT" variant="outlined" @click="draft.push({ name: '', repository: '', relationship: 'dependency' })">Add project</v-btn>
          <v-btn :disabled="!state.canEdit || saving || stale || (!changed && state.exists)" color="primary" variant="flat" @click="save">{{ saving ? 'Saving…' : 'Save connected projects' }}</v-btn>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { CONNECTED_PACKAGE_TYPES, connectedPackageTypeUsesScript } from "@local/vibe64-genesis/shared/connectedPackageTypes";
import { CONNECTED_PROJECTS_LIMIT } from "@local/vibe64-project/shared/contracts";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

const props = defineProps({ projectSlug: { type: String, required: true }, state: { type: Object, default: () => ({}) } });
const emit = defineEmits(["saved"]);
const draft = ref([]);
const baseline = ref("[]");
const revision = ref("");
const saving = ref(false);
const changed = computed(() => JSON.stringify(draft.value) !== baseline.value);
const stale = computed(() => props.state.available && revision.value !== props.state.revision);
const relationships = [
  { label: "Dependency — a library or tool", value: "dependency" },
  { label: "Composition — source assembled into this project", value: "composition" }
];
const packageTypes = [{ label: "Stack default", value: "" }, ...CONNECTED_PACKAGE_TYPES];
// An inherited Stack default may be custom, so only an explicit ecosystem type
// excludes the per-connection script.
function scriptAllowed(entry) {
  return !entry.type || connectedPackageTypeUsesScript(entry.type);
}
function setPackageType(entry, value) {
  if (value) entry.type = value;
  else delete entry.type;
  if (!scriptAllowed(entry)) delete entry.script;
}
function setScript(entry, value) {
  if (value) entry.script = value;
  else delete entry.script;
}
function resetDraft() {
  draft.value = (props.state.projects || []).map((entry) => ({ ...entry }));
  baseline.value = JSON.stringify(draft.value);
  revision.value = props.state.revision || "";
}
let sourceIdentity = "";
watch(() => [props.projectSlug, props.state], () => {
  if (!props.state.source) return;
  const identity = JSON.stringify([props.projectSlug, props.state.source]);
  if (identity !== sourceIdentity || !changed.value) resetDraft();
  sourceIdentity = identity;
}, { immediate: true });

const saveCommand = useCommand({
  access: "never", apiSuffix: "/vibe64/settings/connections",
  buildCommandOptions: () => ({ method: "PUT", path: scopedDevelopmentApiUrl("/api/vibe64/settings/connections", props.projectSlug) }),
  buildRawPayload: (_model, { context }) => context,
  fallbackRunError: "Connected projects could not be saved.",
  messages: { error: "Connected projects could not be saved.", success: "Connected projects saved in source." },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, placementSource: "vibe64.project.connections.save",
  surfaceId: VIBE64_SURFACE_ID, writeMethod: "PUT"
});
async function save() {
  if (saving.value || stale.value || !props.state.canEdit) return;
  saving.value = true;
  try {
    const result = await saveCommand.run({ projects: draft.value.map((entry) => ({ ...entry })), revision: revision.value,
      sessionId: props.state.source?.sessionId || "" });
    if (!result) return;
    baseline.value = JSON.stringify(draft.value);
    emit("saved");
  } catch { /* Shared command feedback presents the failure; preserve the draft. */ }
  finally { saving.value = false; }
}
</script>

<style scoped>
.project-settings__section-copy, .project-settings__content { display: grid; gap: 1rem; min-width: 0; }
.project-settings__section-copy { align-content: start; gap: 0.5rem; }
.project-settings__section-copy p, .project-settings__content p { margin: 0; overflow-wrap: anywhere; }
.connection-entry { border: 0; padding: 0; margin: 1rem 0; display: grid; gap: 0.75rem; min-width: 0; }
.connection-entry legend { margin-bottom: 0.75rem; }
.connection-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }
</style>
