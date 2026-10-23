<template>
  <div v-if="visible" class="vibe64-approvals" :class="{ 'vibe64-approvals--phone': phone }">
    <button
      v-if="phone"
      type="button"
      class="vibe64-approvals__bar"
      :aria-label="`${barLabel}. Open messages for approval`"
      @click="sheetOpen = true"
    >
      <v-icon :icon="mdiClockOutline" size="20" color="secondary" />
      <span class="vibe64-approvals__bar-label">{{ barLabel }}</span>
      <v-icon :icon="mdiChevronUp" size="20" />
    </button>
    <component
      :is="phone ? VBottomSheet : 'section'"
      v-bind="phone ? { modelValue: sheetOpen, 'onUpdate:modelValue': (value) => { sheetOpen = value; } } : {}"
      class="vibe64-approvals__stack"
      aria-label="Messages for approval"
    >
      <v-card :variant="phone ? 'elevated' : 'flat'" class="vibe64-approvals__panel" :class="{ 'vibe64-approvals__panel--sheet': phone }">
        <div v-if="phone" class="vibe64-approvals__sheet-header">
          <h2 class="text-title-medium">Messages for approval</h2>
          <v-btn :icon="mdiClose" variant="text" aria-label="Close messages for approval" @click="sheetOpen = false" />
        </div>
        <div class="vibe64-approvals__list">
          <v-card
            v-for="entry in approvals.open"
            :key="entry.id"
            variant="outlined"
            class="vibe64-approvals__card"
            :data-approval-id="entry.id"
          >
            <div class="vibe64-approvals__head">
              <v-avatar size="32" color="secondary" variant="tonal" class="vibe64-approvals__avatar">
                {{ initial(entry.sender) }}
              </v-avatar>
              <div class="vibe64-approvals__who">
                <div class="text-body-medium font-weight-medium text-truncate">
                  {{ heading(entry) }}<span class="text-medium-emphasis font-weight-regular"> · {{ time(entry.createdAt) }}</span>
                </div>
                <div v-if="!approvals.isOwner" class="text-body-small text-medium-emphasis">
                  Waiting for {{ approvals.ownerName }} to approve
                </div>
              </div>
              <v-chip size="small" variant="tonal" :color="sending(entry) ? 'primary' : 'secondary'" class="flex-shrink-0">
                <v-progress-circular v-if="sending(entry)" indeterminate size="12" width="2" class="me-1" />
                <v-icon v-else :icon="mdiClockOutline" size="14" start />
                {{ sending(entry) ? "Sending…" : "Waiting" }}
              </v-chip>
            </div>

            <div v-if="draft.id === entry.id && draft.mode !== 'decline'" class="vibe64-approvals__draft">
              <v-textarea
                v-model="draft.text"
                :label="draft.mode === 'approve' ? `Edit ${entry.sender.displayName}'s message` : 'Edit your message'"
                auto-grow
                rows="2"
                max-rows="8"
                density="compact"
                variant="outlined"
                hide-details="auto"
                autofocus
              />
              <div class="vibe64-approvals__actions">
                <v-btn variant="text" :block="phone" @click="closeDraft">Cancel</v-btn>
                <v-btn
                  color="primary" variant="flat" :block="phone" :disabled="!draft.text.trim()"
                  :loading="Boolean(approvals.pending[entry.id])" @click="saveDraft(entry)"
                >
                  {{ draft.mode === "approve" ? "Send" : "Save" }}
                </v-btn>
              </div>
            </div>
            <p v-else class="vibe64-approvals__text">{{ entry.text }}</p>

            <p v-if="entry.steer && entry.status === 'waiting'" class="vibe64-approvals__note text-body-small text-medium-emphasis">
              {{ approvals.isOwner
                ? "Sent while the assistant was working. It joins the current turn if it's still running when you approve."
                : `Sent while the assistant was working. It joins the current turn if it's still running when ${approvals.ownerName} approves.` }}
            </p>
            <v-alert v-if="entry.error && !sending(entry)" type="error" variant="tonal" density="compact" class="mt-2">
              Couldn't send: {{ entry.error }} Try again.
            </v-alert>

            <div v-if="draft.id === entry.id && draft.mode === 'decline'" class="vibe64-approvals__draft">
              <v-textarea
                v-model="draft.text"
                :label="`Add a note for ${entry.sender.displayName} (optional)`"
                auto-grow
                rows="1"
                max-rows="4"
                counter="500"
                :rules="[(value) => value.length <= 500 || 'Keep the note under 500 characters.']"
                density="compact"
                variant="outlined"
                autofocus
              />
              <div class="vibe64-approvals__actions">
                <v-btn variant="text" :block="phone" @click="closeDraft">Cancel</v-btn>
                <v-btn
                  color="error" variant="tonal" :block="phone" :disabled="draft.text.length > 500"
                  :loading="approvals.pending[entry.id] === 'decline'" @click="saveDraft(entry)"
                >
                  Decline
                </v-btn>
              </div>
            </div>
            <div v-else-if="draft.id !== entry.id && approvals.isOwner" class="vibe64-approvals__actions vibe64-approvals__actions--owner">
              <v-btn
                color="primary" variant="flat" :block="phone" :disabled="busy(entry)"
                :loading="approvals.pending[entry.id] === 'approve'" :prepend-icon="mdiSend" @click="approvals.approve(entry)"
              >
                {{ entry.status === "sending" && !approvals.pending[entry.id] ? "Send again" : "Approve & send" }}
              </v-btn>
              <v-btn variant="tonal" :block="phone" :disabled="busy(entry)" :prepend-icon="mdiPencilOutline" @click="openDraft(entry, 'approve')">
                Edit then send
              </v-btn>
              <v-btn variant="text" :block="phone" :disabled="busy(entry)" @click="openDraft(entry, 'decline')">
                Decline
              </v-btn>
            </div>
            <div v-else-if="draft.id !== entry.id && approvals.own(entry)" class="vibe64-approvals__actions">
              <v-btn variant="text" :block="phone" :disabled="busy(entry)" :prepend-icon="mdiPencilOutline" @click="openDraft(entry, 'edit')">
                Edit
              </v-btn>
              <v-btn
                variant="text" :block="phone" :disabled="busy(entry)" :prepend-icon="mdiUndoVariant"
                :loading="approvals.pending[entry.id] === 'withdraw'" @click="approvals.withdraw(entry)"
              >
                Withdraw
              </v-btn>
            </div>
          </v-card>

          <ul v-if="shownDecided.length" class="vibe64-approvals__decided" aria-label="Decided messages">
            <li v-for="entry in shownDecided" :key="entry.id" :data-approval-id="entry.id" class="vibe64-approvals__row">
              <div class="vibe64-approvals__row-line">
                <v-icon :icon="decision(entry).icon" :color="decision(entry).color" size="18" class="flex-shrink-0" />
                <span class="text-body-small vibe64-approvals__row-text">{{ decision(entry).text }}</span>
                <v-btn
                  v-if="entry.status === 'sent'" variant="text" size="small" density="comfortable"
                  class="vibe64-approvals__show" @click="emit('show-in-chat', entry)"
                >
                  Show in chat
                </v-btn>
              </div>
              <blockquote v-if="entry.status === 'declined' && entry.note" class="vibe64-approvals__quote text-body-small">
                “{{ entry.note }}”
              </blockquote>
            </li>
          </ul>
          <v-btn
            v-if="hiddenDecidedCount"
            variant="text" size="small" class="align-self-start" @click="showEarlier = true"
          >
            Show earlier ({{ hiddenDecidedCount }})
          </v-btn>
        </div>
      </v-card>
    </component>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from "vue";
import { VBottomSheet } from "vuetify/components";
import { mdiCheck, mdiChevronUp, mdiClockOutline, mdiClose, mdiPencilOutline, mdiSend, mdiUndoVariant } from "@mdi/js";

const RECENT_ROWS = 3;

const props = defineProps({
  approvals: { type: Object, required: true },
  phone: { type: Boolean, default: false }
});
const emit = defineEmits(["show-in-chat"]);

const sheetOpen = ref(false);
const showEarlier = ref(false);
const draft = reactive({ id: "", mode: "", text: "" });

const shownDecided = computed(() => showEarlier.value
  ? [...props.approvals.recentDecided, ...props.approvals.earlierDecided]
  : props.approvals.recentDecided.slice(0, RECENT_ROWS));
const hiddenDecidedCount = computed(() => showEarlier.value ? 0
  : props.approvals.recentDecided.length + props.approvals.earlierDecided.length - shownDecided.value.length);
const visible = computed(() => props.approvals.open.length > 0 || props.approvals.recentDecided.length > 0);
const barLabel = computed(() => {
  const count = props.approvals.open.length;
  if (!count) return "Messages for approval";
  return `${count} ${count === 1 ? "message" : "messages"} waiting for approval`;
});

function initial(person = {}) {
  return String(person.displayName || person.id || "?").trim().charAt(0).toUpperCase();
}

function time(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function heading(entry) {
  if (props.approvals.own(entry)) return "You";
  return props.approvals.isOwner ? `${entry.sender.displayName} wants to send` : entry.sender.displayName;
}

function sending(entry) {
  return props.approvals.pending[entry.id] === "approve" || entry.status === "sending";
}

function busy(entry) {
  return Boolean(props.approvals.pending[entry.id]);
}

function decision(entry) {
  const by = entry.decidedBy?.id && entry.decidedBy.id === props.approvals.viewerId ? "you" : entry.decidedBy?.displayName || "the owner";
  const subject = props.approvals.own(entry) ? "" : `${entry.sender.displayName} · `;
  const at = time(entry.decidedAt || entry.updatedAt);
  if (entry.status === "sent") {
    return { icon: mdiCheck, color: "success",
      text: `${subject}Sent by ${by} · ${at}${entry.originalText ? ` · Edited by ${by}` : ""}` };
  }
  if (entry.status === "declined") return { icon: mdiClose, color: "error", text: `${subject}Declined by ${by} · ${at}` };
  return { icon: mdiUndoVariant, color: undefined, text: `${subject}Withdrawn by ${by} · ${at}` };
}

function openDraft(entry, mode) {
  Object.assign(draft, { id: entry.id, mode, text: mode === "decline" ? "" : entry.text });
}

function closeDraft() {
  Object.assign(draft, { id: "", mode: "", text: "" });
}

async function saveDraft(entry) {
  const operation = { edit: props.approvals.edit, approve: props.approvals.approve, decline: props.approvals.decline }[draft.mode];
  if (await operation(entry, draft.text)) closeDraft();
}

defineExpose({ open: () => { sheetOpen.value = true; } });
</script>

<style scoped>
.vibe64-approvals {
  min-width: 0;
}
.vibe64-approvals__stack {
  display: block;
  max-height: min(40vh, 26rem);
  overflow-y: auto;
  padding: 0 0 0.5rem;
}
.vibe64-approvals--phone .vibe64-approvals__stack {
  max-height: none;
  padding: 0;
}
.vibe64-approvals__panel {
  background: transparent;
}
.vibe64-approvals__panel--sheet {
  background: rgb(var(--v-theme-surface));
  max-height: 85vh;
  overflow-y: auto;
  padding: 0 1rem calc(1rem + env(safe-area-inset-bottom));
}
.vibe64-approvals__sheet-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  min-height: 3.5rem;
}
.vibe64-approvals__list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.vibe64-approvals__card {
  border-color: rgba(var(--v-theme-secondary), 0.45);
  background: rgba(var(--v-theme-secondary), 0.05);
  padding: 0.75rem;
}
.vibe64-approvals__head {
  align-items: center;
  display: flex;
  gap: 0.625rem;
  min-width: 0;
}
.vibe64-approvals__avatar {
  font-weight: 600;
}
.vibe64-approvals__who {
  flex: 1 1 auto;
  min-width: 0;
}
.vibe64-approvals__text {
  margin: 0.5rem 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.vibe64-approvals__note {
  margin: 0.375rem 0 0;
}
.vibe64-approvals__draft {
  margin-top: 0.5rem;
}
.vibe64-approvals__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
.vibe64-approvals__actions--owner {
  justify-content: flex-start;
}
.vibe64-approvals--phone .vibe64-approvals__actions {
  flex-direction: column-reverse;
}
.vibe64-approvals--phone .vibe64-approvals__actions--owner {
  flex-direction: column;
}
.vibe64-approvals--phone .vibe64-approvals__actions :deep(.v-btn) {
  min-height: 48px;
}
.vibe64-approvals__decided {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0 0.25rem;
}
.vibe64-approvals__row-line {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  min-height: 2rem;
  min-width: 0;
}
.vibe64-approvals__row-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow-wrap: anywhere;
}
.vibe64-approvals__show {
  flex-shrink: 0;
}
.vibe64-approvals__quote {
  border-inline-start: 3px solid rgba(var(--v-theme-error), 0.5);
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  margin: 0 0 0.25rem 1.625rem;
  overflow-wrap: anywhere;
  padding-inline-start: 0.5rem;
}
.vibe64-approvals__bar {
  align-items: center;
  background: rgba(var(--v-theme-secondary), 0.08);
  border: 1px solid rgba(var(--v-theme-secondary), 0.35);
  border-radius: 12px;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  min-height: 48px;
  padding: 0 0.75rem;
  text-align: start;
  width: 100%;
}
.vibe64-approvals__bar-label {
  flex: 1 1 auto;
  font-weight: 500;
  min-width: 0;
}
</style>
