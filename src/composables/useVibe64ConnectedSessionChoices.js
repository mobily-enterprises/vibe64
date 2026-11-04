import { computed, ref, toValue, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { VIBE64_SESSIONS_API_SUFFIX, vibe64SessionPath } from "@/lib/vibe64SessionRequestConfig.js";

/**
 * One connected project that needs a person to choose a session.
 * @typedef {object} ConnectedSessionChoice
 * @property {string} name
 * @property {string} projectSlug
 * @property {string} reason Why its saved link no longer holds; empty when it never had one.
 * @property {string} repository
 * @property {{ sessionId: string, sessionName: string }[]} sessions Its free sessions, as the server decided them.
 * @property {object} [replacementReview] A confirmed replacement that was not finished, ready to retry.
 */

/**
 * The selected session of each repository: a choice still on offer stays,
 * otherwise the first free session is preselected.
 * @param {ConnectedSessionChoice[]} choices
 * @param {Record<string, string>} previous
 */
function preselectedSessions(choices, previous) {
  return Object.fromEntries(choices.map(({ repository, sessions }) => [
    repository,
    sessions.some(session => session.sessionId === previous[repository])
      ? previous[repository]
      : sessions[0]?.sessionId || ""
  ]));
}

/**
 * The connected projects of a session that need a person's choice. The server
 * owns that list and which sessions are free, and checks a choice again when
 * it is saved, so every outcome reloads from it.
 * @param {{
 *   projectSlug: import("vue").MaybeRefOrGetter<string>,
 *   sessionId: import("vue").MaybeRefOrGetter<string>,
 *   revision: import("vue").MaybeRefOrGetter<string>,
 *   onResolved: () => void
 * }} options `revision` changes whenever preparation records a new state;
 *   `onResolved` runs once the last project has its session.
 */
function useVibe64ConnectedSessionChoices({ projectSlug, sessionId, revision, onResolved }) {
  const choices = ref(/** @type {ConnectedSessionChoice[]} */ ([]));
  const selections = ref(/** @type {Record<string, string>} */ ({}));
  const error = ref("");
  const pendingRepository = ref("");
  const busy = computed(() => Boolean(pendingRepository.value));

  /** @param {string} suffix */
  function sessionUrl(suffix) {
    return scopedDevelopmentApiUrl(vibe64SessionPath(`/api${VIBE64_SESSIONS_API_SUFFIX}`, toValue(sessionId), suffix), toValue(projectSlug));
  }

  /** @returns {Promise<boolean>} whether the list now is the server's, for the session still shown */
  async function load() {
    const path = sessionUrl("/connected/choices");
    try {
      const result = await getHttpWebClient().request(path, { method: "GET" });
      if (result?.ok !== true) throw vibe64ApiError(result, "The connected projects could not be checked.");
      if (path !== sessionUrl("/connected/choices")) return false;
      choices.value = result.choices;
      selections.value = preselectedSessions(result.choices, selections.value);
      return true;
    } catch (cause) {
      if (path === sessionUrl("/connected/choices")) error.value = cause.message;
      return false;
    }
  }

  /**
   * Saves one project's change on the server, then reloads. A refusal keeps
   * its message and still reloads, so a session someone else took is gone.
   * @param {ConnectedSessionChoice} choice
   * @param {string} suffix
   * @param {object} body
   * @param {string} fallback
   */
  async function save(choice, suffix, body, fallback) {
    if (busy.value) return;
    pendingRepository.value = choice.repository;
    error.value = "";
    let refusal = "";
    try {
      const result = await getHttpWebClient().request(sessionUrl(suffix), { method: "POST", body });
      if (result?.ok !== true) throw vibe64ApiError(result, fallback);
    } catch (cause) {
      refusal = cause.message;
    }
    const current = await load();
    error.value = refusal || error.value;
    pendingRepository.value = "";
    if (!refusal && current && !choices.value.length) onResolved();
  }

  /** @param {ConnectedSessionChoice} choice */
  function linkSession(choice) {
    return save(choice, "/connected/link", {
      repository: choice.repository,
      connectedSessionId: selections.value[choice.repository]
    }, "The session could not be linked. Choose again.");
  }

  /** @param {ConnectedSessionChoice} choice */
  function finishReplacement(choice) {
    return save(choice, "/connected/replacement", {
      repository: choice.repository,
      review: choice.replacementReview
    }, "The replacement could not be finished. Retry it.");
  }

  watch(() => [toValue(projectSlug), toValue(sessionId), toValue(revision)], () => {
    error.value = "";
    return load();
  }, { immediate: true });

  return { busy, choices, error, finishReplacement, linkSession, pendingRepository, selections };
}

export { useVibe64ConnectedSessionChoices };
