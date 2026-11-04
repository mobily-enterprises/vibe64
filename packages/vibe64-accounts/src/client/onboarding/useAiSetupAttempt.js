import { ref } from "vue";
import { usesProvider } from "./useAiOnboarding.js";

/**
 * One attempt at a provider in the AI setup: choosing it, its connect step, the routing decision finishing may need,
 * and the outcome success shows. A new choice starts a new attempt.
 * @param {{
 *   setup: import("./useAiOnboarding.js").AiOnboarding,
 *   screen: import("vue").Ref<string>,
 *   go: (next: string, back?: boolean) => void,
 *   wasSetUp: import("vue").Ref<boolean>,
 *   firstRun: import("vue").Ref<boolean>,
 *   chosen: import("vue").Ref<object | null>,
 *   verifying: import("vue").Ref<boolean>,
 *   outcome: import("vue").Ref<{ routed: boolean, colleague: object | null, error: string }>,
 *   announcement: import("vue").Ref<string>,
 *   hello: import("vue").Ref<{ state: string, reply: string, error: string }>,
 *   routingForm: import("vue").Ref<{ applySuggested: () => Promise<unknown> } | null>
 * }} options
 */
function useAiSetupAttempt({ setup, screen, go, wasSetUp, firstRun, chosen, verifying, outcome, announcement, hello, routingForm }) {
  // How step 1 stands: "" (not yet), "opened" (sign-up page opened) or "have".
  const signUp = ref("");
  const warning = ref("");
  const notReady = ref(false);
  const makeMain = ref(false);
  const routingReviewed = ref(false);
  const fullRouting = ref(false);
  const routingDetails = ref(false);
  // The Senior model in use when routing would change; none means apply without asking.
  const currentSenior = ref(null);
  // The tool the chosen provider is connected through, which "Use as main AI" keeps.
  const chosenEngine = ref("");
  // The connect step open is DeepSeek's, started from the team card.
  const teamFlow = ref(false);
  const autoRouting = ref(false);

  function resetAttempt() {
    teamFlow.value = false;
    warning.value = "";
    chosenEngine.value = "";
    notReady.value = false;
    makeMain.value = false;
    routingReviewed.value = false;
    fullRouting.value = false;
    routingDetails.value = false;
    autoRouting.value = false;
    hello.value = { state: "", reply: "", error: "" };
  }

  function connect(card, step = "") {
    chosen.value = card;
    signUp.value = step;
    resetAttempt();
    go("connect");
  }

  function makeMainAi(card) {
    chosen.value = card;
    resetAttempt();
    makeMain.value = true;
    return finishAttempt();
  }

  function keep(card) {
    chosen.value = card;
    resetAttempt();
    return finishAttempt({ keep: true });
  }

  // Success needs the provider connected, a Senior model of it ready and, on a
  // known first setup or an explicit switch, Colleague moved onto that provider.
  async function finishAttempt({ keep: keeping = false } = {}) {
    const card = chosen.value;
    verifying.value = true;
    warning.value = "";
    notReady.value = false;
    try {
      const [result, current] = await Promise.all([setup.verify(card), setup.refreshColleague()]);
      if (!result.connected) {
        warning.value = `${card.name} isn't connected yet. Finish the connection step, then try again.`;
        if (screen.value !== "connect") go("connect");
        return;
      }
      chosenEngine.value = result.engineId;
      if (wasSetUp.value && !keeping && !routingReviewed.value && result.routingWouldChange) {
        currentSenior.value = result.currentSenior;
        autoRouting.value = !result.currentSenior;
        go("routing");
        return;
      }
      if (!result.available) {
        notReady.value = true;
        if (screen.value !== "connect") go("connect");
        announcement.value = `${card.name} is connected, but no model is ready for Colleague yet.`;
        return;
      }
      let colleague = current;
      let error = "";
      if ((firstRun.value || makeMain.value) && !usesProvider(colleague, card)) {
        ({ selection: colleague = colleague, error = "" } = await setup.selectForColleague(card));
      }
      outcome.value = { routed: result.routed, colleague, error };
      go("success");
    } catch (error) {
      warning.value = error?.message || "We couldn't check the connection. Try again.";
    } finally {
      verifying.value = false;
    }
  }

  function reviewRouting() {
    fullRouting.value = true;
    go("routing");
  }

  // "Use" saves the routing suggestions through the routing form; a failed save
  // leaves the form open with its errors.
  async function useAsMain() {
    makeMain.value = true;
    await routingForm.value?.applySuggested();
    if (screen.value !== "routing") return;
    autoRouting.value = false;
    routingDetails.value = true;
  }

  return {
    autoRouting,
    chosenEngine,
    connect,
    currentSenior,
    finishAttempt,
    fullRouting,
    keep,
    makeMain,
    makeMainAi,
    notReady,
    resetAttempt,
    reviewRouting,
    routingDetails,
    routingReviewed,
    signUp,
    teamFlow,
    useAsMain,
    warning
  };
}

export { useAiSetupAttempt };
