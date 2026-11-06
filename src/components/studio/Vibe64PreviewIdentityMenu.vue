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
        icon="$switchAccount"
        size="small"
        :title="previewIdentityTitle"
        variant="text"
      />
    </template>

    <v-card class="vibe64-launch-controls__identity-menu">
      <v-card-item
        prepend-icon="$accountCircle"
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
          prepend-icon="$accountCircle"
          :subtitle="`${previewIdentityTypeLabel(identity.type)}: ${identity.value}`"
          :title="identity.name"
          @click="selectPreviewIdentityFromMenu(identity)"
        />
        <v-list-item
          :active="previewIdentityCurrent?.mode === 'guest'"
          :disabled="previewIdentitySelectionDisabled"
          prepend-icon="$personOff"
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
        <Vibe64AiTaskButton
          :allowed="previewIdentityFixAllowed"
          :input="{ error: previewIdentityError, identity: previewIdentityFailedSelection }"
          kind="preview-identity"
          title="Fix preview sign-in with the AI"
        />
      </div>
    </v-card>
  </v-menu>
</template>

<script setup>
// The Preview's signed-in application identity, and the AI fix offered when
// selecting a configured identity fails.
import { computed, ref, watch } from "vue";
import { Vibe64AiTaskButton } from "@local/vibe64-ai-tasks/client";

const props = defineProps({
  // Whether this person may hand a failed sign-in to the AI.
  previewIdentityFixAllowed: {
    required: true,
    type: Boolean
  },
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface>} */ (Object)
  }
});

/** @type {import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface} */
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
const previewIdentityFixAvailable = computed(() => Boolean(previewIdentityError.value && previewIdentityFailedSelection.value));

async function selectPreviewIdentityFromMenu(identity = {}) {
  previewIdentityFailedSelection.value = identity;
  const selected = await selectPreviewConfiguredIdentity(identity);
  if (selected) {
    previewIdentityFailedSelection.value = null;
  }
  return selected;
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
