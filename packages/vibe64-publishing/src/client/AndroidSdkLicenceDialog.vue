<script setup>
// Google's Android SDK licence, shown in full before Vibe64 downloads the SDK.
// The person's acceptance is recorded on this computer with the licence hash.
import { computed, ref, watch } from "vue";
import { mdiAndroid, mdiDownload, mdiOpenInNew } from "@mdi/js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, default: null },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue"]);

const licence = ref(null);
const agreed = ref(false);
const busy = ref(false);
const error = ref("");
const accepted = computed(() => {
  const record = props.state?.toolchains?.androidLicence;
  return Boolean(record && licence.value && record.hash === licence.value.hash);
});

watch(() => props.modelValue, async (open) => {
  if (!open) return;
  agreed.value = false;
  error.value = "";
  if (licence.value) return;
  busy.value = true;
  try {
    licence.value = (await props.call("/toolchains/android/licence", { method: "GET", refreshAfter: false })).licence;
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
});

async function install() {
  busy.value = true;
  error.value = "";
  try {
    if (!accepted.value) {
      await props.call("/toolchains/android/licence", { body: { id: licence.value.id, hash: licence.value.hash }, refreshAfter: false });
    }
    await props.call("/toolchains/android");
    emit("update:modelValue", false);
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="680" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card rounded="xl">
      <v-card-title class="publish-dialog__title"><v-icon :icon="mdiAndroid" class="mr-2" color="success" />Android build tools</v-card-title>
      <v-card-text class="publish-licence">
        <p class="publish-licence__lead">
          Vibe64 downloads Java 21 and Google's Android SDK (about 1.9 GB, once) into your user cache. Google requires you to accept its licence first.
        </p>
        <v-skeleton-loader v-if="busy && !licence" type="paragraph, paragraph" />
        <template v-else-if="licence">
          <div class="publish-licence__meta">
            <span>{{ licence.id }}</span>
            <a :href="licence.termsUrl" rel="noopener" target="_blank">Google's terms <v-icon :icon="mdiOpenInNew" size="14" /></a>
          </div>
          <pre class="publish-licence__text" tabindex="0">{{ licence.text }}</pre>
          <p class="publish-licence__packages">Downloads: {{ licence.packages.join(", ") }}</p>
          <v-checkbox v-if="!accepted" v-model="agreed" density="compact" hide-details label="I have read and accept the Android Software Development Kit License Agreement." />
          <v-alert v-else color="success" density="compact" variant="tonal">You accepted this licence on this computer.</v-alert>
        </template>
        <v-alert v-if="error" class="mt-3" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-spacer />
        <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn :disabled="!licence || !(accepted || agreed)" :loading="busy && Boolean(licence)" :prepend-icon="mdiDownload" color="primary" rounded="pill" variant="flat" @click="install">
          {{ accepted ? "Download tools" : "Accept and download" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-licence {
  display: grid;
  gap: 10px;
}

.publish-licence__lead,
.publish-licence__packages {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.publish-licence__packages {
  font-size: 0.8125rem;
}

.publish-licence__meta {
  align-items: center;
  display: flex;
  font: var(--v64-type-label-lg);
  justify-content: space-between;
}

.publish-licence__meta a {
  color: rgb(var(--v-theme-primary));
}

.publish-licence__text {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-md, 12px);
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.5;
  max-height: 18rem;
  overflow: auto;
  padding: 12px 14px;
  white-space: pre-wrap;
}
</style>
