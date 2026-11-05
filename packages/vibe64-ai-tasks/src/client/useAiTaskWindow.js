import { computed, ref, toValue, watch } from "vue";

const WINDOW_QUERY = "aiTask";

/**
 * Which task's window is open. The address holds it, so a reload reopens it and Back hides it;
 * the view the person chose stays theirs and never switches by itself.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<import("./types.js").AiTask | null>} options.task
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.loaded
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.active whether this session is the one on screen
 * @param {import("vue").MaybeRefOrGetter<"progress"|"chat">} options.opensOn
 * @param {import("vue-router").RouteLocationNormalizedLoaded} options.route
 * @param {import("vue-router").Router} options.router
 */
function useAiTaskWindow({ task, loaded, active, opensOn, route, router }) {
  const view = ref("progress");
  const transcriptOpen = ref(false);
  let pushedStep = false;
  let opener = null;

  const wanted = computed(() => String(route.query[WINDOW_QUERY] || ""));
  const open = computed(() => toValue(active) && Boolean(wanted.value) && toValue(task)?.id === wanted.value);

  function withoutWindow() {
    const { [WINDOW_QUERY]: _taskId, ...query } = route.query;
    return { path: route.path, query, hash: route.hash };
  }

  /**
   * @param {HTMLElement | null} [element] what focus returns to
   * @returns {Promise<void>} settles once the address has the window open, or has refused it
   */
  async function show(element = null) {
    const current = toValue(task);
    if (!current) return;
    opener = element;
    if (open.value) return;
    pushedStep = true;
    await router.push({ path: route.path, query: { ...route.query, [WINDOW_QUERY]: current.id }, hash: route.hash });
  }

  function hide() {
    if (!wanted.value) return;
    if (pushedStep) {
      pushedStep = false;
      router.back();
      return;
    }
    void router.replace(withoutWindow());
  }

  function setView(next) {
    view.value = next;
  }

  /** The window reopens where the task needs the person, then stays where they put it. */
  watch(open, (isOpen) => {
    if (!isOpen) return;
    view.value = toValue(opensOn);
    transcriptOpen.value = false;
  }, { immediate: true });

  // An address naming a task that has gone opens nothing.
  watch(() => [wanted.value, toValue(loaded), toValue(task)?.id, toValue(active)], () => {
    if (wanted.value && toValue(active) && toValue(loaded) && toValue(task)?.id !== wanted.value) {
      pushedStep = false;
      void router.replace(withoutWindow());
    }
  }, { immediate: true });

  return {
    hide,
    open,
    opener: () => (opener?.isConnected ? opener : null),
    setView,
    show,
    transcriptOpen,
    view
  };
}

export { useAiTaskWindow };
