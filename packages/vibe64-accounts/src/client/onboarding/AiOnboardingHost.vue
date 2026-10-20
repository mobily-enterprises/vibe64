<script>
// Auto-open happens at most once per page load, across remounts.
let autoOpened = false;
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AiOnboarding from "./AiOnboarding.vue";
import { aiOnboardingNeeded, onVibe64AiOnboardingRequested } from "./aiOnboardingEvents.js";
import { aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding } from "./useAiOnboarding.js";

const props = defineProps({
  // Hosted AI connections endpoint; standalone uses the default.
  endpoint: { type: String, default: "" },
  canConfigure: Boolean,
  actorKey: { type: String, default: "local" }
});
const route = useRoute();
const onboarding = useAiOnboarding({ endpoint: props.endpoint, enabled: computed(() => props.canConfigure) });
const open = ref(false);
const start = ref("why");
const redo = ref(false);
let opener = null;

// Learning owns its own first-run guidance; checked by route, without Learning imports.
const inLearning = computed(() => String(route?.path || "").startsWith("/app/learning") || route?.query?.mode === "learning");
const needed = computed(() => props.canConfigure && onboarding.loaded.value && !onboarding.isSetUp.value);

function show(screen, isRedo = false) {
  opener = document.activeElement;
  start.value = screen;
  redo.value = isRedo;
  open.value = true;
}

watch(needed, (value) => { aiOnboardingNeeded.value = value; }, { immediate: true });
watch([needed, inLearning], () => {
  if (autoOpened || open.value || !needed.value || inLearning.value || aiOnboardingSnoozed(props.actorKey) ||
    document.querySelector(".v-dialog.v-overlay--active")) return;
  autoOpened = true;
  show("why");
}, { immediate: true });

const stopListening = onVibe64AiOnboardingRequested((event) => show(event.detail?.start || "choose", event.detail?.redo === true));
onBeforeUnmount(() => {
  stopListening();
  aiOnboardingNeeded.value = false;
});

async function close(reason) {
  if (reason === "later") snoozeAiOnboarding(props.actorKey);
  open.value = false;
  await nextTick();
  opener?.focus?.({ preventScroll: true });
  opener = null;
}
</script>

<template>
  <AiOnboarding
    :open="open" :start="start" :redo="redo" :onboarding="onboarding" :can-configure="canConfigure"
    :workspace="Boolean(endpoint)" @close="close"
  />
</template>
