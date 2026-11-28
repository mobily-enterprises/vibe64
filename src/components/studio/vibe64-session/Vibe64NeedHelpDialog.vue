<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { NEED_HELP_LIMITS, needHelpForwardText, needHelpSender } from "@local/vibe64-terminals/shared/needHelp";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64NeedHelpPresentation, vibe64SessionNeedHelp } from "@/lib/vibe64NeedHelp.js";

// A session's Need help: its messages, where it was sent, and the person's answer, follow-up or clear; or, without one,
// the person's own request for help.
const props = defineProps({
  session: { type: Object, required: true },
  sessionsApiPath: { type: String, required: true }
});
const emit = defineEmits(["close", "changed"]);
const flag = computed(() => vibe64SessionNeedHelp(props.session));
const now = ref(Date.now());
let clock = null;
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 30_000); });
onBeforeUnmount(() => clearInterval(clock));
const presentation = computed(() => vibe64NeedHelpPresentation(flag.value, now.value));
const forwardText = computed(() => needHelpForwardText(flag.value));
const text = ref("");
const pending = ref("");
const timeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const shownTime = (at) => timeFormatter.format(Date.parse(at));
// Capture the session and project for the lifetime of this dialog.
const path = vibe64SessionPath(props.sessionsApiPath, props.session.sessionId, "/need-help");
const message = computed(() => text.value.trim());
const tooLong = computed(() => message.value.length > NEED_HELP_LIMITS.messageCharacters);

function command(placementSource, method, suffix, fallbackRunError) {
  return useCommand({
    access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource,
    buildRawPayload: () => (method === "DELETE" ? {} : { text: message.value }),
    buildCommandOptions: () => ({ method, path: `${path}${suffix}` }),
    fallbackRunError, suppressSuccessMessage: true,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: method
  });
}
const commands = {
  raise: command("vibe64.sessions.need-help.raise", "POST", "", "Need help could not be raised."),
  answer: command("vibe64.sessions.need-help.answer", "POST", "/answer", "The answer could not be added."),
  clear: command("vibe64.sessions.need-help.clear", "DELETE", "", "Need help could not be cleared.")
};

async function run(name) {
  if (pending.value || (name !== "clear" && (!message.value || tooLong.value))) return;
  pending.value = name;
  try {
    await commands[name].run();
    text.value = "";
    emit("changed");
    if (name === "clear") emit("close");
  } catch {
    // useCommand has already shown the failure.
  } finally {
    pending.value = "";
  }
}
</script>

<template>
  <v-dialog
    aria-label="Need help"
    :model-value="true"
    max-width="36rem"
    scrollable
    :persistent="Boolean(pending)"
    @update:model-value="!$event && emit('close')"
  >
    <v-card rounded="xl" data-vibe64-need-help-dialog>
      <v-card-title class="pa-6 pb-2">
        <h2 class="text-title-large">Need help</h2>
      </v-card-title>
      <v-card-text class="px-6">
        <template v-if="flag">
          <v-alert
            v-if="presentation.stillOpen"
            class="mb-4"
            density="compact"
            type="warning"
            variant="tonal"
            role="status"
          >
            {{ presentation.title }}
          </v-alert>
          <p v-if="forwardText" class="text-body-medium mb-3">{{ forwardText }}</p>
          <ol class="studio-need-help__messages" aria-label="Need help messages">
            <li v-for="(entry, index) in flag.messages" :key="index" class="studio-need-help__message">
              <div class="text-label-large">
                {{ needHelpSender(entry) }} {{ entry.kind === "answer" ? "answered" : "asked" }} · {{ shownTime(entry.at) }}
              </div>
              <p class="text-body-medium studio-need-help__text">{{ entry.text }}</p>
            </li>
          </ol>
        </template>
        <p v-else class="text-body-medium mb-3">
          Ask for help with something this session can't fix itself, such as the platform, a service or access it lacks.
          Say what's wrong, what you tried and what you need.
        </p>
        <v-textarea
          v-model="text"
          :label="flag ? 'Your answer' : 'What\'s wrong, what you tried, what you need'"
          variant="outlined"
          rows="3"
          auto-grow
          :counter="NEED_HELP_LIMITS.messageCharacters"
          :error-messages="tooLong ? `Keep it to ${NEED_HELP_LIMITS.messageCharacters} characters.` : []"
          :disabled="Boolean(pending)"
          autofocus
        />
      </v-card-text>
      <v-card-actions class="pa-6 pt-2 flex-wrap ga-2">
        <v-btn
          v-if="flag"
          variant="text"
          :disabled="Boolean(pending)"
          :loading="pending === 'clear'"
          @click="run('clear')"
        >
          Clear
        </v-btn>
        <v-spacer />
        <v-btn variant="text" :disabled="Boolean(pending)" @click="emit('close')">Close</v-btn>
        <v-btn
          v-if="flag"
          variant="text"
          :disabled="!message || tooLong || Boolean(pending)"
          :loading="pending === 'raise'"
          @click="run('raise')"
        >
          Add to the request
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          rounded="pill"
          :disabled="!message || tooLong || Boolean(pending)"
          :loading="pending === (flag ? 'answer' : 'raise')"
          @click="run(flag ? 'answer' : 'raise')"
        >
          {{ flag ? "Answer" : "Ask for help" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.studio-need-help__messages {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}

.studio-need-help__message {
  border-inline-start: 3px solid rgb(var(--v-theme-outline-variant));
  padding-inline-start: 0.75rem;
}

.studio-need-help__text {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
</style>
