<script setup>
// Install on my phone: a signed APK from a QR code. The card walks through the
// three one-time tasks (Android tools, install key, recovery kit) in order.
import { computed } from "vue";
import { mdiCheckCircle, mdiCircleOutline, mdiProgressClock, mdiQrcode } from "@mdi/js";
import TargetCard from "./TargetCard.vue";

const props = defineProps({
  target: { type: Object, required: true },
  toolchains: { type: Object, default: () => ({}) },
  keys: { type: Object, default: () => ({}) },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(["remove", "change-account", "setup-tools", "create-key", "recovery-kit", "install"]);

const keyEntry = computed(() => (props.keys.entries || []).find((entry) => entry.id === `android-sideload:${props.target.package}`) || null);
const kitCovers = computed(() => Boolean(keyEntry.value && props.keys.recoveryKit?.createdAt &&
  Date.parse(props.keys.recoveryKit.createdAt) >= Date.parse(keyEntry.value.createdAt)));
const installing = computed(() => props.toolchains.install?.status === "running");
const toolsReady = computed(() => Boolean(props.toolchains.java?.ready && props.toolchains.androidSdk?.ready));
const tasks = computed(() => [
  {
    id: "tools",
    done: toolsReady.value,
    running: installing.value,
    title: "Android build tools",
    detail: installing.value
      ? (props.toolchains.install?.message || "Downloading Java and the Android SDK…")
      : toolsReady.value ? "Java and the Android SDK are ready." : "A one-time 1.9 GB download after you accept Google's licence.",
    action: "Set up", event: "setup-tools"
  },
  {
    id: "key",
    done: Boolean(keyEntry.value && props.target.settings?.certificateSha256),
    title: "Install key",
    detail: keyEntry.value ? "Signs every version so your phone accepts updates." : "Vibe64 makes it and keeps it in your publishing keys.",
    action: "Create", event: "create-key", needs: toolsReady.value ? "" : "Set up the tools first"
  },
  {
    id: "kit",
    done: kitCovers.value,
    title: "Recovery kit",
    detail: kitCovers.value ? "Your kit holds this key." : "Without it, a lost key means reinstalling the app.",
    action: "Save kit", event: "recovery-kit", needs: keyEntry.value ? "" : "Create the key first"
  }
]);
const ready = computed(() => tasks.value.every((task) => task.done));
</script>

<template>
  <TargetCard v-bind="$attrs" :busy="busy" :target="target" @change-account="emit('change-account', $event)" @remove="emit('remove')">
    <template #facts>
      <div v-if="target.settings?.certificateSha256">
        <dt>Key</dt>
        <dd class="publish-target__mono" :title="target.settings.certificateSha256">{{ target.settings.certificateSha256.slice(0, 23) }}…</dd>
      </div>
      <div v-if="target.latest?.proof?.size"><dt>Size</dt><dd>{{ (target.latest.proof.size / 1048576).toFixed(1) }} MB</dd></div>
    </template>

    <template v-if="!ready" #setup>
      <ol class="publish-android-tasks" aria-label="One-time setup">
        <li v-for="task in tasks" :key="task.id" :class="{ 'is-done': task.done }">
          <v-icon
            :color="task.done ? 'success' : task.running ? 'primary' : undefined"
            :icon="task.done ? mdiCheckCircle : task.running ? mdiProgressClock : mdiCircleOutline"
            size="20"
          />
          <div>
            <strong>{{ task.title }}</strong>
            <span>{{ task.detail }}</span>
            <v-progress-linear v-if="task.running" class="mt-1" color="primary" indeterminate rounded />
          </div>
          <v-btn
            v-if="!task.done && !task.running"
            :disabled="busy || Boolean(task.needs)"
            :title="task.needs || undefined"
            rounded="pill"
            size="small"
            variant="tonal"
            @click="emit(task.event)"
          >
            {{ task.action }}
          </v-btn>
        </li>
      </ol>
    </template>

    <template v-if="target.latest?.downloadable" #actions>
      <v-btn :prepend-icon="mdiQrcode" color="success" rounded="pill" variant="flat" @click="emit('install')">Install on phone</v-btn>
    </template>
  </TargetCard>
</template>

<style scoped>
.publish-android-tasks {
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-md, 12px);
  display: grid;
  list-style: none;
  margin: 0;
  padding: 4px 0;
}

.publish-android-tasks li {
  align-items: center;
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-columns: 20px minmax(0, 1fr) auto;
  padding: 8px 12px;
}

.publish-android-tasks li + li {
  border-top: 1px solid var(--v64-outline-variant);
}

.publish-android-tasks strong {
  display: block;
  font: var(--v64-type-label-lg);
}

.publish-android-tasks span {
  color: var(--v64-on-surface-variant);
  display: block;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-android-tasks li.is-done strong {
  color: var(--v64-on-surface-variant);
}
</style>
