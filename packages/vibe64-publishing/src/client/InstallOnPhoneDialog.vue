<script setup>
// Install on my phone: this computer shares the one signed APK on the local
// network for ten minutes at an unguessable address; the phone scans the QR.
// Opened on an Android phone itself, the page downloads it directly instead.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { mdiCellphoneArrowDown, mdiDownload, mdiQrcode, mdiWifi } from "@mdi/js";
import { qrSvg } from "@local/vibe64-packaging/shared/qr";
import { apkDownloadUrl } from "./usePublishing.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  releaseId: { type: String, default: "" },
  targetId: { type: String, default: "" },
  title: { type: String, default: "" },
  version: { type: String, default: "" },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue"]);

// On an Android phone the QR would point at the phone itself.
const onThisPhone = typeof navigator !== "undefined" && /Android/iu.test(navigator.userAgent || "");
const showQr = ref(!onThisPhone);
const share = ref(null);
const busy = ref(false);
const error = ref("");
const left = ref(0);
let timer = null;

const qr = computed(() => share.value?.url ? qrSvg(share.value.url, { level: "M", margin: 2, title: "QR code that downloads the app" }) : "");
const minutes = computed(() => `${Math.floor(left.value / 60)}:${String(left.value % 60).padStart(2, "0")}`);

function tick() {
  left.value = Math.max(0, Math.round((Date.parse(share.value?.expiresAt || "") - Date.now()) / 1000));
  if (!left.value && share.value) share.value = null;
}

async function start() {
  busy.value = true;
  error.value = "";
  try {
    share.value = (await props.call("/share", { body: { releaseId: props.releaseId, targetId: props.targetId }, refreshAfter: false })).share;
    tick();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = false;
  }
}

async function stop() {
  clearInterval(timer);
  if (share.value) await props.call("/share", { method: "DELETE", refreshAfter: false }).catch(() => {});
  share.value = null;
}

watch(() => props.modelValue, (open) => (open ? (showQr.value ? start() : null) : stop()));
function revealQr() {
  showQr.value = true;
  void start();
}
onBeforeUnmount(stop);
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="publish-install" rounded="xl">
      <v-card-title class="publish-dialog__title publish-install__title">
        <span class="publish-install__badge"><v-icon :icon="mdiCellphoneArrowDown" size="22" /></span>
        <span>
          {{ title ? `Install ${title}` : "Install on your phone" }}
          <small v-if="version">Version {{ version }} · signed with your install key</small>
        </span>
      </v-card-title>
      <v-card-text>
        <div v-if="onThisPhone" class="publish-install__here">
          <v-btn :href="apkDownloadUrl(releaseId, targetId)" :prepend-icon="mdiDownload" block color="success" rounded="pill" size="large" variant="flat">
            Download {{ title || "the app" }}
          </v-btn>
          <ol class="publish-install__steps">
            <li><strong>Download</strong> it here. Android asks once to allow installs from your browser.</li>
            <li><strong>Install.</strong> Later versions install over it and keep its data.</li>
          </ol>
          <v-btn v-if="!showQr" :prepend-icon="mdiQrcode" rounded="pill" variant="text" @click="revealQr">Show a QR code for another phone</v-btn>
        </div>
        <div v-if="showQr" class="publish-install__layout">
          <div class="publish-install__qr" :class="{ 'is-waiting': !qr }">
            <!-- eslint-disable-next-line vue/no-v-html -- qrSvg escapes its only text -->
            <div v-if="qr" class="publish-install__code" v-html="qr" />
            <v-progress-circular v-else-if="busy" color="primary" indeterminate />
            <v-btn v-else :prepend-icon="mdiWifi" rounded="pill" variant="tonal" @click="start">Share again</v-btn>
          </div>
          <ol class="publish-install__steps">
            <li><strong>Scan</strong> with your Android phone's camera, on the same Wi-Fi as this computer.</li>
            <li><strong>Download</strong> {{ title || "the app" }}. Android asks once to allow installs from your browser.</li>
            <li><strong>Install.</strong> Later versions install over it and keep its data.</li>
          </ol>
        </div>
        <p v-if="share && showQr" class="publish-install__expiry">
          <v-icon :icon="mdiWifi" size="16" /> Shared on your network for {{ minutes }}. Closing this stops it.
        </p>
        <v-alert v-if="error" class="mt-3" type="warning" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-btn v-if="!onThisPhone" :href="apkDownloadUrl(releaseId, targetId)" :prepend-icon="mdiDownload" rounded="pill" variant="text">Download APK</v-btn>
        <v-spacer />
        <v-btn color="primary" rounded="pill" variant="flat" @click="emit('update:modelValue', false)">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-install__layout {
  align-items: center;
  display: grid;
  gap: 20px;
  grid-template-columns: 200px minmax(0, 1fr);
}

.publish-install__qr {
  align-items: center;
  aspect-ratio: 1;
  background: #fff;
  border-radius: var(--v64-shape-lg, 16px);
  box-shadow: 0 0 0 1px var(--v64-outline-variant), var(--v64-elevation-1);
  display: flex;
  justify-content: center;
  padding: 10px;
}

.publish-install__qr.is-waiting {
  background: var(--v64-surface-container-low);
}

.publish-install__code,
.publish-install__code :deep(svg) {
  display: block;
  height: 100%;
  width: 100%;
}

.publish-install__title {
  align-items: center;
  gap: 12px !important;
}

.publish-install__title small {
  color: var(--v64-on-surface-variant);
  display: block;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-install__badge {
  align-items: center;
  background: var(--v64-success-container);
  border-radius: var(--v64-shape-md, 12px);
  color: rgb(var(--v-theme-success));
  display: inline-flex;
  flex: 0 0 auto;
  height: 40px;
  justify-content: center;
  width: 40px;
}

.publish-install__here {
  display: grid;
  gap: 16px;
  justify-items: start;
  margin-bottom: 8px;
}

.publish-install__here .v-btn--block {
  justify-self: stretch;
}

.publish-install__steps {
  counter-reset: step;
  display: grid;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.publish-install__steps li {
  color: var(--v64-on-surface-variant);
  counter-increment: step;
  font: var(--v64-type-body-md);
  padding-left: 34px;
  position: relative;
}

.publish-install__steps li::before {
  align-items: center;
  background: var(--v64-success-container);
  border-radius: 50%;
  color: rgb(var(--v-theme-success));
  content: counter(step);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  height: 24px;
  justify-content: center;
  left: 0;
  position: absolute;
  top: -1px;
  width: 24px;
}

.publish-install__steps strong {
  color: var(--v64-on-surface);
}

.publish-install__expiry {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  gap: 6px;
  margin: 16px 0 0;
}

@media (max-width: 520px) {
  .publish-install__layout {
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
  }

  .publish-install__qr {
    width: min(240px, 100%);
  }
}
</style>
