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
 * and why the Genesis serving the project cannot run it (null when it can).
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
 * The open plan's passes as its Passes section lists them, each with its state now: done, running,
 * needs you (it waits for the person's answer), paused (the person stopped it), blocked (it can't
 * run, with the reason in chat) or "" (not run yet). atPasses is true once Senior has reviewed the
 * plan, so its passes run.
 * @typedef {{ title: string, atPasses: boolean, passes: { id: string, title: string, scope: string, item: string,
 *   done: boolean, state: "" | "done" | "running" | "needs-you" | "paused" | "blocked" | "waiting" }[] }} Vibe64PlanPasses
 */

const SERIES_WORDS = Object.freeze({ whole: "on the whole app", "since-last": "since their last completed run", deep: "deeply" });
const titleList = (titles) => titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;

/**
 * The message a series of passes sends: "Run Security pass, Data pass and Deslop deeply."
 * @param {string[]} titles in the order they run
 * @param {"whole" | "since-last" | "deep"} runId the one run all of them take
 */
const seriesMessage = (titles, runId) => `Run ${titleList(titles)} ${SERIES_WORDS[runId]}.`;

/**
 * The chat's Passes: the passes Genesis offers with their runs, the open plan's passes, the one the
 * server's rule suggests now, and the suggestion's Later and Dismiss. Run, a series of ticked passes,
 * Continue, Run this pass again and Restart from the first pass each send the person's own message to
 * Main chat, which adds the passes to the open plan (or a plan of its own) and runs the plan's next
 * pass once the plan is at its Passes step; nothing here ever runs a pass by itself.
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
  // Why the Genesis serving the project runs no pass; empty when it runs them.
  const unavailable = computed(() => resource.data.value?.unavailable || "");
  const recommendation = computed(() => passes.value.find(({ id }) => id === resource.data.value?.recommendation) || null);
  // Genesis's order for running several passes (its Master pass order), each pass's id once.
  const order = computed(() => {
    const ids = resource.data.value?.master?.passes || [];
    return [...ids.filter((id) => passes.value.some((pass) => pass.id === id)),
      ...passes.value.map(({ id }) => id).filter((id) => !ids.includes(id))];
  });
  /** @type {import("vue").ComputedRef<Vibe64PlanPasses | null>} */
  const plan = computed(() => resource.data.value?.plan || null);
  const starting = ref("");
  const changing = ref("");
  const error = ref("");

  /**
   * Sends one Passes message as the person's own: it shows in the chat, Stop pauses the pass it
   * runs, and Main chat refuses it while a turn or goal is running. starting holds key meanwhile.
   * @param {string} key
   * @param {object} input
   * @param {string} failed what the error says when the server gives no reason
   */
  async function sendPasses(key, input, failed) {
    if (starting.value) return false;
    starting.value = key;
    error.value = "";
    try {
      const result = await send({ ...input, submissionKind: "send" });
      if (result === false || result?.ok === false) throw new Error(result?.error || failed);
      return true;
    } catch (failure) {
      error.value = failure?.message || failed;
      return false;
    } finally {
      starting.value = "";
      void resource.reload();
    }
  }

  /**
   * Adds one of a pass's runs to the open plan's Passes, or to a plan of its own, with the request
   * Genesis wrote for it as the message.
   * @param {Vibe64Pass} pass
   * @param {Vibe64PassRun} passRun
   */
  function run(pass, passRun) {
    return sendPasses(runKey(pass, passRun), { message: passRun.request, genesisTask: pass.id, passRun: passRun.id },
      `${pass.title} did not start.`);
  }

  /**
   * Adds the ticked passes, in Genesis's order, each with the same run.
   * @param {string[]} ticked pass ids
   * @param {"whole" | "since-last" | "deep"} runId
   */
  function runSeries(ticked, runId) {
    const ids = order.value.filter((id) => ticked.includes(id));
    if (!ids.length) return Promise.resolve(false);
    const titles = ids.map((id) => passes.value.find((pass) => pass.id === id).title);
    return sendPasses(`series:${runId}`, { message: seriesMessage(titles, runId), passes: ids, passRun: runId }, "The passes did not start.");
  }

  /**
   * The open plan's Continue, Run this pass again and Restart from the first pass.
   * @param {"continue" | "again" | "restart"} action
   * @param {{ id: string, title: string }} [pass] the pass to run again
   */
  function planAction(action, pass) {
    const message = {
      continue: "Continue the plan's passes.",
      again: `Run ${pass?.title} again.`,
      restart: "Restart the plan's passes from the first one."
    }[action];
    return sendPasses(`plan:${action}:${pass?.id || ""}`, { message, passAction: action, ...(pass ? { passId: pass.id } : {}) },
      "The plan's passes did not continue.");
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
    order,
    plan,
    loading: resource.isLoading,
    loadError: resource.loadError,
    starting,
    changing,
    error,
    run,
    runSeries,
    planAction,
    snooze: (pass) => changeRecommendation(pass, "snooze"),
    dismiss: (pass) => changeRecommendation(pass, "dismiss"),
    reload: () => resource.reload()
  };
}

export { runKey, seriesMessage, useVibe64Passes };
