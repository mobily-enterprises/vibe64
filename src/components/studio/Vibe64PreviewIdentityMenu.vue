<template>
  <v-menu
    v-if="previewIdentityAvailable"
    location="bottom end"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        :aria-label="previewIdentityTitle"
        :color="previewIdentityError ? 'error' : undefined"
        :disabled="previewIdentityBusy"
        :icon="mdiAccountSwitchOutline"
        size="small"
        :title="previewIdentityTitle"
        variant="text"
      />
    </template>

    <v-card class="vibe64-launch-controls__identity-menu">
      <v-card-item
        :prepend-icon="mdiAccountCircleOutline"
        subtitle="Application preview identity"
        :title="previewIdentityLabel"
      />

      <v-divider />

      <v-list density="compact">
        <v-list-item
          v-for="identity in previewIdentityConfigured"
          :key="identity.name"
          :active="previewIdentityCurrent?.mode === 'identity' && previewIdentityCurrent?.name === identity.name"
          :disabled="previewIdentitySelectionDisabled"
          :prepend-icon="mdiAccountCircleOutline"
          :subtitle="`${previewIdentityTypeLabel(identity.type)}: ${identity.value}`"
          :title="identity.name"
          @click="selectPreviewIdentityFromMenu(identity)"
        />
        <v-list-item
          :active="previewIdentityCurrent?.mode === 'guest'"
          :disabled="previewIdentitySelectionDisabled"
          :prepend-icon="mdiAccountOffOutline"
          subtitle="Use the app signed out"
          title="Guest"
          @click="selectPreviewGuest"
        />
      </v-list>

      <v-alert
        v-if="previewIdentityError"
        class="vibe64-launch-controls__identity-error"
        density="compact"
        type="error"
        variant="tonal"
      >
        {{ previewIdentityError }}
      </v-alert>
      <div
        v-if="previewIdentityFixAvailable"
        class="vibe64-launch-controls__identity-recovery"
      >
        <Vibe64TemporaryAiFixAction
          :disabled="previewIdentityFixSending"
          :pending="previewIdentityFixSending"
          title="Open Temporary AI to resolve preview identity"
          @click="requestCodexPreviewIdentityFix"
        />
      </div>
    </v-card>
  </v-menu>
</template>

<script setup>
// The Preview's signed-in application identity, and the Temporary AI repair
// offered when selecting a configured identity fails.
import { computed, ref, watch } from "vue";
import {
  mdiAccountCircleOutline,
  mdiAccountOffOutline,
  mdiAccountSwitchOutline
} from "@mdi/js";
import Vibe64TemporaryAiFixAction from "@/components/studio/Vibe64TemporaryAiFixAction.vue";

const props = defineProps({
  fixPreviewIdentityWithTemporaryAi: {
    default: null,
    type: Function
  },
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<ReturnType<typeof import("@/composables/useVibe64OutputControlsSurface.js").useVibe64OutputControlsSurface>>} */ (Object)
  }
});

const {
  previewIdentityAvailable,
  previewIdentityBusy,
  previewIdentityConfigured,
  previewIdentityCurrent,
  previewIdentityError,
  previewIdentityLabel,
  previewIdentitySelectionDisabled,
  previewIdentityTitle,
  previewIdentityTypeLabel,
  selectPreviewConfiguredIdentity,
  selectPreviewGuest
} = props.surface;

const previewIdentityFailedSelection = ref(null);
const previewIdentityFixSending = ref(false);
const previewIdentityFixAvailable = computed(() => Boolean(
  previewIdentityError.value &&
  previewIdentityFailedSelection.value &&
  typeof props.fixPreviewIdentityWithTemporaryAi === "function"
));

async function selectPreviewIdentityFromMenu(identity = {}) {
  previewIdentityFailedSelection.value = identity;
  const selected = await selectPreviewConfiguredIdentity(identity);
  if (selected) {
    previewIdentityFailedSelection.value = null;
  }
  return selected;
}

async function requestCodexPreviewIdentityFix() {
  if (!previewIdentityFixAvailable.value || previewIdentityFixSending.value) {
    return false;
  }
  previewIdentityFixSending.value = true;
  try {
    return await props.fixPreviewIdentityWithTemporaryAi({
      error: previewIdentityError.value,
      identity: previewIdentityFailedSelection.value
    });
  } finally {
    previewIdentityFixSending.value = false;
  }
}

watch(previewIdentityError, (error) => {
  if (!error) {
    previewIdentityFailedSelection.value = null;
  }
});
</script>

<style scoped>
.vibe64-launch-controls__identity-menu {
  max-width: min(25rem, calc(100vw - 1.5rem));
  min-width: min(19rem, calc(100vw - 1.5rem));
}

.vibe64-launch-controls__identity-error {
  margin: 0 0.75rem 0.75rem;
  overflow-wrap: anywhere;
}

.vibe64-launch-controls__identity-recovery {
  display: flex;
  justify-content: flex-end;
  padding: 0 0.5rem 0.5rem;
}
</style>
