<script setup>
// The recovery kit: every publishing key in one age file under its own
// passphrase, downloaded to keep off this computer, and restored from here.
import { computed, ref, watch } from "vue";
import { mdiDownload, mdiLifebuoy, mdiUpload } from "@mdi/js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, default: null },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue"]);

const tab = ref("save");
const passphrase = ref("");
const repeat = ref("");
const file = ref(null);
const busy = ref(false);
const error = ref("");
const done = ref("");
const unlocked = computed(() => Boolean(props.state?.keys?.unlocked));
const count = computed(() => (props.state?.keys?.entries || []).length);

watch(() => props.modelValue, (open) => {
  if (!open) return;
  tab.value = "save";
  passphrase.value = repeat.value = "";
  file.value = null;
  error.value = done.value = "";
});

function download(base64, fileName) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function asBase64(chosen) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("The kit file could not be read."));
    reader.readAsDataURL(chosen);
  });
}

async function act(work) {
  busy.value = true;
  error.value = "";
  try {
    await work();
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

const save = () => act(async () => {
  if (passphrase.value !== repeat.value) throw new Error("The two passphrases differ.");
  const kit = await props.call("/recovery-kit", { body: { passphrase: passphrase.value } });
  download(kit.data, kit.fileName);
  passphrase.value = repeat.value = "";
  done.value = `${kit.fileName} downloaded. Keep it and its passphrase somewhere safe, apart from this computer.`;
});

const restore = () => act(async () => {
  const chosen = Array.isArray(file.value) ? file.value[0] : file.value;
  if (!chosen) throw new Error("Choose the kit file.");
  const answer = await props.call("/recovery-kit/restore", { body: { data: await asBase64(chosen), passphrase: passphrase.value } });
  passphrase.value = "";
  const restoredCount = answer.restored?.length || 0;
  done.value = `Restored ${restoredCount} ${restoredCount === 1 ? "key" : "keys"}.`;
});
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title class="publish-dialog__title"><v-icon :icon="mdiLifebuoy" class="mr-2" color="primary" />Recovery kit</v-card-title>
      <v-tabs v-model="tab" class="px-4" color="primary" density="compact">
        <v-tab value="save">Save a kit</v-tab>
        <v-tab value="restore">Restore</v-tab>
      </v-tabs>
      <v-card-text class="publish-kit">
        <p class="publish-kit__lead" v-if="tab === 'save'">
          The kit holds all {{ count }} of your publishing keys, encrypted under a passphrase of its own. If this computer is lost, the kit restores them, so phones keep accepting your app's updates.
        </p>
        <p class="publish-kit__lead" v-else>Restore keys from a kit into your publishing keys on this computer.</p>
        <v-alert v-if="!unlocked" class="mb-3" type="info" variant="tonal">Unlock your publishing keys first.</v-alert>
        <v-file-input v-if="tab === 'restore'" v-model="file" :prepend-icon="null" :prepend-inner-icon="mdiUpload" accept=".age" label="Kit file (.age)" variant="outlined" />
        <v-text-field v-model="passphrase" :hint="tab === 'save' ? 'Use a different passphrase from your keys. At least 12 characters.' : ''" autocomplete="new-password" label="Kit passphrase" persistent-hint type="password" variant="outlined" />
        <v-text-field v-if="tab === 'save'" v-model="repeat" autocomplete="new-password" label="Kit passphrase again" type="password" variant="outlined" />
        <v-alert v-if="done" color="success" variant="tonal">{{ done }}</v-alert>
        <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-spacer />
        <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Close</v-btn>
        <v-btn
          v-if="tab === 'save'"
          :disabled="!unlocked || passphrase.length < 12 || !repeat"
          :loading="busy"
          :prepend-icon="mdiDownload"
          color="primary"
          rounded="pill"
          variant="flat"
          @click="save"
        >
          Download kit
        </v-btn>
        <v-btn v-else :disabled="!unlocked || passphrase.length < 12 || !file" :loading="busy" color="primary" rounded="pill" variant="flat" @click="restore">Restore</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-kit {
  display: grid;
  gap: 8px;
}

.publish-kit__lead {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0 0 8px;
}
</style>
