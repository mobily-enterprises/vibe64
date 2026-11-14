import { computed, inject, ref, unref, watch } from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { LOCAL_ASSISTANT_VIEWER, VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

/**
 * One run Genesis offers for a pass: its button's label and the request Run sends verbatim; a
 * deep run also carries the files and lines it reads, which its label shows.
 * @typedef {{ id: string, label: string, request: string, files?: number, lines?: number }} Vibe64PassRun
 */

/**
 * One pass as the chat lists it: Genesis's pass with its last completed run in this project (lastRun,
 * an ISO time, or null when it never completed), the commits since, the runs Genesis offers for it,
 * and why the project's Genesis cannot run it (null when it can).
 * @typedef {{ id: string, title: string, description: string, recommend: { when: string, hint: string }, request: string,
 *   lastRun: string | null, commitsSince: number | null, unavailable: string | null, runs: Vibe64PassRun[],
 *   snoozedUntil: string, dismissed: boolean }} Vibe64Pass
 */

/**
 * The key starting holds while a run is being sent.
 * @param {Vibe64Pass} pass
 * @param {Vibe64PassRun} passRun
 */
const runKey = (pass, passRun) => `${pass.id}:${passRun.id}`;

/**
 * The request a Master run sends for the ticked passes: the run's own request when every pass it
 * offers is ticked; otherwise its selectedRequest, naming the ticked passes by title in the Master
 * order. Empty when none is ticked.
 * @param {{ passes: string[] }} master the Master pass Genesis lists
 * @param {{ request: string, selectedRequest: string }} masterRun
 * @param {string[]} ticked the ids of the ticked passes
 * @param {Vibe64Pass[]} passes
 */
function masterRequest(master, masterRun, ticked, passes) {
  const chosen = master.passes.filter((id) => ticked.includes(id));
  if (!chosen.length) return "";
  if (chosen.length === master.passes.length) return masterRun.request;
  const titles = chosen.map((id) => passes.find((pass) => pass.id === id)?.title || id);
  return masterRun.selectedRequest.replace("{passes}", titles.join(", "));
}

/**
 * The chat's Passes: the passes Genesis offers with their runs, the one the server's rule suggests
 * now, Run, and the suggestion's Later and Dismiss. Run sends one of a pass's runs to Main chat as the
 * person's own message; nothing here ever runs a pass by itself.
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
  // Why the project's own Genesis runs no pass, naming the update; empty when it runs them.
  const unavailable = computed(() => resource.data.value?.unavailable || "");
  const recommendation = computed(() => passes.value.find(({ id }) => id === resource.data.value?.recommendation) || null);
  // The Master pass, which runs the passes in its own order deeply, one after another; null before the read.
  const master = computed(() => resource.data.value?.master || null);
  const starting = ref("");
  const changing = ref("");
  const error = ref("");

  /**
   * Starts one of a pass's runs with the request Genesis wrote for it, as if the person had sent it:
   * it shows in the chat, Stop ends it, and Main chat refuses it while a turn or goal is running.
   * starting holds the run's key (runKey) while it is being sent.
   * @param {Vibe64Pass} pass
   * @param {Vibe64PassRun} passRun
   */
  async function run(pass, passRun) {
    if (starting.value) return false;
    starting.value = runKey(pass, passRun);
    error.value = "";
    try {
      const result = await send({ message: passRun.request, genesisTask: pass.id, submissionKind: "send" });
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
   * Starts one of the Master pass's runs for the ticked passes, as run starts a pass's run.
   * @param {{ id: string, request: string, selectedRequest: string }} masterRun
   * @param {string[]} ticked the ids of the ticked passes
   */
  function runMaster(masterRun, ticked) {
    const request = master.value ? masterRequest(master.value, masterRun, ticked, passes.value) : "";
    if (!request) return Promise.resolve(false);
    return run(master.value, { ...masterRun, request });
  }

  /**
   * @param {Vibe64Pass} pass
   * @param {"snooze" | "dismiss"} action Later hides the suggestion for a week; Dismiss until the pass completes again.
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
    unavailable,
    recommendation,
    master,
    loading: resource.isLoading,
    loadError: resource.loadError,
    starting,
    changing,
    error,
    run,
    runMaster,
    snooze: (pass) => changeRecommendation(pass, "snooze"),
    dismiss: (pass) => changeRecommendation(pass, "dismiss"),
    reload: () => resource.reload()
  };
}

export { masterRequest, runKey, useVibe64Passes };
