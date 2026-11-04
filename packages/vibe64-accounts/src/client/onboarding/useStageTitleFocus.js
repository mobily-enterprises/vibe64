import { nextTick, ref } from "vue";

/**
 * An onboarding stage's element and the focus each new screen takes: once the screen is in, its title takes focus
 * without scrolling, so a screen reader reads it.
 */
function useStageTitleFocus() {
  /** @type {import("vue").Ref<HTMLElement | null>} */
  const stage = ref(null);

  function focusTitle() {
    nextTick(() => stage.value?.querySelector("h1")?.focus({ preventScroll: true }));
  }

  return { focusTitle, stage };
}

export { useStageTitleFocus };
