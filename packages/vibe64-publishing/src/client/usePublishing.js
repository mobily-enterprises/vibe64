// The Publish page's one connection to this project's publishing routes: the
// current state, refreshed while something runs in the background, and plain
// calls that return the route's answer or throw its message.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { resolveStudioRequestUrl } from "/src/lib/studioUrls.js";

const BASE = "/api/vibe64/publishing";

function publishingRequest(suffix = "", { method = "GET", body } = {}) {
  return getHttpWebClient().request(resolveStudioRequestUrl(`${BASE}${suffix}`), {
    method,
    ...(body === undefined ? {} : { body })
  });
}

function usePublishing({ active = () => true, request = publishingRequest } = {}) {
  const state = ref(null);
  const loading = ref(false);
  const loadError = ref("");
  let timer = null;

  const busy = computed(() => Boolean(
    state.value?.activeRelease ||
    (state.value?.releases || []).some((release) => release.status === "running") ||
    state.value?.checks?.status === "running" ||
    state.value?.toolchains?.install?.status === "running"
  ));

  async function refresh() {
    if (!active()) return state.value;
    loading.value = true;
    try {
      const answer = await request("");
      if (answer?.ok === false) throw Object.assign(new Error(answer.error), { code: answer.code });
      state.value = answer;
      loadError.value = "";
    } catch (error) {
      loadError.value = error?.message || "Publishing could not load.";
    } finally {
      loading.value = false;
    }
    return state.value;
  }

  // Every change goes through here; the page refreshes once it lands.
  async function call(suffix, { method = "POST", body, refreshAfter = true } = {}) {
    const answer = await request(suffix, { method, body });
    if (answer?.ok === false) throw Object.assign(new Error(answer.error || "Publishing failed."), { code: answer.code, details: answer.details });
    if (refreshAfter) await refresh();
    return answer;
  }

  // Immediate: a page opened while a release runs keeps following it.
  watch(busy, (running) => {
    clearInterval(timer);
    timer = running ? setInterval(refresh, 2000) : null;
  }, { immediate: true });
  onBeforeUnmount(() => clearInterval(timer));

  return { state, loading, loadError, busy, refresh, call };
}

function apkDownloadUrl(releaseId, targetId) {
  return resolveStudioRequestUrl(`${BASE}/releases/${encodeURIComponent(releaseId)}/targets/${encodeURIComponent(targetId)}/apk`);
}

export { apkDownloadUrl, publishingRequest, usePublishing };
