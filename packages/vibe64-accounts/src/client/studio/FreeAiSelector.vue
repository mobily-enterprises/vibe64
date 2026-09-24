<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiArrowRight,
  mdiCheckCircleOutline,
  mdiCodeBraces,
  mdiFlashOutline,
  mdiGiftOutline
} from "@mdi/js";

import { REGULAR_ZAI_STARTER } from "./freeAiStarters.js";

const props = defineProps({
  connections: {
    default: () => [],
    type: Array
  },
  error: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["retry", "select"]);
const { smAndDown } = useDisplay();

const choices = [
  {
    ...REGULAR_ZAI_STARTER,
    badge: "Optional",
    description: "Connect a regular Z.AI API key to use GLM-4.7 Flash through OpenCode, then review its suggested roles in Model routing.",
    facts: [
      "Free through Z.AI's regular API—not Coding Plan quota",
      "Existing model choices stay in place unless you change them",
      "Other regular-API models stay locked until you explicitly enable paid access"
    ],
    icon: mdiFlashOutline,
    recommended: true,
    summary: "Connect with Z.AI"
  },
  {
    accountAction: "Open Zen and create an optional API key",
    accountUrl: "https://opencode.ai/auth",
    badge: "Included",
    description: "Big Pickle is ready the moment you join—no account, key, or settings. A Zen key is needed only for the wider Zen catalogue.",
    facts: [
      "Big Pickle works from day one",
      "No key is needed for the included model",
      "A Zen key lets you check or enable more models"
    ],
    icon: mdiCodeBraces,
    id: "opencode",
    label: "Big Pickle · OpenCode Zen",
    recommended: false,
    summary: "Ready now, no setup"
  }
];

const connectedIds = computed(() => new Set(props.connections.map((connection) => (
  String(connection?.id || "")
))));
const choiceButtons = new Map();

function connected(choice) {
  return connectedIds.value.has(choice.id);
}

const visibleChoices = computed(() => {
  const missing = choices.filter((choice) => !connected(choice));
  return missing.length ? missing : choices;
});
const allChoicesConnected = computed(() => choices.every((choice) => connected(choice)));
const introduction = computed(() => {
  if (connectedIds.value.has("opencode") && !connectedIds.value.has("zai")) {
    return "Big Pickle is ready now. You can also connect GLM-4.7 Flash through Z.AI's regular API and choose its roles in Model routing.";
  }
  return allChoicesConnected.value
    ? "Big Pickle and GLM-4.7 Flash are available. Model routing controls which models your workflows use."
    : "Big Pickle needs no setup. You can also connect GLM-4.7 Flash through Z.AI's regular API.";
});

function focusOption(providerId = "") {
  choiceButtons.get(String(providerId || ""))?.$el?.focus?.();
}

function setChoiceButton(providerId, component) {
  if (component) {
    choiceButtons.set(providerId, component);
  } else {
    choiceButtons.delete(providerId);
  }
}

defineExpose({ focusOption });
</script>

<template>
  <section
    aria-labelledby="vibe64-free-ai-title"
    :class="['vibe64-free-ai', { 'vibe64-free-ai--compact': smAndDown }]"
  >
    <header class="vibe64-free-ai__intro">
      <v-avatar v-if="!smAndDown" color="primary" rounded="lg" size="56" variant="tonal">
        <v-icon :icon="mdiGiftOutline" size="30" />
      </v-avatar>
      <div>
        <p class="text-label-large text-primary">FREE FROM DAY ONE</p>
        <h2 id="vibe64-free-ai-title" class="text-headline-medium">Start with Big Pickle. Add models when you need them.</h2>
        <p class="text-body-large text-medium-emphasis">
          {{ introduction }}
        </p>
      </div>
    </header>

    <v-row v-if="loading" aria-busy="true" aria-label="Loading free AI choices" align="stretch">
      <v-col v-for="index in 2" :key="index" cols="12" md="6">
        <v-skeleton-loader
          class="vibe64-free-ai__skeleton fill-height"
          type="list-item-avatar-two-line, paragraph, paragraph, button"
        />
      </v-col>
    </v-row>

    <v-alert
      v-else-if="error"
      border="start"
      :text="error"
      title="Free AI choices could not load"
      type="error"
      variant="tonal"
    >
      <template #append>
        <v-btn type="button" variant="tonal" @click="emit('retry')">Try again</v-btn>
      </template>
    </v-alert>

    <v-row v-else align="stretch" justify="center">
      <v-col
        v-for="choice in visibleChoices"
        :key="choice.id"
        cols="12"
        :md="visibleChoices.length === 1 ? 8 : 6"
      >
        <v-card
          :color="choice.recommended ? 'primary' : 'secondary'"
          class="vibe64-free-ai__card fill-height"
          :elevation="choice.recommended ? 1 : 0"
          rounded="xl"
          variant="tonal"
        >
          <v-card-item>
            <div class="vibe64-free-ai__card-header">
              <v-avatar
                :color="choice.recommended ? 'primary' : 'secondary'"
                rounded="lg"
                size="56"
                variant="tonal"
              >
                <v-icon :icon="choice.icon" size="30" />
              </v-avatar>
              <div class="vibe64-free-ai__identity">
                <v-card-subtitle class="vibe64-free-ai__summary text-label-large">{{ choice.summary }}</v-card-subtitle>
                <v-card-title class="vibe64-free-ai__name text-title-large">{{ choice.label }}</v-card-title>
              </div>
              <div class="vibe64-free-ai__badges">
                <v-chip
                  v-if="connected(choice)"
                  color="success"
                  size="small"
                  variant="tonal"
                >
                  Connected
                </v-chip>
                <v-chip
                  :color="choice.recommended ? 'primary' : undefined"
                  size="small"
                  :variant="choice.recommended ? 'flat' : 'tonal'"
                >
                  {{ choice.badge }}
                </v-chip>
              </div>
            </div>
          </v-card-item>

          <v-card-text class="vibe64-free-ai__body">
            <p class="text-body-large">{{ choice.description }}</p>
            <ul class="vibe64-free-ai__facts text-body-medium">
              <li v-for="fact in choice.facts" :key="fact">
                <v-icon color="primary" :icon="mdiCheckCircleOutline" size="20" />
                <span>{{ fact }}</span>
              </li>
            </ul>
          </v-card-text>

          <v-card-actions class="vibe64-free-ai__actions">
            <v-btn
              :ref="(component) => setChoiceButton(choice.id, component)"
              :append-icon="mdiArrowRight"
              block
              class="vibe64-free-ai__action"
              :color="choice.recommended ? 'primary' : undefined"
              size="large"
              type="button"
              :variant="choice.recommended ? 'flat' : 'tonal'"
              @click="emit('select', choice)"
            >
              {{ connected(choice)
                ? (choice.id === 'zai' ? "Manage regular Z.AI API" : "View included Big Pickle")
                : (choice.id === 'zai' ? "Connect regular Z.AI API" : "Use included Big Pickle") }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <p class="vibe64-free-ai__note text-body-small text-medium-emphasis">
      Providers control availability, limits, and account requirements. Vibe64 verifies your key before saving it.
    </p>
  </section>
</template>

<style scoped>
.vibe64-free-ai {
  display: grid;
  gap: 1.5rem;
}

.vibe64-free-ai__intro {
  align-items: center;
  display: flex;
  gap: 1rem;
  max-width: 52rem;
}

.vibe64-free-ai__intro p,
.vibe64-free-ai__intro h2,
.vibe64-free-ai__body p,
.vibe64-free-ai__note {
  margin: 0;
}

.vibe64-free-ai__intro > div {
  display: grid;
  gap: 0.25rem;
}

.vibe64-free-ai__card,
.vibe64-free-ai__skeleton {
  min-height: 22rem;
}

.vibe64-free-ai__card {
  display: flex;
  flex-direction: column;
}

.vibe64-free-ai__card-header {
  align-items: center;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: 3.5rem minmax(0, 1fr) auto;
}

.vibe64-free-ai__identity {
  min-width: 0;
}

.vibe64-free-ai__summary,
.vibe64-free-ai__name {
  overflow: visible;
  padding: 0;
  text-overflow: clip;
  white-space: normal;
}

.vibe64-free-ai__badges {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.vibe64-free-ai__body {
  display: grid;
  flex: 1;
  gap: 1rem;
}

.vibe64-free-ai__facts {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.vibe64-free-ai__facts li {
  align-items: flex-start;
  display: flex;
  gap: 0.625rem;
}

.vibe64-free-ai__facts .v-icon {
  flex: 0 0 auto;
  margin-top: 0.1rem;
}

.vibe64-free-ai__actions {
  padding: 0 1rem 1rem;
}

.vibe64-free-ai__action {
  min-height: 3rem;
}

.vibe64-free-ai--compact .vibe64-free-ai__intro {
  align-items: flex-start;
}

.vibe64-free-ai--compact .vibe64-free-ai__card,
.vibe64-free-ai--compact .vibe64-free-ai__skeleton {
  min-height: 0;
}

.vibe64-free-ai--compact .vibe64-free-ai__card-header {
  grid-template-columns: 3.5rem minmax(0, 1fr);
}

.vibe64-free-ai--compact .vibe64-free-ai__badges {
  align-items: center;
  flex-direction: row;
  flex-wrap: wrap;
  grid-column: 1 / -1;
}
</style>
