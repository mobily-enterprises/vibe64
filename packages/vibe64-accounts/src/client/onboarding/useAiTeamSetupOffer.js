import { computed, inject, ref, unref, watch } from "vue";
import { ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY } from "/src/lib/vibe64AssistantHost.js";
import { aiTeamSetupSnoozed, snoozeAiTeamSetup } from "./useAiOnboarding.js";

/**
 * Team setup: shown to the owner of a workspace with a team, once Claude is the
 * connected main AI and the team setup has no model yet; Not now waits a week.
 * Adding a DeepSeek key runs the DeepSeek connect step (inside Claude Code),
 * then fills the team setup; with DeepSeek already in Claude Code it fills at
 * once. Opened for the team (`focus` "team"), the card shows even when snoozed.
 * `teamFlow`: the connect step open is DeepSeek's for the team.
 * @param {{
 *   setup: import("./useAiOnboarding.js").AiOnboarding,
 *   manager: import("../composables/useAiConnectionManager.js").AiConnectionManager,
 *   cards: import("./useAiSetupCards.js").AiSetupCards["cards"],
 *   ownerRoles: import("./useAiSetupCards.js").AiSetupCards["ownerRoles"],
 *   ownerSenior: import("./useAiSetupCards.js").AiSetupCards["ownerSenior"],
 *   wasSetUp: import("vue").Ref<boolean>,
 *   canConfigure: import("vue").Ref<boolean>,
 *   focus: import("vue").Ref<string>,
 *   chosen: import("vue").Ref<object | null>,
 *   teamFlow: import("vue").Ref<boolean>,
 *   verifying: import("vue").Ref<boolean>,
 *   warning: import("vue").Ref<string>,
 *   announcement: import("vue").Ref<string>,
 *   connect: (card: object, step?: string) => void,
 *   go: (next: string, back?: boolean) => void
 * }} options
 */
function useAiTeamSetupOffer({
  setup,
  manager,
  cards,
  ownerRoles,
  ownerSenior,
  wasSetUp,
  canConfigure,
  focus,
  chosen,
  teamFlow,
  verifying,
  warning,
  announcement,
  connect,
  go
}) {
  /** @type {import("/src/lib/vibe64AssistantHost.js").AssistantViewerSource} */
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, LOCAL_ASSISTANT_VIEWER);
  // The team card: snoozed, filling the team setup, and its outcome.
  const teamSnoozed = ref(false);
  const teamBusy = ref(false);
  const teamError = ref("");
  const teamSummary = ref("");
  const team = computed(() => setup.routing?.team.value || { available: false });
  const deepseekCard = computed(() => cards.value.find(({ id }) => id === "deepseek"));
  const deepseekInClaude = computed(() => Boolean(deepseekCard.value?.through.includes("claude")));
  const teamUnset = computed(() => Boolean(ownerRoles.value) &&
    ASSISTANT_SETUP_ROLES.nonOwner.every((role) => !setup.routing.setups.value.nonOwner?.roles?.[role]?.configured));
  const claudeMain = computed(() => ownerSenior.value?.engineId === "claude" && ownerSenior.value.modelProviderId === "anthropic" &&
    setup.routing?.viewerDecisions.value.senior?.available === true);
  const teamCardState = computed(() => {
    if (!canConfigure.value || !wasSetUp.value) return "";
    if (teamSummary.value) return "ready";
    return team.value.available && claudeMain.value && teamUnset.value && (!teamSnoozed.value || focus.value === "team") ? "offer" : "";
  });
  watch(() => unref(viewer)?.actorKey, (actorKey) => { teamSnoozed.value = aiTeamSetupSnoozed(actorKey); }, { immediate: true });

  /** Not now: the offer waits a week for this viewer. */
  function snoozeTeam() {
    snoozeAiTeamSetup(unref(viewer)?.actorKey);
    teamSnoozed.value = true;
  }

  /** Add a DeepSeek key: its connect step, or the team setup at once when DeepSeek is in Claude Code. */
  function startTeamSetup() {
    teamError.value = "";
    if (deepseekInClaude.value) return fillTeam();
    connect(deepseekCard.value, "have");
    teamFlow.value = true;
  }

  /** Fills the team setup with DeepSeek inside Claude Code. */
  async function fillTeam() {
    teamBusy.value = true;
    try {
      const result = await setup.fillTeamSetup({ modelProviderId: "deepseek", engineId: "claude" });
      teamSummary.value = result.ok ? result.summary : "";
      teamError.value = result.ok ? "" : result.error;
      if (result.ok) announcement.value = "Team AI is ready.";
      return result;
    } finally {
      teamBusy.value = false;
    }
  }

  /** The DeepSeek connect step's finish: fill the team setup and return to the overview. */
  async function finishTeam() {
    verifying.value = true;
    warning.value = "";
    try {
      await setup.reload();
      if (!deepseekInClaude.value) {
        warning.value = "DeepSeek isn't connected in Claude Code yet. Finish the connection step, then try again.";
        return;
      }
      const result = await fillTeam();
      if (!result.ok) {
        warning.value = result.error;
        return;
      }
      teamFlow.value = false;
      chosen.value = null;
      go("choose", true);
    } finally {
      verifying.value = false;
    }
  }

  watch(() => manager.teamKeyRequests.value, startTeamSetup);

  return {
    deepseekInClaude,
    finishTeam,
    snoozeTeam,
    startTeamSetup,
    team,
    teamBusy,
    teamCardState,
    teamError,
    teamSummary
  };
}

export { useAiTeamSetupOffer };
