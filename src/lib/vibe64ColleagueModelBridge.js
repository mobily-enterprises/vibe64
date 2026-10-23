import { computed, shallowRef } from "vue";

// AI onboarding (accounts) reads and changes Colleague's model through the
// Colleague mounted in this browser view; neither package imports the other.
// The newest mount wins; each mount removes only its own registration.
//   current() -> { selection, engineLabel, modelLabel } | null
//   select(assistantSelection)
//     -> { ok: true, selection, engineLabel, modelLabel } | { ok: false, error }
// select saves exactly that model for Colleague, as its model menu does.
//   sayHello(message) -> { ok: true, reply } | { ok: false, error }
// sayHello sends one ordinary Colleague message and resolves with its reply, or
// with the failed turn's error, within 15 seconds.
//   reveal() shows the conversation with its composer focused.
const registrations = shallowRef([]);
const available = computed(() => registrations.value.length > 0);
const NOT_OPEN = "Colleague is not open in this browser view.";

function registerVibe64ColleagueModel(entry) {
  registrations.value = [...registrations.value, entry];
  return () => { registrations.value = registrations.value.filter((item) => item !== entry); };
}

function useVibe64ColleagueModel() {
  const latest = () => registrations.value.at(-1) || null;
  return {
    // A computed ref: true while a Colleague is mounted.
    available,
    current: async () => (await latest()?.current()) || null,
    select: async (assistantSelection) => (await latest()?.select(assistantSelection)) || { ok: false, error: NOT_OPEN },
    sayHello: async (message) => (await latest()?.sayHello(message)) || { ok: false, error: NOT_OPEN },
    reveal: async () => { await latest()?.reveal?.(); }
  };
}

export { registerVibe64ColleagueModel, useVibe64ColleagueModel };
