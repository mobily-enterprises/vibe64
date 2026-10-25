import { computed, onScopeDispose, ref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SourceEditorStarsPath } from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

function useVibe64StarredFiles({ projectSlug, sessionId, sessionsApiPath } = {}) {
  const files = ref([]);
  const loading = ref(false);
  const error = ref("");
  const pendingPaths = ref([]);
  const feedback = useUiFeedback({ source: "vibe64.source-editor.stars" });
  const paths = computed(() => files.value.map((file) => file.path));
  const endpoint = computed(() => {
    const id = readRefOrGetterValue(sessionId);
    const base = readRefOrGetterValue(sessionsApiPath);
    return id && base ? vibe64SourceEditorStarsPath(base, id) : "";
  });
  let generation = 0;
  let readSequence = 0;
  let needsRefresh = false;
  onScopeDispose(() => {
    generation += 1;
  });

  async function request(url, options) {
    const response = await getHttpWebClient().request(url, options);
    if (response?.ok === false) {
      throw vibe64ApiError(response, "Starred files could not load.");
    }
    return response;
  }

  async function refresh() {
    if (!endpoint.value || pendingPaths.value.length) {
      return;
    }
    const sequence = ++readSequence;
    const context = generation;
    loading.value = true;
    error.value = "";
    try {
      const response = await request(endpoint.value);
      if (context === generation && sequence === readSequence) {
        files.value = response.files || [];
        needsRefresh = false;
      }
    } catch (cause) {
      if (context === generation && sequence === readSequence) {
        error.value = cause.message || "Starred files could not load.";
      }
    } finally {
      if (context === generation && sequence === readSequence) {
        loading.value = false;
      }
    }
  }

  async function toggle(filePath) {
    if (!endpoint.value || !filePath || pendingPaths.value.includes(filePath)) {
      return;
    }
    const context = generation;
    const previousIndex = files.value.findIndex((file) => file.path === filePath);
    const previous = files.value[previousIndex];
    const starred = !previous;
    readSequence += 1;
    loading.value = false;
    pendingPaths.value = [...pendingPaths.value, filePath];
    files.value = starred
      ? [...files.value, { path: filePath, available: true }]
      : files.value.filter((file) => file.path !== filePath);
    try {
      await request(endpoint.value, { method: "POST", body: { path: filePath, starred } });
      if (context === generation) {
        error.value = "";
      }
    } catch (cause) {
      if (context !== generation) {
        return;
      }
      files.value = files.value.filter((file) => file.path !== filePath);
      if (previous) {
        files.value.splice(previousIndex, 0, previous);
      }
      needsRefresh = true;
      feedback.error(cause, "The star could not be saved.");
    } finally {
      if (context === generation) {
        pendingPaths.value = pendingPaths.value.filter((value) => value !== filePath);
        // Concurrent rollbacks cannot reconstruct the server's saved ordering.
        if (needsRefresh && pendingPaths.value.length === 0) {
          await refresh();
        }
      }
    }
  }

  watch([endpoint, () => readRefOrGetterValue(projectSlug)], () => {
    generation += 1;
    needsRefresh = false;
    files.value = [];
    pendingPaths.value = [];
    error.value = "";
    loading.value = false;
    void refresh();
  }, { immediate: true });

  return { error, files, loading, paths, pendingPaths, refresh, toggle };
}

export { useVibe64StarredFiles };
