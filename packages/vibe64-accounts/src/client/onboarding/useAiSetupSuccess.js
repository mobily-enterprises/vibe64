import { computed, ref, unref, watch } from "vue";
import { usesProvider } from "./useAiOnboarding.js";

/**
 * What success says about Colleague. Colleague either uses the choice, and
 * proves it answers with a reply to a hello, or can switch to it, or isn't open
 * here. In Learn mode (`learning`, the Learning controller, if any) Colleague's
 * conversation is the teacher's: no hello goes into it, and the teacher uses the
 * choice from the next message; done returns to the lesson or to Learn. Develop
 * is as ever.
 * @param {{
 *   setup: import("./useAiOnboarding.js").AiOnboarding,
 *   learning: import("/src/types.js").Vibe64Learning,
 *   screen: import("vue").Ref<string>,
 *   chosen: import("vue").Ref<object | null>,
 *   outcome: import("vue").Ref<{ routed: boolean, colleague: object | null, error: string }>,
 *   verifying: import("vue").Ref<boolean>,
 *   announcement: import("vue").Ref<string>
 * }} options
 */
function useAiSetupSuccess({ setup, learning, screen, chosen, outcome, verifying, announcement }) {
  // Colleague's reply to a hello ("", "waiting", "replied", "failed" or "dismissed").
  const hello = ref({ state: "", reply: "", error: "" });
  const colleagueNote = computed(() => usesProvider(outcome.value.colleague, chosen.value) ? "uses"
    : setup.colleagueAvailable.value ? "switch" : "menu");
  const learn = computed(() => Boolean(unref(learning)?.learnMode));
  const inLesson = computed(() => learn.value && Boolean(unref(learning)?.mode?.currentAttemptId));
  const doneLabel = computed(() => inLesson.value ? "Continue the lesson" : learn.value ? "Continue in Learn" : "Start building");
  // The check waits for Colleague's hello when there is one to wait for.
  const proven = computed(() => colleagueNote.value !== "uses" || learn.value ||
    ["replied", "dismissed"].includes(hello.value.state));

  // Success proves Colleague answers when it runs on the chosen provider.
  watch(() => screen.value === "success" && colleagueNote.value === "uses", (proving) => {
    if (proving && !learn.value && !hello.value.state) sayHello();
  });

  /** Asks Colleague for a hello on the chosen provider. */
  async function sayHello() {
    hello.value = { state: "waiting", reply: "", error: "" };
    const result = await setup.sayHello();
    hello.value = result?.ok ? { state: "replied", reply: result.reply, error: "" }
      : { state: "failed", reply: "", error: result?.error || "No reply." };
    announcement.value = result?.ok ? `${chosen.value.name} is ready.` : `Colleague couldn't reach ${chosen.value.name}.`;
  }

  /** Moves Colleague onto the chosen provider. */
  async function switchColleague() {
    verifying.value = true;
    try {
      const { selection = outcome.value.colleague, error = "" } = await setup.selectForColleague(chosen.value);
      outcome.value = { ...outcome.value, colleague: selection, error };
    } finally {
      verifying.value = false;
    }
  }

  return {
    colleagueNote,
    doneLabel,
    hello,
    inLesson,
    learn,
    proven,
    sayHello,
    switchColleague
  };
}

export { useAiSetupSuccess };
