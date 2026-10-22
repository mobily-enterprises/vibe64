<script>
// Auto-open happens at most once per page load, across remounts.
let autoOpened = false;
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AiOnboarding from "./AiOnboarding.vue";
import { aiOnboardingAvailable, aiOnboardingNeeded, onVibe64AiOnboardingRequested } from "./aiOnboardingEvents.js";
import { aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding } from "./useAiOnboarding.js";

const props = defineProps({
  // AI connections endpoint; standalone uses the default.
  endpoint: { type: String, default: "" },
  canConfigure: Boolean,
  actorKey: { type: String, default: "local" },
  // Passed to the setup screen, with its connection-access slot.
  ownerNotice: { type: String, default: undefined },
  changeWhere: { type: String, default: undefined }
});
const route = useRoute();
const onboarding = useAiOnboarding({ endpoint: props.endpoint, enabled: computed(() => props.canConfigure) });
const open = ref(false);
const start = ref("why");
const redo = ref(false);
let opener = null;
let request = null;

// Learning owns its own first-run guidance; checked by route, without Learning imports.
const inLearning = computed(() => String(route?.path || "").startsWith("/app/learning") || route?.query?.mode === "learning");
const needed = computed(() => props.canConfigure && onboarding.loaded.value && !onboarding.isSetUp.value);

function show(screen, detail = null) {
  opener = document.activeElement;
  request = detail;
  start.value = screen;
  redo.value = detail?.redo === true;
  open.value = true;
}

watch(needed, (value) => { aiOnboardingNeeded.value = value; }, { immediate: true });
watch(() => props.canConfigure, (value) => { aiOnboardingAvailable.value = value; }, { immediate: true });
watch([needed, inLearning], () => {
  if (autoOpened || open.value || !needed.value || inLearning.value || aiOnboardingSnoozed(props.actorKey) ||
    document.querySelector(".v-dialog.v-overlay--active")) return;
  autoOpened = true;
  show("why");
}, { immediate: true });

const stopListening = onVibe64AiOnboardingRequested((event) => show(event.detail?.start || "choose", event.detail));
onBeforeUnmount(() => {
  stopListening();
  aiOnboardingNeeded.value = false;
  aiOnboardingAvailable.value = false;
});

// done continues in Colleague, which just said hello.
async function close(reason) {
  if (reason === "later") snoozeAiOnboarding(props.actorKey);
  open.value = false;
  await nextTick();
  if (reason === "done" && onboarding.colleagueAvailable.value) await onboarding.revealColleague();
  else {
    // The opener may have left with its menu or dialog; listeners name a stand-in.
    const target = request?.returnFocus || opener;
    if (target?.isConnected !== false) target?.focus?.({ preventScroll: true });
  }
  opener = null;
  request = null;
}
</script>

<template>
  <AiOnboarding
    :open="open" :start="start" :redo="redo" :onboarding="onboarding" :can-configure="canConfigure"
    :endpoint="endpoint" :owner-notice="ownerNotice" :change-where="changeWhere" @close="close"
  >
    <template v-for="(_, name) in $slots" #[name]="scope"><slot :name="name" v-bind="scope || {}" /></template>
  </AiOnboarding>
</template>
