<template>
  <v-sheet
    v-if="project.repositoryMode === 'local_source'"
    color="transparent"
    class="local-remotes"
    tag="section"
    aria-label="Local Git repository"
  >
    <v-skeleton-loader
      v-if="!state && busy"
      aria-label="Loading Git remote status"
      aria-busy="true"
      type="button"
      :width="xs ? 48 : 112"
      height="32"
    />
    <v-menu
      v-else
      v-model="detailsOpen"
      location="bottom start"
      :close-on-content-click="false"
      width="360"
      max-width="calc(100vw - 32px)"
    >
      <template #activator="{ props: menuProps }">
        <v-badge
          :model-value="Boolean(remoteError) || state?.incoming > 0 || state?.outgoing > 0"
          :content="remoteError ? '!' : (state?.incoming || 0) + (state?.outgoing || 0)"
          :color="remoteError ? 'error' : 'primary'"
          max="99"
          offset-x="5"
          offset-y="5"
        >
          <v-btn
            v-bind="menuProps"
            class="local-remotes__branch"
            variant="tonal"
            rounded="lg"
            height="32"
            :icon="xs"
            :width="xs ? 48 : undefined"
            :prepend-icon="xs ? undefined : mdiSourceBranch"
            :append-icon="xs ? undefined : mdiChevronDown"
            :aria-label="`Git details for ${state?.branch || 'this repository'}. ${syncStatus.label}`"
            :title="`${state?.branch || 'Git details'} · ${syncStatus.label}`"
          >
            <v-icon v-if="xs" :icon="mdiSourceBranch" />
            <span v-else class="local-remotes__branch-name">{{ state?.branch || (state ? 'No branch' : 'Repository') }}</span>
          </v-btn>
        </v-badge>
      </template>
      <v-sheet class="pa-4" rounded="lg" elevation="3">
        <div class="text-label-large mb-2">Local repository</div>
        <div class="local-remotes__status text-body-small mb-3" role="status" aria-live="polite">
          <v-icon :icon="syncStatus.icon" :color="syncStatus.color" size="18" />
          <span>{{ syncStatus.label }}</span>
        </div>
        <div class="d-flex flex-column ga-1">
          <v-btn
            height="48"
            variant="text"
            :prepend-icon="mdiRefresh"
            :aria-label="busy === 'fetch' ? 'Fetching remote changes' : 'Fetch remote changes'"
            :disabled="isBusy"
            @click="refresh(false)"
          >
            {{ busy === 'fetch' ? 'Fetching…' : 'Fetch' }}
          </v-btn>
          <v-btn
            v-if="state?.upstream && state.incoming > 0"
            height="48"
            color="primary"
            variant="flat"
            :prepend-icon="mdiArrowDown"
            :disabled="isBusy || Boolean(remoteError)"
            @click="review('pull')"
          >
            Pull
            <span class="local-remotes__count ms-2">{{ state.incoming }}</span>
          </v-btn>
          <v-btn
            v-if="state?.push && state.outgoing > 0"
            height="48"
            color="primary"
            :variant="state.incoming > 0 ? 'tonal' : 'flat'"
            :prepend-icon="mdiArrowUp"
            :disabled="isBusy || Boolean(remoteError)"
            @click="review('push')"
          >
            Push
            <span class="local-remotes__count ms-2">{{ state.outgoing }}</span>
          </v-btn>
        </div>
        <v-divider class="my-3" />
        <dl class="local-remotes__details text-body-medium">
          <dt>Branch</dt>
          <dd>{{ state?.branch || 'No branch checked out' }}</dd>
          <dt>Pull from</dt>
          <dd>{{ state?.upstream ? destination(state.upstream) : 'Not configured' }}</dd>
          <dt>Push to</dt>
          <dd>{{ state?.push ? destination(state.push) : 'Not configured' }}</dd>
          <dt>Last checked</dt>
          <dd>{{ state?.checkedAt ? new Date(state.checkedAt).toLocaleString() : 'Not checked yet' }}</dd>
        </dl>
        <p v-if="remoteError" class="text-body-medium text-error mt-3 local-remotes__message">{{ remoteError }}</p>
        <p v-else-if="!state?.upstream || !state?.push" class="text-body-small text-medium-emphasis mt-3">
          Set pull and push destinations to track remote changes.
        </p>
        <v-divider class="my-3" />
        <v-btn
          variant="text"
          block
          height="48"
          :prepend-icon="mdiCogOutline"
          :disabled="isBusy || !state?.branch"
          @click="openSettings"
        >
          Remote settings
        </v-btn>
      </v-sheet>
    </v-menu>

    <v-dialog v-model="settingsOpen" max-width="560" :persistent="isBusy">
      <v-card>
        <v-card-title>Remote settings</v-card-title>
        <v-card-text class="d-flex flex-column ga-3">
          <p class="local-remotes__message">Destinations for <strong>{{ state?.branch }}</strong>. Saved in this repository’s Git configuration, including for terminal commands.</p>
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
import { useDisplay } from "vuetify";
import {
  mdiAlertCircleOutline, mdiArrowDown, mdiArrowUp, mdiCheckCircleOutline,
  mdiChevronDown, mdiCogOutline, mdiHelpCircleOutline, mdiLinkVariantOff,
  mdiRefresh, mdiSourceBranch, mdiSwapVertical
} from "@mdi/js";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { scopedDevelopmentApiUrl, studioApiPath } from "@/lib/studioUrls.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";

const props = defineProps({ project: { type: Object, required: true } });
const { xs } = useDisplay();
const state = ref(null);
const busy = ref("");
const error = ref("");
const isBusy = computed(() => Boolean(busy.value));
const detailsOpen = ref(false);
const settingsOpen = ref(false);
const settings = reactive({ remote: "", branch: "", pushRemote: "", pushBranch: "" });
const settingsReview = ref(null);
const pendingReview = ref(null);
const feedback = useUiFeedback({ source: "vibe64.repository.remote" });
const endpoint = computed(() => scopedDevelopmentApiUrl(studioApiPath("vibe64/repository/remote"), props.project.slug));
let generation = 0;
let timer;
const remoteError = computed(() => error.value || state.value?.error || "");
const syncStatus = computed(() => {
  const current = state.value;
  if (remoteError.value) return { label: "Check failed", icon: mdiAlertCircleOutline, color: "error" };
  if (!current) return { label: "Not checked", icon: mdiHelpCircleOutline };
  if (!current.upstream && !current.push) return { label: current.remotes.length ? "Setup needed" : "Local only", icon: mdiLinkVariantOff };
  const changes = [];
  if (current.incoming > 0) changes.push(`${current.incoming} incoming`);
  if (current.outgoing > 0) changes.push(`${current.outgoing} outgoing`);
  if (changes.length) return { label: changes.join(" · "), icon: mdiSwapVertical, color: "primary" };
  if (!current.upstream || !current.push) return { label: "Setup needed", icon: mdiLinkVariantOff };
  if (current.incoming === null || current.outgoing === null) return { label: "Not checked", icon: mdiHelpCircleOutline };
  return { label: "Up to date", icon: mdiCheckCircleOutline, color: "success" };
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
  detailsOpen.value = false;
  const current = state.value;
  pendingReview.value = {
    action, review: snapshot(current.review), target: snapshot(action === "push" ? current.push : current.upstream),
    count: current.outgoing, merge: action === "pull" && current.incoming > 0 && current.localAhead > 0
  };
}
function openSettings() {
  detailsOpen.value = false;
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
  detailsOpen.value = false;
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
.local-remotes { flex: 0 0 auto; min-width: 0; }
.local-remotes__branch { min-width: 0; max-width: 100%; }
.local-remotes__branch-name { display: block; max-width: 8rem; overflow: hidden; text-overflow: ellipsis; }
.local-remotes__status { display: flex; align-items: center; gap: 0.375rem; color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.local-remotes__count { font-variant-numeric: tabular-nums; }
.local-remotes__details { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.75rem 1rem; }
.local-remotes__details dt { color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity)); }
.local-remotes__details dd, .local-remotes__message { margin: 0; overflow-wrap: anywhere; }
.local-remotes__url { overflow-wrap: anywhere; }
</style>
