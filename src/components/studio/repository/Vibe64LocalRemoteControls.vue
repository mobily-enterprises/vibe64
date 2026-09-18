<template>
  <v-sheet v-if="project.repositoryMode === 'local_source'" border rounded="lg" class="local-remotes pa-2 mb-2">
    <v-skeleton-loader v-if="!state && busy" type="text, actions" aria-label="Loading Git remote status" />
    <template v-else>
      <div class="local-remotes__status" role="status" aria-live="polite">
        <strong>{{ state?.branch || 'No branch checked out' }}</strong>
        <span v-if="state?.upstream">Pull: {{ destination(state.upstream) }}</span>
        <span v-if="state?.push">Push: {{ destination(state.push) }}</span>
        <span>{{ counts }}</span>
        <span v-if="state?.checkedAt" class="text-body-small">Checked {{ new Date(state.checkedAt).toLocaleTimeString() }}</span>
        <span v-if="error || state?.error" class="text-error">{{ error || state.error }}</span>
      </div>
      <div class="local-remotes__actions">
        <v-btn size="small" variant="text" :disabled="isBusy" @click="refresh(false)">
          {{ busy === 'fetch' ? 'Fetching…' : 'Fetch' }}
        </v-btn>
        <v-btn size="small" variant="tonal" :disabled="isBusy || !state?.upstream || state?.incoming === null || state?.incoming === 0" @click="review('pull')">Pull</v-btn>
        <v-btn size="small" variant="tonal" :disabled="isBusy || !state?.push || state?.outgoing === null || state?.outgoing === 0" @click="review('push')">Push</v-btn>
        <v-btn size="small" variant="text" :disabled="isBusy || !state?.branch" @click="openSettings">Remote settings</v-btn>
      </div>
    </template>

    <v-dialog v-model="settingsOpen" max-width="560" :persistent="isBusy">
      <v-card>
        <v-card-title>Remotes for {{ state?.branch }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-3">
          <p>These settings are saved in this repository’s Git configuration and also apply in your terminal.</p>
          <p v-if="!state?.remotes?.length">No remotes configured. Add one with <code>git remote add</code> in the project folder, then Fetch.</p>
          <v-select v-model="settings.remote" :items="state?.remotes || []" item-title="name" item-value="name" label="Pull remote" :disabled="isBusy" />
          <v-text-field v-model="settings.branch" label="Pull branch" :disabled="isBusy" />
          <v-select v-model="settings.pushRemote" :items="state?.remotes || []" item-title="name" item-value="name" label="Push remote" :disabled="isBusy" />
          <v-text-field v-model="settings.pushBranch" label="Push branch" :disabled="isBusy" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="isBusy" @click="settingsOpen = false">Cancel</v-btn>
          <v-btn :disabled="isBusy || !settings.remote || !settings.branch || !settings.pushRemote || !settings.pushBranch" @click="saveSettings">{{ busy ? 'Saving…' : 'Save settings' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(pendingReview)" max-width="560" :persistent="isBusy" @update:model-value="!$event && (pendingReview = null)">
      <v-card v-if="pendingReview">
        <v-card-title>{{ pendingReview.action === 'push' ? 'Push saved work' : 'Pull remote changes' }}</v-card-title>
        <v-card-text>
          <p>{{ pendingReview.action === 'push' ? 'Push to' : 'Pull from' }} <strong>{{ destination(pendingReview.target) }}</strong></p>
          <p class="local-remotes__url">{{ pendingReview.target.url }}</p>
          <p v-if="pendingReview.action === 'push'">Publishes {{ pendingReview.count }} outgoing commits from the local project. Unsaved session work is not included.</p>
          <p v-else-if="pendingReview.merge">Local and remote history have both advanced. Merge the remote changes into the local project, preserving both histories. Conflicts stop the operation for review.</p>
          <p v-else>Update the local project folder. Your sessions keep their work and can then use Update this session.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="isBusy" @click="pendingReview = null">Cancel</v-btn>
          <v-btn :disabled="isBusy" @click="confirmOperation">{{ busy ? 'Working…' : pendingReview.action === 'push' ? 'Push saved work' : pendingReview.merge ? 'Merge remote changes' : 'Pull changes' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-sheet>
</template>

<script setup>
import { computed, onMounted, onScopeDispose, reactive, ref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { scopedDevelopmentApiUrl, studioApiPath } from "@/lib/studioUrls.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";

const props = defineProps({ project: { type: Object, required: true } });
const state = ref(null);
const busy = ref("");
const error = ref("");
const isBusy = computed(() => Boolean(busy.value));
const settingsOpen = ref(false);
const settings = reactive({ remote: "", branch: "", pushRemote: "", pushBranch: "" });
const settingsReview = ref(null);
const pendingReview = ref(null);
const feedback = useUiFeedback({ source: "vibe64.repository.remote" });
const endpoint = computed(() => scopedDevelopmentApiUrl(studioApiPath("vibe64/repository/remote"), props.project.slug));
let generation = 0;
let timer;
const counts = computed(() => {
  if (!state.value) return "Remote status unavailable";
  if (!state.value.upstream && !state.value.push) return "Choose remotes to check incoming and outgoing work";
  return `${state.value.incoming ?? '?'} incoming · ${state.value.outgoing ?? '?'} outgoing`;
});
function destination(target) { return `${target.remote}/${target.branch}`; }
function snapshot(value) { return JSON.parse(JSON.stringify(value)); }

async function request(body) {
  const result = await getHttpWebClient().request(endpoint.value, { method: "POST", body });
  if (result?.ok === false) throw new Error(vibe64ApiResponseError(result, "The Git operation failed."));
  return result;
}
async function refresh(background = true) {
  if (busy.value || settingsOpen.value || pendingReview.value || document.hidden || props.project.repositoryMode !== "local_source") return;
  const current = generation;
  busy.value = "fetch";
  try {
    const result = await request({ action: "fetch", background });
    if (current !== generation) return;
    state.value = result;
    error.value = "";
  } catch (cause) {
    if (current === generation) {
      error.value = cause.message;
      if (!background) feedback.error(cause, "Could not fetch remote changes.");
    }
  } finally {
    if (current === generation) busy.value = "";
  }
}
function review(action) {
  const current = state.value;
  pendingReview.value = {
    action, review: snapshot(current.review), target: snapshot(action === "push" ? current.push : current.upstream),
    count: current.outgoing, merge: action === "pull" && current.incoming > 0 && current.localAhead > 0
  };
}
function openSettings() {
  settingsReview.value = snapshot(state.value.review);
  const onlyRemote = state.value.remotes.length === 1 ? state.value.remotes[0].name : "";
  Object.assign(settings, {
    remote: state.value.upstream?.remote || onlyRemote,
    branch: state.value.upstream?.branch || state.value.branch,
    pushRemote: state.value.push?.remote || onlyRemote,
    pushBranch: state.value.push?.branch || state.value.branch
  });
  settingsOpen.value = true;
}
async function execute(body) {
  if (busy.value) return;
  const current = generation;
  busy.value = body.action;
  try {
    const result = await request(body);
    if (current !== generation) return;
    state.value = result;
    settingsOpen.value = false;
    pendingReview.value = null;
    error.value = "";
  } catch (cause) {
    if (current === generation) feedback.error(cause, "The Git operation could not finish.");
  } finally {
    if (current === generation) busy.value = "";
  }
}
async function saveSettings() {
  await execute({ action: "configure", review: settingsReview.value, settings: { ...settings } });
  if (!settingsOpen.value) await refresh(false);
}
function confirmOperation() {
  const pending = pendingReview.value;
  return execute({ action: pending.action, review: pending.review, merge: pending.merge });
}
watch(endpoint, () => {
  generation += 1;
  state.value = null;
  busy.value = "";
  error.value = "";
  pendingReview.value = null;
  settingsOpen.value = false;
  void refresh();
}, { immediate: true });
const onVisible = () => { if (!document.hidden) void refresh(); };
onMounted(() => {
  timer = setInterval(onVisible, 60_000);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
});
onScopeDispose(() => {
  generation += 1;
  clearInterval(timer);
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
});
</script>

<style scoped>
.local-remotes { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.local-remotes__status { display: flex; flex: 1 1 20rem; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; min-width: 0; font-size: 0.8rem; overflow-wrap: anywhere; }
.local-remotes__actions { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.local-remotes__url { overflow-wrap: anywhere; }
</style>
