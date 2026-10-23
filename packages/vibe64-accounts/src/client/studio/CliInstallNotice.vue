<template>
  <v-alert v-if="problem" type="warning" variant="tonal" :title="account.title" class="cli-install-notice">
    <p v-if="account.detail" class="ma-0">{{ account.detail }}</p>
    <template v-if="account.install">
      <p class="mt-3 mb-2">
        Open a terminal on this computer, paste this command and press Enter. When it finishes, choose
        <strong>Check again</strong>.
      </p>
      <div class="cli-install-notice__command">
        <code>{{ account.install.command }}</code>
        <v-btn
          :aria-label="`Copy the ${name} install command`" :icon="copied ? mdiCheck : mdiContentCopy"
          size="40" variant="text" @click="copy"
        />
      </div>
      <a class="cli-install-notice__guide" :href="account.install.guideUrl" rel="noopener" target="_blank">
        Other ways to install {{ name }}
      </a>
    </template>
    <details v-if="account.observed" class="cli-install-notice__details">
      <summary>Details</summary>
      <pre>{{ account.observed }}</pre>
    </details>
    <div class="d-flex flex-wrap ga-2 mt-3">
      <v-btn variant="flat" color="warning" :loading="checking" :prepend-icon="mdiRefresh" @click="emit('check')">
        Check again
      </v-btn>
      <slot />
    </div>
  </v-alert>
</template>

<script>
// An AI tool that is missing or did not start; signing in cannot help until it runs.
export function cliProblem(account = {}) {
  return account?.connected !== true && ["not_installed", "unavailable"].includes(account?.status);
}
</script>

<script setup>
// Say which AI tool is missing or did not start, how to fix it, then check again.
import { computed, ref, watch } from "vue";
import { mdiCheck, mdiContentCopy, mdiRefresh } from "@mdi/js";

const props = defineProps({
  // An account or connection status: { label, status, title, detail, install?, observed? }.
  account: { type: Object, default: () => ({}) },
  checking: Boolean
});
const emit = defineEmits(["check"]);

const problem = computed(() => cliProblem(props.account));
const name = computed(() => props.account?.label || "This AI tool");
const copied = ref(false);
watch(() => props.account?.install?.command, () => { copied.value = false; });

async function copy() {
  try {
    await navigator.clipboard.writeText(props.account.install.command);
    copied.value = true;
  } catch {
    copied.value = false;
  }
}
</script>

<style scoped>
.cli-install-notice__command {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 0.5rem;
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.25rem 0.25rem 0.75rem;
}
.cli-install-notice__command code { flex: 1; font-size: 0.8125rem; min-width: 0; overflow-x: auto; white-space: nowrap; }
.cli-install-notice__guide { display: inline-block; font-size: 0.875rem; margin-top: 0.5rem; }
.cli-install-notice__details { color: rgba(var(--v-theme-on-surface), 0.72); font-size: 0.8125rem; margin-top: 0.5rem; }
.cli-install-notice__details summary { cursor: pointer; }
.cli-install-notice__details pre { font-size: 0.75rem; margin-top: 0.25rem; overflow-wrap: anywhere; white-space: pre-wrap; }
</style>
