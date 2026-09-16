<template>
  <v-dialog
    :aria-labelledby="renewalTitleId"
    :fullscreen="smAndDown"
    :model-value="renewal.open"
    max-width="46rem"
    :persistent="dialogBusy"
    scrollable
    @after-leave="renewal.restoreTriggerFocus?.()"
    @update:model-value="closeFromModel"
  >
    <v-card
      class="studio-session-renewal"
      :class="{ 'studio-session-renewal--fullscreen': smAndDown }"
      data-vibe64-session-renewal
      :data-vibe64-session-renewal-phase="renewal.phase"
      :rounded="smAndDown ? '0' : 'xl'"
    >
      <v-card-title class="studio-session-renewal__header">
        <span class="studio-session-renewal__heading">
          <span class="studio-session-renewal__icon" aria-hidden="true">
            <v-icon :icon="mdiAutorenew" size="24" />
          </span>
          <span>
            <h2 :id="renewalTitleId" class="text-title-medium">Renew this session</h2>
            <span class="studio-session-renewal__subtitle text-body-small">
              Continue in a fresh conversation
            </span>
          </span>
        </span>
        <v-btn
          aria-label="Close session renewal"
          data-vibe64-session-renewal-close="icon"
          :disabled="dialogBusy"
          height="48"
          :icon="mdiClose"
          title="Close"
          variant="text"
          width="48"
          @click="renewal.close"
        />
      </v-card-title>

      <v-divider />

      <v-card-text class="studio-session-renewal__body">
        <v-alert
          v-if="renewal.refreshError && renewal.phase !== 'load_error'"
          class="studio-session-renewal__notice"
          density="compact"
          :icon="mdiInformationOutline"
          role="status"
          type="warning"
          variant="tonal"
        >
          <div class="studio-session-renewal__notice-with-action">
            <span class="studio-session-renewal__notice-copy">
              <strong class="text-title-small">Latest progress could not be checked</strong>
              <span class="text-body-medium">The last saved renewal state is shown. Nothing has been discarded.</span>
              <span class="text-body-small">{{ renewal.refreshError }}</span>
            </span>
            <v-btn
              :aria-busy="renewal.refreshing ? 'true' : undefined"
              :disabled="renewal.refreshing"
              height="48"
              type="button"
              variant="text"
              @click="renewal.reload"
            >
              {{ renewal.refreshing ? "Checking…" : "Check again" }}
            </v-btn>
          </div>
        </v-alert>

        <template v-if="renewal.phase === 'loading'">
          <div class="studio-session-renewal__skeleton" aria-label="Loading session renewal" role="status">
            <v-skeleton-loader type="paragraph, paragraph" />
            <v-skeleton-loader height="224" type="image" />
          </div>
        </template>

        <template v-else-if="renewal.phase === 'load_error'">
          <StudioErrorNotice
            title="Session renewal could not load"
            :error="renewal.loadError"
          />
        </template>

        <template v-else-if="renewal.phase === 'intro'">
          <p class="studio-session-renewal__lead text-body-large">
            Vibe64 will ask this session to write a detailed handover, let you review it, and create a fresh session from the current saved version.
          </p>
          <v-alert
            v-if="renewal.advisoryPresentation?.attention"
            class="studio-session-renewal__notice"
            density="compact"
            :icon="mdiInformationOutline"
            :type="renewal.advisoryPresentation.color === 'warning' ? 'warning' : 'info'"
            variant="tonal"
          >
            <span class="studio-session-renewal__notice-copy">
              <strong class="text-title-small">{{ renewal.advisoryPresentation.label }}</strong>
              <span class="text-body-medium">{{ renewal.advisoryPresentation.reason }}</span>
            </span>
          </v-alert>
          <v-sheet class="studio-session-renewal__assurance text-body-medium" color="surface-variant" rounded="lg">
            <v-icon color="primary" :icon="mdiArchiveCheckOutline" size="22" />
            <span>
              <strong class="font-weight-medium">Your old session is kept until the handover is delivered.</strong>
              Once it reaches the fresh assistant conversation, renewal completes even if the model cannot answer.
            </span>
          </v-sheet>
          <p class="studio-session-renewal__supporting text-body-small">
            Before starting, save or discard any source changes and wait for assistant, workspace, Save, and Update activity to finish.
          </p>
        </template>

        <template v-else-if="renewal.phase === 'progress'">
          <div
            class="studio-session-renewal__progress-copy"
            :aria-live="renewal.refreshError ? 'off' : 'polite'"
            role="status"
          >
            <strong class="text-title-small">{{ renewal.stageLabel }}</strong>
            <span class="text-body-small">You can close this window. Progress is saved and will resume safely.</span>
          </div>
          <v-progress-linear
            aria-label="Session renewal in progress"
            class="studio-session-renewal__progress-line"
            color="primary"
            :indeterminate="!renewal.refreshError"
            :model-value="renewal.refreshError ? renewalProgress : undefined"
            rounded
          />
          <ol aria-label="Session renewal progress" class="studio-session-renewal__steps text-body-medium">
            <li
              v-for="step in renewal.steps"
              :key="step.id"
              :aria-current="step.state === 'active' ? 'step' : undefined"
              :class="[
                `studio-session-renewal__step--${step.state}`,
                { 'font-weight-medium': step.state === 'active' }
              ]"
            >
              <span class="studio-session-renewal__step-icon" aria-hidden="true">
                <v-icon
                  :icon="step.state === 'complete' ? mdiCheck : step.state === 'active' ? mdiCircleSlice4 : mdiCircleOutline"
                  size="18"
                />
              </span>
              <span>{{ step.label }}</span>
              <span class="d-sr-only">{{ stepStateLabel(step.state) }}</span>
            </li>
          </ol>
        </template>

        <template v-else-if="renewal.phase === 'review'">
          <p class="studio-session-renewal__lead text-body-large">
            Review what the fresh assistant will receive. Add anything important before continuing.
          </p>
          <v-alert
            v-if="renewal.draftConflict"
            class="studio-session-renewal__notice"
            density="compact"
            :icon="mdiInformationOutline"
            role="alert"
            type="warning"
            variant="tonal"
          >
            <span class="studio-session-renewal__notice-copy">
              <strong class="text-title-small">This handover changed elsewhere</strong>
              <span class="text-body-medium">Your unsaved edits are still here. Choose which version to continue editing before saving or renewing.</span>
            </span>
            <div class="studio-session-renewal__inline-actions">
              <v-btn height="48" type="button" variant="text" @click="renewal.keepLocalDraft">
                Keep my edits
              </v-btn>
              <v-btn color="primary" height="48" type="button" variant="tonal" @click="renewal.acceptLatestDraft">
                Discard my edits and use latest
              </v-btn>
            </div>
          </v-alert>
          <v-alert
            v-if="manualDraft"
            class="studio-session-renewal__notice"
            density="compact"
            :icon="mdiInformationOutline"
            type="info"
            variant="tonal"
          >
            <span class="studio-session-renewal__notice-copy">
              <strong class="text-title-small">Complete the handover template</strong>
              <span class="text-body-medium">
                The assistant could not provide a verified handover. Fill in every section, and keep the Saved source details unchanged so the fresh assistant can verify its exact starting point.
              </span>
              <span v-if="renewal.renewal?.error?.message" class="text-body-small">
                {{ renewal.renewal.error.message }}
              </span>
            </span>
            <dl
              v-if="manualSourceItems.length"
              aria-label="Saved source details to preserve"
              class="studio-session-renewal__source-details text-body-small"
            >
              <template v-for="item in manualSourceItems" :key="item.label">
                <dt>{{ item.label }}</dt>
                <dd><code>{{ item.value }}</code></dd>
              </template>
            </dl>
          </v-alert>
          <v-alert
            v-else-if="renewal.renewal?.error?.message"
            class="studio-session-renewal__notice"
            density="compact"
            :icon="mdiInformationOutline"
            type="info"
            variant="tonal"
          >
            {{ renewal.renewal.error.message }}
          </v-alert>
          <v-textarea
            :model-value="renewal.draftText"
            autofocus
            class="studio-session-renewal__draft"
            :counter="renewal.maxHandoverCharacters"
            :error="Boolean(renewal.draftError)"
            :error-messages="renewal.draftError"
            label="Handover for the fresh session"
            persistent-counter
            rows="12"
            variant="outlined"
            @update:model-value="renewal.setDraftText"
          >
            <template #counter>
              <span>
                {{ renewal.draftCharacterCount.toLocaleString() }} / {{ renewal.maxHandoverCharacters.toLocaleString() }}
              </span>
            </template>
          </v-textarea>
          <p
            v-if="renewal.draftDirty"
            class="studio-session-renewal__supporting text-body-small"
            role="status"
          >
            Unsaved edits are kept in this browser tab if you close this window or switch sessions.
          </p>
          <Vibe64RenewalAssistantSelector
            :active="renewal.open && renewal.phase === 'review'"
            :disabled="dialogBusy"
            :initial-selection="renewal.assistantSelection"
            @update:ready="assistantSelectionReady = $event"
            @update:selection="successorAssistantSelection = $event"
          />
          <p class="studio-session-renewal__supporting text-body-small">
            Renewing will stop this session’s tools, create and prepare a fresh session, deliver the handover, then archive this one.
          </p>
        </template>

        <template v-else-if="renewal.phase === 'failed'">
          <StudioErrorNotice
            title="Session renewal needs attention"
            :error="renewal.renewal?.error?.message || 'Session renewal could not continue.'"
          />
          <p
            v-if="failedSupportingMessage"
            class="studio-session-renewal__supporting text-body-small"
          >
            {{ failedSupportingMessage }}
          </p>
        </template>

        <template v-else-if="renewal.phase === 'completed'">
          <v-sheet class="studio-session-renewal__success text-body-medium" color="surface-variant" rounded="lg" role="status">
            <v-icon color="success" :icon="mdiCheckCircleOutline" size="28" />
            <span>
              <strong class="font-weight-medium">The fresh session is ready.</strong>
              {{ renewal.successorSelectionError ? "It is ready to open; the old session remains available in the archive." : "Opening it now; the old session remains available in the archive." }}
            </span>
          </v-sheet>
          <v-alert
            v-if="renewal.maintenanceNeedsRetry"
            class="studio-session-renewal__notice"
            density="compact"
            :icon="mdiInformationOutline"
            role="status"
            type="warning"
            variant="tonal"
          >
            <span class="studio-session-renewal__notice-copy">
              <strong class="text-title-small">Cleanup needs retry</strong>
              <span class="text-body-medium">
                The fresh session is ready, but Vibe64 has not finished retiring every old-session resource.
              </span>
              <span class="text-body-small">{{ renewal.maintenanceError }}</span>
            </span>
          </v-alert>
          <StudioErrorNotice
            v-if="renewal.successorSelectionError"
            title="The fresh session could not be opened automatically"
            :error="renewal.successorSelectionError"
          />
        </template>
      </v-card-text>

      <v-divider />

      <v-card-actions
        class="studio-session-renewal__actions"
        :class="{ 'studio-session-renewal__actions--compact': smAndDown }"
      >
        <v-btn
          v-if="renewal.phase === 'review'"
          :aria-busy="renewal.pendingAction === 'cancel' ? 'true' : undefined"
          class="studio-session-renewal__action"
          :disabled="dialogBusy || Boolean(renewal.draftConflict)"
          height="48"
          type="button"
          variant="text"
          @click="renewal.cancel"
        >
          {{ renewal.pendingAction === "cancel" ? renewal.actionLabel : renewal.draftDirty ? "Discard edits and cancel" : "Cancel renewal" }}
        </v-btn>
        <v-btn
          v-else
          class="studio-session-renewal__action"
          data-vibe64-session-renewal-close="footer"
          :disabled="dialogBusy"
          height="48"
          type="button"
          variant="text"
          @click="renewal.close"
        >
          Close
        </v-btn>

        <span class="studio-session-renewal__actions-spacer" />

        <v-btn
          v-if="renewal.phase === 'load_error'"
          :aria-busy="renewal.refreshing ? 'true' : undefined"
          autofocus
          class="studio-session-renewal__action studio-session-renewal__action--primary"
          :disabled="renewal.refreshing"
          height="48"
          type="button"
          variant="tonal"
          @click="renewal.reload"
        >
          {{ renewal.refreshing ? "Checking…" : "Try again" }}
        </v-btn>
        <v-btn
          v-else-if="renewal.phase === 'intro'"
          :aria-busy="renewal.pendingAction === 'draft' ? 'true' : undefined"
          autofocus
          class="studio-session-renewal__action studio-session-renewal__action--primary"
          color="primary"
          :disabled="renewal.busy"
          height="48"
          :prepend-icon="mdiFileDocumentEditOutline"
          type="button"
          variant="flat"
          @click="renewal.requestDraft"
        >
          {{ renewal.actionLabel || "Prepare handover" }}
        </v-btn>
        <template v-else-if="renewal.phase === 'review'">
          <v-btn
            :aria-busy="renewal.pendingAction === 'save' ? 'true' : undefined"
            class="studio-session-renewal__action"
            :disabled="!renewal.canSaveDraft"
            height="48"
            type="button"
            variant="tonal"
            @click="renewal.saveDraft"
          >
            {{ renewal.pendingAction === "save" ? renewal.actionLabel : "Save draft" }}
          </v-btn>
          <v-btn
            :aria-busy="renewal.pendingAction === 'confirm' ? 'true' : undefined"
            class="studio-session-renewal__action studio-session-renewal__action--primary"
            color="primary"
            :disabled="!canConfirmRenewal"
            height="48"
            :prepend-icon="mdiAutorenew"
            type="button"
            variant="flat"
            @click="confirmRenewal"
          >
            {{ renewal.pendingAction === "confirm" ? renewal.actionLabel : "Renew session" }}
          </v-btn>
        </template>
        <v-btn
          v-else-if="renewal.phase === 'failed'"
          :aria-busy="renewal.pendingAction === 'retry' ? 'true' : undefined"
          autofocus
          class="studio-session-renewal__action studio-session-renewal__action--primary"
          color="primary"
          :disabled="renewal.busy"
          height="48"
          :prepend-icon="mdiRefresh"
          type="button"
          variant="flat"
          @click="renewal.retry"
        >
          {{ renewal.actionLabel || "Retry" }}
        </v-btn>
        <template v-else-if="renewal.phase === 'completed'">
          <v-btn
            v-if="renewal.maintenanceNeedsRetry"
            :aria-busy="renewal.pendingAction === 'retry' ? 'true' : undefined"
            class="studio-session-renewal__action"
            :disabled="renewal.busy"
            height="48"
            :prepend-icon="mdiRefresh"
            type="button"
            variant="tonal"
            @click="renewal.retry"
          >
            {{ renewal.pendingAction === "retry" ? renewal.actionLabel : "Retry cleanup" }}
          </v-btn>
          <v-btn
            :aria-busy="renewal.successorSelectionPending ? 'true' : undefined"
            :autofocus="Boolean(renewal.successorSelectionError)"
            class="studio-session-renewal__action studio-session-renewal__action--primary"
            color="primary"
            :disabled="renewal.successorSelectionPending"
            height="48"
            type="button"
            variant="flat"
            @click="renewal.openSuccessor"
          >
            {{ renewal.successorSelectionPending ? "Opening…" : "Open fresh session" }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, useId } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiArchiveCheckOutline,
  mdiAutorenew,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiCircleOutline,
  mdiCircleSlice4,
  mdiClose,
  mdiFileDocumentEditOutline,
  mdiInformationOutline,
  mdiRefresh
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import Vibe64RenewalAssistantSelector from "@/components/studio/vibe64-session/Vibe64RenewalAssistantSelector.vue";
import {
  sessionRenewalFailureSupportingMessage
} from "@/lib/vibe64SessionRenewalViewModel.js";

const props = defineProps({
  renewal: {
    default: () => ({}),
    type: Object
  }
});

const { smAndDown } = useDisplay();
const renewalTitleId = `vibe64-session-renewal-title-${useId()}`;
const assistantSelectionReady = ref(false);
const successorAssistantSelection = ref(null);
const dialogBusy = computed(() => Boolean(
  props.renewal.successorSelectionPending || (
    props.renewal.busy && props.renewal.phase !== "progress"
  )
));
const renewalProgress = computed(() => {
  const steps = Array.isArray(props.renewal.steps) ? props.renewal.steps : [];
  if (!steps.length) {
    return 0;
  }
  const completed = steps.reduce((value, step) => (
    value + (step.state === "complete" ? 1 : step.state === "active" ? 0.5 : 0)
  ), 0);
  return Math.round((completed / steps.length) * 100);
});
const canConfirmRenewal = computed(() => Boolean(
  props.renewal.canConfirm &&
  assistantSelectionReady.value &&
  successorAssistantSelection.value
));
const manualDraft = computed(() => props.renewal.renewal?.draft?.origin === "manual");
const failedSupportingMessage = computed(() => (
  sessionRenewalFailureSupportingMessage(props.renewal.renewal)
));
const manualSourceItems = computed(() => {
  const source = props.renewal.renewal?.basis?.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return [];
  }
  return [
    { label: "Authority", value: source.authority },
    { label: "Repository", value: source.repository },
    { label: "Reference", value: source.ref },
    { label: "Commit", value: source.commit }
  ].filter((item) => String(item.value || "").trim()).map((item) => ({
    ...item,
    value: String(item.value).trim()
  }));
});

function stepStateLabel(state = "") {
  return ({
    active: "Current step",
    complete: "Complete",
    pending: "Not started"
  })[String(state || "")] || "";
}

function closeFromModel(value) {
  if (!value && !dialogBusy.value) {
    props.renewal.close?.();
  }
}

function confirmRenewal() {
  if (canConfirmRenewal.value) {
    props.renewal.confirm?.(successorAssistantSelection.value);
  }
}
</script>

<style scoped>
.studio-session-renewal {
  max-height: min(46rem, calc(100dvh - 2rem));
}

.studio-session-renewal__header,
.studio-session-renewal__heading,
.studio-session-renewal__assurance,
.studio-session-renewal__success,
.studio-session-renewal__progress-copy {
  align-items: center;
  display: flex;
}

.studio-session-renewal__header {
  gap: 1rem;
  justify-content: space-between;
  min-height: 4.5rem;
  padding: 0.75rem 1rem;
}

.studio-session-renewal__heading {
  gap: 0.75rem;
  min-width: 0;
}

.studio-session-renewal__heading > span:last-child,
.studio-session-renewal__assurance > span,
.studio-session-renewal__success > span {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.studio-session-renewal__heading h2 {
  margin: 0;
}

.studio-session-renewal__subtitle {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.studio-session-renewal__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 50%;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  flex: 0 0 auto;
  height: 2.6rem;
  justify-content: center;
  width: 2.6rem;
}

.studio-session-renewal__body {
  display: grid;
  gap: 1rem;
  min-height: 22rem;
  padding: 1.25rem;
}

.studio-session-renewal__lead,
.studio-session-renewal__supporting {
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-session-renewal__lead {
  color: rgb(var(--v-theme-on-surface));
}

.studio-session-renewal__supporting {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.studio-session-renewal__assurance,
.studio-session-renewal__success {
  gap: 0.75rem;
  line-height: 1.45;
  padding: 1rem;
}

.studio-session-renewal__skeleton {
  display: grid;
  gap: 1rem;
}

.studio-session-renewal__progress-copy {
  align-items: flex-start;
  display: grid;
  gap: 0.25rem;
}

.studio-session-renewal__progress-copy span {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.studio-session-renewal__progress-line {
  margin-block: 0.1rem 0.25rem;
}

.studio-session-renewal__steps {
  display: grid;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.studio-session-renewal__steps li {
  align-items: center;
  border-radius: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.58);
  display: flex;
  gap: 0.7rem;
  min-height: 2.75rem;
  padding: 0.55rem 0.7rem;
}

.studio-session-renewal__step--active {
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-on-surface));
}

.studio-session-renewal__step--complete {
  color: rgb(var(--v-theme-primary));
}

.studio-session-renewal__step-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  width: 1.25rem;
}

.studio-session-renewal__draft {
  min-width: 0;
}

.studio-session-renewal__notice {
  margin: 0;
}

.studio-session-renewal__notice-copy {
  display: grid;
  gap: 0.25rem;
}

.studio-session-renewal__source-details {
  display: grid;
  gap: 0.25rem 0.75rem;
  grid-template-columns: max-content minmax(0, 1fr);
  margin: 0.75rem 0 0;
}

.studio-session-renewal__source-details dt {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.studio-session-renewal__source-details dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-session-renewal__notice-with-action {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
}

.studio-session-renewal__notice-with-action .studio-session-renewal__notice-copy {
  flex: 1 1 18rem;
}

.studio-session-renewal__inline-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.75rem;
}

.studio-session-renewal__actions {
  flex-wrap: wrap;
  gap: 0.5rem;
  min-height: 4.5rem;
  padding: 0.75rem 1rem;
}

.studio-session-renewal__actions-spacer {
  flex: 1 1 auto;
}

.studio-session-renewal--fullscreen {
  height: 100dvh;
  max-height: 100dvh;
}

.studio-session-renewal--fullscreen .studio-session-renewal__body {
  min-height: 0;
  padding: 1rem;
}

.studio-session-renewal--fullscreen .studio-session-renewal__inline-actions,
.studio-session-renewal--fullscreen .studio-session-renewal__notice-with-action {
  align-items: stretch;
}

.studio-session-renewal--fullscreen .studio-session-renewal__inline-actions > *,
.studio-session-renewal--fullscreen .studio-session-renewal__notice-with-action > :last-child {
  flex: 1 1 100%;
}

.studio-session-renewal__actions--compact {
  align-items: stretch;
}

.studio-session-renewal__actions--compact .studio-session-renewal__actions-spacer {
  display: none;
}

.studio-session-renewal__actions--compact .studio-session-renewal__action {
  flex: 1 1 calc(50% - 0.25rem);
}

.studio-session-renewal__actions--compact .studio-session-renewal__action--primary {
  flex-basis: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .studio-session-renewal__progress-line {
    display: none;
  }
}
</style>
