import { computed, inject, ref, unref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

/**
 * One pass as the chat lists it: Genesis's pass with its last completed run in this project (lastRun,
 * an ISO time, or null when it never ran) and the commits since.
 * @typedef {{ id: string, title: string, description: string, recommend: { when: string, hint: string }, request: string,
 *   lastRun: string | null, commitsSince: number | null, snoozedUntil: string, dismissed: boolean }} Vibe64Pass
 */

/**
 * The chat's Passes: the passes Genesis offers, the one the server's rule suggests now, Run, and the
 * suggestion's Later and Dismiss. Run sends the pass to Main chat as the person's own message; nothing
 * here ever runs a pass by itself.
 * @param {{
 *   session: import("vue").MaybeRefOrGetter<object | null>,
 *   sessionsApiPath: import("vue").MaybeRefOrGetter<string>,
 *   enabled: import("vue").MaybeRefOrGetter<boolean>,
 *   idle: import("vue").MaybeRefOrGetter<boolean>,
 *   send: (input: object) => Promise<unknown> | unknown
 * }} options idle is true while Main chat has no turn running; the list is read again each time it
 *   becomes idle, as a finished turn may have run a pass or added commits.
 */
function useVibe64Passes({ session, sessionsApiPath, enabled, idle, send }) {
  const projectSlug = useVibe64ProjectSlug();
  /** @type {import("@/lib/vibe64AssistantHost.js").AssistantViewerSource} */
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, LOCAL_ASSISTANT_VIEWER);
  const actorKey = computed(() => unref(viewer)?.actorKey || "");
  const sessionId = computed(() => readRefOrGetterValue(session)?.sessionId || "");
  const sessionsPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));
  const path = computed(() => vibe64SessionPath(sessionsPath.value, sessionId.value, "/passes"));
  const readable = computed(() => readRefOrGetterValue(enabled) && Boolean(sessionId.value && sessionsPath.value && actorKey.value));
  const resource = useEndpointResource({
    enabled: readable,
    path,
    queryKey: computed(() => ["vibe64-passes", projectSlug.value, sessionsPath.value, sessionId.value, actorKey.value]),
    fallbackLoadError: "Passes could not be loaded.",
    queryOptions: { meta: { jskit: { requestRecovery: false } }, retry: false, refetchOnWindowFocus: false }
  });
  watch(() => readRefOrGetterValue(idle), (now, before) => {
    if (now && before === false && readable.value) void resource.reload();
  });
  /** @type {import("vue").ComputedRef<Vibe64Pass[]>} */
  const passes = computed(() => resource.data.value?.passes || []);
  const recommendation = computed(() => passes.value.find(({ id }) => id === resource.data.value?.recommendation) || null);
  const starting = ref("");
  const changing = ref("");
  const error = ref("");

  /**
   * Starts a pass with its default request from Genesis, as if the person had sent it: it shows in
   * the chat, Stop ends it, and Main chat refuses it while a turn or goal is running.
   * @param {Vibe64Pass} pass
   */
  async function run(pass) {
    if (starting.value) return false;
    starting.value = pass.id;
    error.value = "";
    try {
      const result = await send({ message: pass.request, genesisTask: pass.id, submissionKind: "send" });
      if (result === false || result?.ok === false) throw new Error(result?.error || `${pass.title} did not start.`);
      return true;
    } catch (failure) {
      error.value = failure?.message || `${pass.title} did not start.`;
      return false;
    } finally {
      starting.value = "";
      void resource.reload();
    }
  }

  /**
   * @param {Vibe64Pass} pass
   * @param {"snooze" | "dismiss"} action Later hides the suggestion for a week; Dismiss until the pass runs again.
   */
  async function changeRecommendation(pass, action) {
    if (changing.value) return;
    changing.value = action;
    error.value = "";
    try {
      const result = await resource.save({ passId: pass.id, action }, { path: `${path.value}/recommendation`, method: "POST" });
      if (result?.ok === false) throw new Error(result.error || "The suggestion could not be changed.");
      await resource.reload();
    } catch (failure) {
      error.value = failure?.message || "The suggestion could not be changed.";
    } finally {
      changing.value = "";
    }
  }

  return {
    passes,
    recommendation,
    loading: resource.isLoading,
    loadError: resource.loadError,
    starting,
    changing,
    error,
    run,
    snooze: (pass) => changeRecommendation(pass, "snooze"),
    dismiss: (pass) => changeRecommendation(pass, "dismiss"),
    reload: () => resource.reload()
  };
}

export { useVibe64Passes };
