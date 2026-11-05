<template>
  <form
    aria-label="Preview page"
    class="vibe64-launch-controls__preview-nav"
    :class="{ 'vibe64-launch-controls__preview-nav--invalid': previewAddressError }"
    :title="previewAddressError || 'Preview URL'"
    @submit.prevent="submitPreviewAddress"
  >
    <v-btn
      aria-label="Go back in preview"
      :disabled="!previewBackAvailable"
      :icon="mdiArrowLeft"
      size="small"
      title="Go back in preview"
      type="button"
      variant="text"
      @click="goPreviewBack"
    />
    <v-menu
      v-if="previewRoutesAvailable"
      location="bottom start"
    >
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          aria-label="Preview pages"
          :icon="mdiRoutes"
          size="small"
          title="Preview pages"
          type="button"
          variant="text"
        />
      </template>

      <v-list
        class="vibe64-launch-controls__route-menu"
        density="compact"
      >
        <v-list-item
          v-for="route in previewRoutes"
          :key="route.id"
          :subtitle="route.pathTemplate"
          :title="route.label"
          @click="openPreviewRoute(route)"
        />
      </v-list>
    </v-menu>
    <input
      v-model="previewAddressDraft"
      aria-label="Preview URL"
      :aria-invalid="previewAddressError ? 'true' : 'false'"
      autocapitalize="off"
      autocomplete="off"
      class="vibe64-launch-controls__preview-address"
      :disabled="!previewBaseUrl"
      :placeholder="previewDisplayedAddress ? '' : 'Preview URL unavailable'"
      spellcheck="false"
      type="text"
      @blur="previewAddressBlur"
      @focus="previewAddressFocus"
      @keydown.esc.prevent="resetPreviewAddressDraft"
    >
    <v-btn
      :icon="mdiRefresh"
      size="small"
      :disabled="previewSuspended"
      title="Reload preview"
      data-vibe64-guide="reload-preview"
      type="button"
      variant="text"
      @click="reloadPreview"
    />
    <v-btn
      :aria-pressed="previewPicking ? 'true' : 'false'"
      aria-label="Pick element"
      :color="previewPicking ? 'primary' : undefined"
      :disabled="previewPickBusy || (!previewPicking && !previewPickAvailable)"
      :icon="mdiCursorDefaultClickOutline"
      :loading="previewPickBusy"
      size="small"
      title="Show what this element uses"
      type="button"
      :variant="previewPicking ? 'tonal' : 'text'"
      @click="togglePreviewPick"
    />
    <v-btn
      :aria-label="previewSuspended ? 'Resume preview' : 'Suspend preview'"
      :icon="previewSuspended ? mdiPlay : mdiPause"
      size="small"
      :title="previewSuspended ? 'Resume preview' : 'Suspend preview — unload this page; unsaved page changes may be lost'"
      type="button"
      variant="text"
      @click="previewSuspended ? resumePreview() : suspendPreview()"
    />
    <v-btn
      :disabled="!previewDisplayedAddress"
      :icon="mdiContentCopy"
      size="small"
      title="Copy preview URL"
      type="button"
      variant="text"
      @click.prevent="copyPreviewUrl"
    />
    <v-btn
      v-for="action in launchActions"
      :key="action.id || action.href"
      :aria-label="action.label || 'Open in new tab'"
      :icon="mdiOpenInNew"
      size="small"
      :title="action.label || action.href"
      type="button"
      variant="text"
      @click="openAction(action)"
    />
  </form>
</template>

<script setup>
// The Preview's client group: the page shown in this browser, its address,
// history, routes and the actions on that page.
import {
  mdiArrowLeft,
  mdiContentCopy,
  mdiCursorDefaultClickOutline,
  mdiOpenInNew,
  mdiPause,
  mdiPlay,
  mdiRefresh,
  mdiRoutes
} from "@mdi/js";

const props = defineProps({
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface>} */ (Object)
  }
});

/** @type {import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface} */
const {
  copyPreviewUrl,
  goPreviewBack,
  launchActions,
  openAction,
  openPreviewRoute,
  previewAddressBlur,
  previewAddressDraft,
  previewAddressError,
  previewAddressFocus,
  previewBackAvailable,
  previewBaseUrl,
  previewDisplayedAddress,
  previewPickAvailable,
  previewPickBusy,
  previewPicking,
  previewRoutes,
  previewRoutesAvailable,
  previewSuspended,
  reloadPreview,
  resetPreviewAddressDraft,
  resumePreview,
  submitPreviewAddress,
  suspendPreview,
  togglePreviewPick
} = props.surface;
</script>

<style scoped>
.vibe64-launch-controls__preview-nav {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.045);
  border: 1px solid var(--v64-outline-variant);
  border-radius: 8px;
  display: flex;
  flex: 1 1 19rem;
  gap: 0.02rem;
  max-width: min(23rem, 42vw);
  min-height: 2.05rem;
  min-width: min(13rem, 34vw);
  padding: 0 0.12rem;
}

.vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__preview-nav {
  flex: 1 1 clamp(12rem, 24vw, 20rem);
  max-width: clamp(12rem, 24vw, 20rem);
  /* Never narrower than its buttons and the shortest address. */
  min-width: auto;
}

.vibe64-launch-controls__preview-nav:focus-within {
  border-color: rgba(var(--v-theme-primary), 0.42);
}

.vibe64-launch-controls__preview-nav--invalid {
  border-color: rgba(var(--v-theme-error), 0.48);
}

.vibe64-launch-controls__preview-address {
  background: transparent;
  border: 0;
  color: rgba(var(--v-theme-on-surface), 0.82);
  flex: 1 1 auto;
  font: inherit;
  font-size: 0.78rem;
  min-width: 5rem;
  outline: none;
  overflow: hidden;
  padding: 0 0.12rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-launch-controls__preview-address:focus {
  color: rgba(var(--v-theme-on-surface), 0.95);
}

.vibe64-launch-controls__route-menu {
  max-width: min(24rem, 92vw);
  min-width: min(14rem, 92vw);
}

@media (max-width: 980px) {
  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__preview-nav {
    grid-column: 2;
    grid-row: 1;
    max-width: none;
    min-width: 0;
    width: 100%;
  }

  .vibe64-launch-controls__preview-nav {
    flex: 0 0 min(18rem, 62vw);
    max-width: none;
    min-width: min(16rem, 58vw);
  }

  .vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__preview-nav {
    flex: 0 0 min(16rem, 66vw);
    max-width: none;
    min-width: min(13rem, 58vw);
  }
}
</style>
