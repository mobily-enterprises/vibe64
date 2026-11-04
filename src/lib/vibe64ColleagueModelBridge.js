import { computed, inject, shallowRef } from "vue";

const VIBE64_COLLEAGUE_MODEL_KEY = Symbol("vibe64.colleague.model");
const NOT_OPEN = "Colleague is not open in this browser view.";

/**
 * A Colleague mounted in this browser view, as AI onboarding reads and changes its model.
 * select saves exactly that model for Colleague, as its model menu does. sayHello sends one
 * ordinary Colleague message and resolves with its reply, or with the failed turn's error,
 * within 15 seconds. reveal shows the conversation with its composer focused.
 * @typedef {{
 *   current: () => Promise<{ selection: object, engineLabel: string, modelLabel: string } | null>,
 *   select: (assistantSelection: object) => Promise<{ ok: true, selection: object, engineLabel: string, modelLabel: string } | { ok: false, error: string }>,
 *   sayHello: (message: string) => Promise<{ ok: true, reply: string } | { ok: false, error: string }>,
 *   reveal: () => Promise<unknown>
 * }} Vibe64ColleagueModelEntry
 */

/**
 * AI onboarding (accounts) reads and changes Colleague's model through the Colleague
 * mounted in this browser view; neither package imports the other. The host shell
 * provides one bridge; the newest mount wins and each mount removes only its own entry.
 */
function createVibe64ColleagueModelBridge() {
  /** @type {import("vue").ShallowRef<Vibe64ColleagueModelEntry[]>} */
  const registrations = shallowRef([]);
  // True while a Colleague is mounted.
  const available = computed(() => registrations.value.length > 0);
  const latest = () => registrations.value.at(-1) || null;

  /**
   * @param {Vibe64ColleagueModelEntry} entry
   * @returns {() => void} removes this entry
   */
  function register(entry) {
    registrations.value = [...registrations.value, entry];
    return () => { registrations.value = registrations.value.filter((item) => item !== entry); };
  }

  return {
    available,
    register,
    current: async () => (await latest()?.current()) || null,
    select: async (assistantSelection) => (await latest()?.select(assistantSelection)) || { ok: false, error: NOT_OPEN },
    sayHello: async (message) => (await latest()?.sayHello(message)) || { ok: false, error: NOT_OPEN },
    reveal: async () => { await latest()?.reveal(); }
  };
}

/**
 * The host shell's one Colleague model bridge, which Vibe64AssistantShellContext provides to every view.
 * @returns {import("@/types.js").Vibe64ColleagueModelBridge}
 */
function useVibe64ColleagueModel() {
  return inject(VIBE64_COLLEAGUE_MODEL_KEY);
}

export { VIBE64_COLLEAGUE_MODEL_KEY, createVibe64ColleagueModelBridge, useVibe64ColleagueModel };
