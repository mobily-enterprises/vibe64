import { computed, inject, provide, ref } from "vue";
import { aiOnboardingRows, usesProvider } from "./useAiOnboarding.js";
import { useAiSetupTools } from "./useAiSetupTools.js";

const AI_SETUP_CARDS_KEY = Symbol("vibe64.aiSetupCards");

/**
 * The provider cards of the AI setup's overview: their order, which one is the
 * main AI, what each one offers next, the AI tool behind it, and how it looks.
 * Configured connections no card shows count as connected and are managed under
 * Advanced. `active`: the setup is open to someone who may configure AI.
 */
function useAiSetupCards({ setup, manager, wasSetUp, xs, active }) {
  const { cardTool, checkingTools, checkTools, installOpen, neededTool, toggleInstall, toolReady } = useAiSetupTools({ setup, active });
  // Phone: the one lower-ranked card that is open.
  const expandedId = ref("");
  const cards = computed(() => setup.cards.value);
  const featured = computed(() => cards.value.find((card) => card.crown));
  const others = computed(() => cards.value.filter((card) => !card.crown));
  const connectedCards = computed(() => cards.value.filter((card) => card.connected));
  // A configured setup leads with the cards it uses: connected or needing reconnection, then the rest by rank.
  const orderedCards = computed(() => {
    const ranked = [featured.value, ...others.value];
    return wasSetUp.value ? [...ranked.filter(configured), ...ranked.filter((card) => !configured(card))] : ranked;
  });
  // Configured connections no card shows (OpenCode Zen, other catalog providers).
  const otherRows = computed(() => manager.configuredAiRows.value
    .filter((row) => !cards.value.some((card) => [card, card.free].some((item) => item && aiOnboardingRows(item, [row]).length))));
  const otherConnected = computed(() => [...new Set(otherRows.value.filter((row) => row.connected !== false).map((row) => row.providerLabel))]);
  // The strip names every connected provider; those without a card share one "+N" mark.
  const currentMarks = computed(() => [...connectedCards.value, ...(otherConnected.value.length
    ? [{ id: "other", mark: `+${otherConnected.value.length}`, shape: "circle", tone: "neutral" }] : [])]);
  const currentNames = computed(() => [...connectedCards.value.map(({ name }) => name), ...otherConnected.value]);
  // Main AI: the card of the owner's Senior. Until the AI setup is read, which
  // card is main is unknown, so connected cards offer no switch yet.
  const ownerRoles = computed(() => setup.routing?.setups.value?.owner?.roles || null);
  const ownerSenior = computed(() => ownerRoles.value?.senior?.effective || null);
  const mainKnown = computed(() => Boolean(ownerRoles.value || setup.routing?.loadError.value));
  const mainAi = computed(() => setup.mainAi?.value?.card.connected ? setup.mainAi.value : null);
  const mainCard = computed(() => mainAi.value?.card || null);
  const noToolHere = computed(() => !wasSetUp.value && cards.value.every((card) => installFirst(card)));
  // The best card whose tool is ready, when the recommended one still needs installing.
  const readyHere = computed(() => !wasSetUp.value && installFirst(featured.value)
    ? orderedCards.value.find((card) => toolReady(card) && cardAction(card) === "get") || null : null);

  /** The card's configured connections, working or not. */
  function cardRows(card) {
    return card ? aiOnboardingRows(card, manager.configuredAiRows.value) : [];
  }

  /** Cards with connections of their own or of their free option. */
  function configured(card) {
    return card.connected || cardRows(card).length > 0 || cardRows(card.free).length > 0;
  }

  /** Configured but none of its connections works any more. */
  function needsReconnect(card) {
    const rows = cardRows(card);
    return rows.length > 0 && !rows.some((row) => row.kind === "opencode" ? row.connected !== false : row.connected === true);
  }

  /** Cards whose tool is missing are greyed and lead with installing it, then subscribing, then signing in. */
  function installFirst(item) {
    const tool = cardTool(item);
    return tool && tool.status !== "ready" && !needsReconnect(item) ? tool : null;
  }

  /** What the card offers next: get it, reconnect it, wait for the main AI, keep it or make it the main AI. */
  function cardAction(card) {
    if (!card.connected) return needsReconnect(card) ? "reconnect" : "get";
    if (!wasSetUp.value) return "get";
    if (!mainKnown.value) return "checking";
    return usesProvider(ownerSenior.value, card) ? "keep" : "main";
  }

  /** Notes point the person to Claude; a connected card in a redo no longer sells itself. */
  function cardNote(card) {
    if (cardAction(card) === "reconnect") return "";
    if (wasSetUp.value && card.connected) return "";
    return card.crown && wasSetUp.value && connectedCards.value.length ? card.upgrade : card.note;
  }

  /** The card's look: featured, connected, needing reconnection or its tool, collapsed or installing. */
  function cardClass(card) {
    return { "aio-card--featured": card.crown, "aio-card--connected": card.connected,
      "aio-card--reconnect": cardAction(card) === "reconnect", "aio-card--collapsed": !expanded(card),
      "aio-card--needs-tool": cardAction(card) === "get" && Boolean(installFirst(card)), "aio-card--installing": installOpen.value === card.id };
  }

  /** The connected card's badge. */
  function connectedLabel(card) {
    return cardAction(card) === "keep" ? "Connected · in use" : "Connected";
  }

  /** Phone: lower-ranked cards collapse to a row, one open at a time; connected ones stay open. */
  function collapsible(card) {
    return xs.value && !card.crown && !configured(card);
  }

  /** Whether the card shows more than its head. */
  function expanded(card) {
    return !collapsible(card) || expandedId.value === card.id;
  }

  /** Opens a collapsed card, closing the one open before; opening it again closes it. */
  function toggleExpanded(card) {
    if (collapsible(card)) expandedId.value = expandedId.value === card.id ? "" : card.id;
  }

  return {
    cardAction,
    cardClass,
    cardNote,
    cardRows,
    cards,
    cardTool,
    checkingTools,
    checkTools,
    collapsible,
    configured,
    connectedLabel,
    currentMarks,
    currentNames,
    expanded,
    expandedId,
    installFirst,
    installOpen,
    mainAi,
    mainCard,
    neededTool,
    noToolHere,
    orderedCards,
    otherRows,
    ownerRoles,
    ownerSenior,
    readyHere,
    toggleExpanded,
    toggleInstall,
    toolReady
  };
}

/** The setup's cards, provided for its card parts. */
function provideAiSetupCards(setupCards) {
  provide(AI_SETUP_CARDS_KEY, setupCards);
  return setupCards;
}

/** The cards its setup provided. */
function injectAiSetupCards() {
  return inject(AI_SETUP_CARDS_KEY);
}

export { injectAiSetupCards, provideAiSetupCards, useAiSetupCards };
