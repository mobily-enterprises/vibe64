<template>
  <v-dialog
    :model-value="open"
    :fullscreen="smAndDown"
    max-width="760"
    scrollable
    @update:model-value="(value) => !value && close()"
  >
    <v-card
      class="vibe64-problem-report"
      :rounded="smAndDown ? 0 : 'lg'"
      aria-labelledby="vibe64-problem-report-title"
      data-vibe64-problem-report
    >
      <v-card-title class="vibe64-problem-report__title">
        <h2 id="vibe64-problem-report-title">Report a problem</h2>
        <v-btn
          aria-label="Close Report a problem"
          icon="$close"
          title="Close"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-text v-if="reference" class="vibe64-problem-report__body">
        <v-alert type="success" variant="tonal" role="status">
          <p class="text-body-large font-weight-medium">Sent. Your reference is {{ reference }}.</p>
          <p v-if="sentMessage" class="text-body-medium">{{ sentMessage }}</p>
          <p v-else class="text-body-medium">Quote it if you write to us about this problem.</p>
        </v-alert>
      </v-card-text>

      <v-card-text v-else class="vibe64-problem-report__body">
        <p class="text-body-medium mb-4">
          Vibe64 gathers what it saw around your problem. Read it below before it goes anywhere: Env values, keys,
          passwords, tokens and cookies are hidden.
        </p>
        <v-textarea
          v-model="note"
          :counter="PROBLEM_REPORT_LIMITS.noteCharacters"
          :maxlength="PROBLEM_REPORT_LIMITS.noteCharacters"
          auto-grow
          label="What went wrong (optional)"
          rows="3"
          data-vibe64-problem-report-note
        />
        <v-checkbox
          v-if="place?.chat"
          v-model="includeChatChoice"
          :disabled="collecting"
          density="compact"
          hide-details
          label="Include the messages of the chat I was in"
          data-vibe64-problem-report-chat
        />
        <v-checkbox
          v-for="consent in consents"
          :key="consent.id"
          v-model="consentChoices[consent.id]"
          density="compact"
          :hint="consent.description"
          persistent-hint
          :label="consent.label"
          class="mt-1"
          :data-vibe64-problem-report-consent="consent.id"
        />

        <v-alert v-if="error" class="mt-3" type="error" variant="tonal" role="alert">{{ error }}</v-alert>
        <div v-if="collecting" class="vibe64-problem-report__collecting mt-4" role="status">
          <v-progress-circular indeterminate size="20" width="2" />
          <span class="text-body-medium">Gathering what Vibe64 saw…</span>
        </div>

        <section v-else-if="bundle" class="vibe64-problem-report__review mt-4" aria-label="What this report includes">
          <div class="vibe64-problem-report__review-head">
            <h3 class="text-title-small">What this report includes</h3>
            <v-chip size="small" variant="tonal" data-vibe64-problem-report-hidden>
              {{ hiddenLabel }}
            </v-chip>
          </div>
          <ul class="vibe64-problem-report__parts text-body-medium">
            <li v-for="part in parts" :key="part.label">
              <span class="font-weight-medium">{{ part.label }}:</span> {{ part.value }}
            </li>
          </ul>
          <v-expansion-panels variant="accordion" class="mt-2">
            <v-expansion-panel title="Show the whole report">
              <v-expansion-panel-text>
                <pre class="vibe64-problem-report__json" data-vibe64-problem-report-json>{{ reportText }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </section>
      </v-card-text>

      <v-card-actions class="vibe64-problem-report__actions">
        <template v-if="reference">
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="close">Done</v-btn>
        </template>
        <template v-else>
          <v-btn
            :disabled="!bundle || collecting"
            prepend-icon="$download"
            variant="text"
            data-vibe64-problem-report-download
            @click="download"
          >
            Download
          </v-btn>
          <v-btn
            :disabled="!bundle || collecting"
            :prepend-icon="copied ? '$check' : '$contentCopy'"
            variant="text"
            data-vibe64-problem-report-copy
            @click="copy"
          >
            {{ copied ? "Copied" : "Copy" }}
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="close">Cancel</v-btn>
          <v-btn
            v-if="delivery"
            :disabled="!draftId || collecting"
            :loading="sending"
            color="primary"
            prepend-icon="$send"
            variant="flat"
            data-vibe64-problem-report-send
            @click="send"
          >
            {{ delivery.label || "Send" }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import {
  PROBLEM_REPORT_LIMITS,
  problemReportFileName,
  problemReportText,
  withProblemReportNote
} from "@local/vibe64-core/shared/problemReport";
import { useProblemReport } from "@/composables/useProblemReport.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import { saveBlobAsFile } from "@/lib/vibe64AttachmentDownload.js";
import { describeProblemReport } from "@/lib/problemReportPresentation.js";
import { collectProblemReport, sendProblemReport } from "@/lib/problemReportRequests.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";

// Report a problem's dialog, once in the app's shell, which provides the page's Report a problem: it gathers a report
// of the page the person is on as they open it, shows what the report includes and the whole of it, and offers
// Download and Copy, and Send when the host delivers reports. Ticking the chat in or out gathers it again.
const { smAndDown } = useDisplay();
const route = useRoute();
const report = useProblemReport();
const open = computed(() => report.state.open);
// The session (and chat) of the view shown when the person opened the dialog.
const place = ref(null);

const note = ref("");
const includeChatChoice = ref(true);
const collecting = ref(false);
const sending = ref(false);
const error = ref("");
const copied = ref(false);
const bundle = ref(null);
const draftId = ref("");
const delivery = ref(null);
const reference = ref("");
const sentMessage = ref("");
const consentChoices = reactive({});
let collection = 0;

const consents = computed(() => (Array.isArray(delivery.value?.consents) ? delivery.value.consents : []));
const withNote = computed(() => (bundle.value ? withProblemReportNote(bundle.value, note.value) : null));
const reportText = computed(() => (withNote.value ? problemReportText(withNote.value) : ""));
const parts = computed(() => (bundle.value ? describeProblemReport(bundle.value) : []));
const hiddenLabel = computed(() => {
  const hidden = Number(withNote.value?.masking?.hidden || 0);
  return hidden === 1 ? "1 value hidden" : `${hidden} values hidden`;
});

function pageName() {
  const title = String(globalThis.document?.title || "").trim();
  return title || String(route?.name || "");
}

async function collect() {
  const current = ++collection;
  collecting.value = true;
  error.value = "";
  copied.value = false;
  try {
    const where = place.value;
    const answer = await collectProblemReport({
      projectSlug: projectSlugFromRoute(route),
      page: pageName(),
      route: String(route?.fullPath || globalThis.location?.pathname || ""),
      sessionId: where?.sessionId || "",
      chat: where?.chat || null,
      includeChat: includeChatChoice.value,
      errors: report.errors()
    });
    if (current !== collection) return;
    if (answer?.ok === false) throw new Error(answer.error || "The report could not be gathered.");
    bundle.value = answer.bundle;
    draftId.value = answer.draftId;
    delivery.value = answer.delivery || null;
    for (const consent of consents.value) {
      if (!(consent.id in consentChoices)) consentChoices[consent.id] = consent.default === true;
    }
  } catch (failure) {
    if (current !== collection) return;
    bundle.value = null;
    draftId.value = "";
    error.value = String(failure?.message || "") || "The report could not be gathered. Try again.";
  } finally {
    if (current === collection) collecting.value = false;
  }
}

function reset() {
  collection += 1;
  note.value = "";
  bundle.value = null;
  draftId.value = "";
  delivery.value = null;
  reference.value = "";
  sentMessage.value = "";
  error.value = "";
  copied.value = false;
  collecting.value = false;
  sending.value = false;
  for (const key of Object.keys(consentChoices)) delete consentChoices[key];
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  reset();
  place.value = report.place();
  includeChatChoice.value = report.state.includeChat;
  void collect();
}, { immediate: true });
watch(includeChatChoice, (_value, previous) => {
  if (open.value && previous !== undefined && bundle.value) void collect();
});

function close() {
  report.close();
  reset();
}

function download() {
  if (!withNote.value) return;
  saveBlobAsFile(new Blob([reportText.value], { type: "application/json" }), problemReportFileName(withNote.value));
}

async function copy() {
  try {
    await writeClipboardText(reportText.value);
    copied.value = true;
  } catch {
    error.value = "This browser would not copy. Use Download, or open Show the whole report and select its text.";
  }
}

async function send() {
  if (!draftId.value || sending.value) return;
  sending.value = true;
  error.value = "";
  try {
    const answer = await sendProblemReport({ draftId: draftId.value, note: note.value, consents: { ...consentChoices } });
    if (answer?.ok === false) throw new Error(answer.error || "The report could not be sent.");
    reference.value = String(answer.reference || "");
    sentMessage.value = String(answer.message || "");
  } catch (failure) {
    error.value = String(failure?.message || "") || "The report could not be sent. Download it instead, or try again.";
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
.vibe64-problem-report__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vibe64-problem-report__title h2 {
  font: inherit;
  margin: 0;
}

.vibe64-problem-report__collecting,
.vibe64-problem-report__review-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.vibe64-problem-report__review-head {
  justify-content: space-between;
}

.vibe64-problem-report__parts {
  margin: 8px 0 0;
  padding-left: 20px;
}

.vibe64-problem-report__json {
  max-height: 40vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.8125rem;
}

.vibe64-problem-report__actions {
  flex-wrap: wrap;
  gap: 4px;
}
</style>
