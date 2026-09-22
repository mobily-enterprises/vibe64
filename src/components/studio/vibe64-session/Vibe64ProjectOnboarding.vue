<template>
  <div class="project-preview">
    <v-alert
      v-if="!props.archived && (loadError || state === 'attention')"
      class="project-preview__warning"
      color="warning-container"
      density="compact"
      role="status"
      type="warning"
      variant="flat"
    >
      <strong>{{ loadError ? 'Project setup could not be read' : 'Project setup needs attention' }}</strong>
      <p v-if="loadError">{{ loadError }}</p>
      <template v-else>
        <p v-for="(diagnostic, index) in onboarding.inspection.diagnostics" :key="index">{{ diagnostic.message }}</p>
        <p v-if="onboarding.inspection.nextAction === 'update-genesis'">Use an installation with a newer Genesis version to update setup.</p>
      </template>
      <div class="project-preview__warning-actions">
        <v-btn :disabled="!enabled || resource.isFetching.value" size="small" variant="text" @click="resource.reload()">
          {{ resource.isFetching.value ? 'Checking setup…' : 'Recheck setup' }}
        </v-btn>
        <Vibe64TemporaryAiFixAction
          :disabled="askDisabled"
          :pending="asking"
          title="Open Temporary AI to resolve project setup"
          @click="ask('repair')"
        />
      </div>
    </v-alert>
    <v-alert
      v-if="!props.archived && (environmentSetup?.missingKeys.length || environmentSetup?.warning)"
      class="project-preview__warning"
      color="warning-container"
      density="compact"
      role="status"
      type="warning"
      variant="flat"
    >
      <h2 class="text-title-medium">Set up your project's environment</h2>
      <p v-if="environmentSetup.warning">{{ environmentSetup.warning }}</p>
      <template v-if="environmentSetup.missingKeys.length">
        <p>This project requires environment values. Add them in Env, then recheck setup.</p>
        <details>
          <summary>Required configuration</summary>
          <ul>
            <li v-for="key in environmentSetup.missingKeys" :key="key"><code>{{ key }}</code></li>
          </ul>
        </details>
      </template>
      <div class="project-preview__warning-actions">
        <v-btn :to="projectAppPath(projectSlug, '/dashboard/env')" size="small" variant="flat" color="primary">Open Env</v-btn>
        <v-btn :disabled="!enabled || resource.isFetching.value" size="small" variant="text" @click="resource.reload()">
          {{ resource.isFetching.value ? 'Checking setup…' : 'Recheck setup' }}
        </v-btn>
      </div>
    </v-alert>
    <div v-if="showPreview" class="project-preview__output">
      <slot />
    </div>
    <section v-else class="project-onboarding" aria-label="Project setup" :aria-busy="pending">
      <v-skeleton-loader v-if="!onboarding" type="heading, paragraph, card" />
      <template v-else-if="state === 'new'">
        <p class="project-onboarding__eyebrow">Your starting point</p>
        <h2>What would you like to build with?</h2>
        <p>Choose a ready-made app, or describe your idea in the conversation.</p>
        <div v-for="group in groups" :key="group.technology" class="project-onboarding__group">
          <h3>{{ technologyLabel(group.technology) }}</h3>
          <div class="project-onboarding__choices">
            <button
              v-for="template in group.templates"
              :key="template.id"
              type="button"
              class="project-onboarding__choice"
              :disabled="starterDisabled"
              @click="apply(template)"
            >
              <strong>{{ template.name }}</strong>
              <span>{{ template.description }}</span>
              <small v-if="groupsHaveMultipleSources">Source: {{ template.namespace }}</small>
              <span class="project-onboarding__choose">{{ applying === template.id ? 'Preparing your starter…' : 'Use this starter →' }}</span>
            </button>
          </div>
        </div>
        <p v-if="!groups.length">No starters are configured for this installation yet.</p>
        <v-btn :disabled="askDisabled" variant="text" @click="ask('create')">Start through conversation</v-btn>
      </template>
      <template v-else-if="state === 'adoption'">
        <p class="project-onboarding__eyebrow">Bring your project</p>
        <h2>Set up this existing project</h2>
        <p>Tell the AI what this project does and what you want to run. It will work out the setup from your code and preserve your source and Git history.</p>
        <v-textarea
          v-model="purpose"
          label="What is this project?"
          placeholder="For example: a Python tool that processes invoices. I want to run its command line."
          rows="3"
          auto-grow
          :disabled="askDisabled"
        />
        <div class="project-onboarding__actions">
          <v-btn :disabled="askDisabled || !purpose.trim()" color="primary" @click="ask('adopt')">Set up project</v-btn>
          <v-btn :disabled="askDisabled" variant="text" @click="ask('inspect')">Inspect it for me</v-btn>
        </div>
      </template>
      <p v-if="pending" role="status">{{ applying ? 'Adding the starter to this session…' : 'Opening Temporary AI…' }}</p>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";

const props = defineProps({
  active: Boolean,
  archived: Boolean,
  busy: Boolean,
  canAsk: Boolean,
  requestTemporaryAi: { type: Function, required: true },
  sessionId: { type: String, required: true }
});
const projectSlug = useVibe64ProjectSlug();
const purpose = ref("");
const applying = ref("");
const asking = ref(false);
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const enabled = computed(() => props.active && !props.archived && Boolean(props.sessionId));
const resource = useEndpointResource({
  enabled,
  path: computed(() => resolveStudioRequestUrl("/api/vibe64/onboarding")),
  readQuery: computed(() => ({ sessionId: props.sessionId })),
  queryKey: computed(() => ["vibe64", "project-onboarding", projectSlug.value, props.sessionId]),
  queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: true },
  realtime: {
    events: ["vibe64.project.changed"],
    matches: ({ payload = {} } = {}) => !payload.projectSlug || payload.projectSlug === projectSlug.value
  },
  refreshOnPull: true,
  fallbackLoadError: "Project setup could not be read."
});
const command = useCommand({
  access: "never",
  apiSuffix: "vibe64",
  buildCommandOptions: () => ({ method: "POST", path: resolveStudioRequestUrl("/api/vibe64/templates/apply") }),
  buildRawPayload: (_model, { context }) => ({ sessionId: context.sessionId, templateId: context.templateId }),
  fallbackRunError: "The starter could not be applied. Your existing work was preserved.",
  messages: { success: "Starter added to this session. Use Save to keep it in the project.", error: "The starter could not be applied." },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.project.templates.apply",
  surfaceId: "app",
  writeMethod: "POST"
});
const onboarding = computed(() => resource.data.value?.ok === true ? resource.data.value : null);
const state = computed(() => onboarding.value?.inspection?.state || "");
const environmentSetup = computed(() => onboarding.value?.environmentSetup);
const loadError = computed(() => vibe64ResourceResponseError(resource.data.value) || resource.loadError.value);
const showPreview = computed(() => {
  if (props.archived || onboarding.value?.available === false || loadError.value) return true;
  return onboarding.value !== null && state.value !== "new" && state.value !== "adoption";
});
const pending = computed(() => Boolean(applying.value || asking.value));
const starterDisabled = computed(() => pending.value || props.busy || !enabled.value);
const askDisabled = computed(() => pending.value || !enabled.value || !props.canAsk);
const groups = computed(() => {
  const grouped = new Map();
  for (const template of onboarding.value?.templates || []) {
    if (!grouped.has(template.technology)) grouped.set(template.technology, []);
    grouped.get(template.technology).push(template);
  }
  return [...grouped].map(([technology, templates]) => ({ technology, templates }));
});
const groupsHaveMultipleSources = computed(() => new Set((onboarding.value?.templates || []).map(({ namespace }) => namespace)).size > 1);

function technologyLabel(technology) {
  return technology === "jskit" ? "JSKIT" : technology;
}

async function apply(template) {
  if (starterDisabled.value) return;
  const sessionId = props.sessionId;
  applying.value = template.id;
  try {
    try {
      await command.run({ sessionId, templateId: template.id });
    } catch {
      // The command already reports this failure through shared action feedback.
      return;
    }
    if (disposed || props.sessionId !== sessionId || !enabled.value) return;
    await resource.reload();
  } finally {
    applying.value = "";
  }
}

async function ask(kind) {
  if (askDisabled.value) return;
  const inspection = onboarding.value?.inspection;
  const diagnostic = loadError.value || inspection?.diagnostics.map(({ message }) => message).join(" ");
  const requests = {
    create: {
      title: "Start this project",
      message: "Help me start this project through conversation. Ask what I want to build, use answers I have already given, and help me choose a suitable Stack. I have not selected a starter."
    },
    adopt: {
      title: "Set up this project",
      message: `Set up this existing project for guided editing. What this project is and what I want to run: ${purpose.value.trim()}. Inspect its current implementation and work backwards into Genesis Blueprint, Stack, and Program, including its actual setup and run outputs. Preserve its source and Git history.`
    },
    inspect: {
      title: "Inspect project setup",
      message: "Set up this existing project for guided editing. Inspect it for me to identify what it does and its run targets. Ask me only where the evidence is ambiguous. Work backwards into Genesis Blueprint, Stack, and Program while preserving the implementation and Git history."
    },
    repair: {
      title: "Fix project setup",
      message: `Inspect and update this project's Genesis setup. The opening inspection reports: ${diagnostic}. ` +
        (inspection?.nextAction === "update-genesis" ? "The project requires a newer Genesis installation; do not downgrade its source format. " : "") +
        "Use the appropriate migration or repair, preserve source and Git history, and explain the specific change."
    }
  };
  const { title, message } = requests[kind];
  asking.value = true;
  try {
    await props.requestTemporaryAi({
      title,
      displayMessage: kind === "adopt" ? `${title}: ${purpose.value.trim()}` : `${title}.`,
      message,
      nextStepMessage: "Recheck setup after the AI finishes. Project edits remain in this session for review and Save."
    });
  } finally {
    asking.value = false;
  }
}

watch(() => props.sessionId, () => { purpose.value = ""; });
watch(() => props.busy, (busy, previous) => {
  if (previous && !busy && enabled.value) void resource.reload();
});
</script>

<style scoped>
.project-preview { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
.project-preview__output { flex: 1; min-height: 0; }
.project-preview__warning { flex: 0 0 auto; max-height: 35%; overflow-y: auto; overflow-wrap: anywhere; }
.project-preview__warning p { margin: .25rem 0; }
.project-preview__warning-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .5rem; margin-top: .25rem; }
.project-preview__warning-actions button:disabled { opacity: .6; }
.project-onboarding { width: min(100%, 52rem); margin: auto; padding: clamp(1rem, 3vw, 2.5rem); overflow-y: auto; }
.project-onboarding h2 { font-size: 1.6rem; line-height: 1.25; margin-bottom: 1rem; }
.project-onboarding p { margin-bottom: 1.25rem; line-height: 1.6; }
.project-onboarding__eyebrow { font-size: .8rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; opacity: .65; }
.project-onboarding__group { margin-block: 1.5rem; }
.project-onboarding__group h3 { margin-bottom: .75rem; }
.project-onboarding__choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: 1rem; }
.project-onboarding__choice { display: flex; flex-direction: column; gap: .7rem; text-align: left; padding: 1.25rem; border: 1px solid rgba(var(--v-theme-on-surface), .16); border-radius: 1rem; background: rgb(var(--v-theme-surface)); color: inherit; }
.project-onboarding__choice:not(:disabled):hover { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), .05); }
.project-onboarding__choice:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
.project-onboarding__choice:disabled { opacity: .55; }
.project-onboarding__choice span { font-size: .9rem; line-height: 1.5; }
.project-onboarding__choose { margin-top: auto; padding-top: .5rem; color: rgb(var(--v-theme-primary)); font-weight: 600; }
.project-onboarding__actions { display: flex; flex-wrap: wrap; gap: .75rem; }
</style>
