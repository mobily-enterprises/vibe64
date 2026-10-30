<template>
  <figure class="vibe64-image-preview">
    <div
      class="vibe64-image-preview__stage"
      :class="{ 'vibe64-image-preview__stage--actual': actualSize }"
      :aria-label="`Image preview of ${name}`"
      :aria-busy="status === 'loading' ? 'true' : undefined"
      role="group"
      tabindex="0"
    >
      <div v-if="status === 'failed'" class="vibe64-image-preview__failed" role="alert">
        <v-icon :icon="mdiImageBrokenVariant" size="40" aria-hidden="true" />
        <p>This image could not be shown. Try again or download it.</p>
        <v-btn :prepend-icon="mdiRefresh" variant="tonal" @click="retry">Try again</v-btn>
      </div>
      <template v-else>
        <v-skeleton-loader v-if="status === 'loading'" class="vibe64-image-preview__loading" type="image" />
        <img
          :key="`${src}:${version}`"
          :src="src"
          :alt="name"
          :class="{ 'vibe64-image-preview__image--hidden': status !== 'loaded' }"
          @load="loaded"
          @error="status = 'failed'"
          @click="actualSize = !actualSize"
        >
      </template>
    </div>
    <figcaption class="vibe64-image-preview__caption">
      <span class="vibe64-image-preview__details">{{ details }}</span>
      <v-btn
        :disabled="status !== 'loaded'"
        :prepend-icon="actualSize ? mdiFitToScreenOutline : mdiMagnifyPlusOutline"
        :aria-pressed="actualSize ? 'true' : 'false'"
        variant="text"
        @click="actualSize = !actualSize"
      >
        {{ actualSize ? "Fit to window" : "Actual size" }}
      </v-btn>
    </figcaption>
  </figure>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiFitToScreenOutline, mdiImageBrokenVariant, mdiMagnifyPlusOutline, mdiRefresh } from "@mdi/js";
import { formatFileSize } from "@/lib/vibe64FileSize.js";

// One image shown in place: fitted to the pane, or at its actual size on
// request. It is always loaded as an image, so an SVG never runs as markup.
const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: null },
  src: { type: String, required: true }
});
const status = ref("loading");
const version = ref(0);
const actualSize = ref(false);
const dimensions = ref(null);
const details = computed(() => [
  dimensions.value ? `${dimensions.value.width} × ${dimensions.value.height} px` : "",
  Number.isFinite(props.size) ? formatFileSize(props.size) : ""
].filter(Boolean).join(" · ") || props.name);

function loaded(event) {
  const { naturalWidth: width, naturalHeight: height } = event.target;
  dimensions.value = width && height ? { width, height } : null;
  status.value = "loaded";
}

function retry() {
  version.value += 1;
  status.value = "loading";
}

watch(() => props.src, () => {
  status.value = "loading";
  actualSize.value = false;
  dimensions.value = null;
});
</script>

<style scoped>
.vibe64-image-preview {
  display: flex;
  flex: 1;
  flex-direction: column;
  margin: 0;
  min-block-size: 0;
  min-inline-size: 0;
}

.vibe64-image-preview__stage {
  display: flex;
  flex: 1;
  min-block-size: 12rem;
  min-inline-size: 0;
  overflow: auto;
  padding: var(--v64-space-3);
  position: relative;
}

.vibe64-image-preview__stage:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: calc(var(--v64-focus-ring-width) * -1);
}

/* Auto margins centre the image and fall back to the start when it overflows. */
.vibe64-image-preview__stage img {
  background-color: var(--v64-surface-container-low);
  background-image: conic-gradient(var(--v64-surface-container-highest) 25%, transparent 0 50%, var(--v64-surface-container-highest) 0 75%, transparent 0);
  background-size: 16px 16px;
  border-radius: var(--v64-shape-xs);
  box-shadow: var(--v64-elevation-1);
  cursor: zoom-in;
  flex: none;
  margin: auto;
  max-block-size: 100%;
  max-inline-size: 100%;
  object-fit: contain;
}

.vibe64-image-preview__stage--actual img {
  cursor: zoom-out;
  max-block-size: none;
  max-inline-size: none;
}

.vibe64-image-preview__image--hidden {
  visibility: hidden;
}

.vibe64-image-preview__loading {
  inset: var(--v64-space-3);
  position: absolute;
}

.vibe64-image-preview__failed {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-direction: column;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-3);
  margin: auto;
  text-align: center;
}

.vibe64-image-preview__failed p {
  margin: 0;
}

.vibe64-image-preview__caption {
  align-items: center;
  border-block-start: 1px solid var(--v64-outline-variant);
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-2);
  justify-content: space-between;
  min-block-size: 48px;
  padding-inline: var(--v64-space-3) var(--v64-space-1);
}

.vibe64-image-preview__details {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
</style>
