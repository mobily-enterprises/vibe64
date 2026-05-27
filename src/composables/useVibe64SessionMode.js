import { ref, unref, watch } from "vue";
import {
  DEFAULT_VIBE64_SESSION_MODE,
  vibe64SessionModeFromRouteQuery,
  vibe64SessionModeRouteQuery,
  vibe64SessionModeRouteSynced,
  normalizeVibe64SessionMode,
  readVibe64SessionMode,
  writeVibe64SessionMode
} from "@/lib/vibe64SessionModeStorage.js";

function useVibe64SessionMode({
  route = null,
  router = null,
  selectedSessionId
} = {}) {
  const modeBySessionId = new Map();
  let initialRouteMode = vibe64SessionModeFromRouteQuery(route?.query || {});
  const sessionMode = ref(DEFAULT_VIBE64_SESSION_MODE);

  function selectedId() {
    return String(unref(selectedSessionId) || "").trim();
  }

  function modeForSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return DEFAULT_VIBE64_SESSION_MODE;
    }
    if (modeBySessionId.has(normalizedSessionId)) {
      return modeBySessionId.get(normalizedSessionId);
    }
    if (initialRouteMode) {
      const routeMode = initialRouteMode;
      initialRouteMode = "";
      modeBySessionId.set(normalizedSessionId, writeVibe64SessionMode(normalizedSessionId, routeMode));
      return modeBySessionId.get(normalizedSessionId);
    }
    const storedMode = readVibe64SessionMode(normalizedSessionId);
    modeBySessionId.set(normalizedSessionId, storedMode);
    return storedMode;
  }

  function syncRouteMode(mode = DEFAULT_VIBE64_SESSION_MODE) {
    if (!selectedId() || typeof router?.replace !== "function") {
      return;
    }
    if (vibe64SessionModeRouteSynced(route?.query || {}, mode)) {
      return;
    }
    void router.replace({
      query: vibe64SessionModeRouteQuery(route?.query || {}, mode)
    });
  }

  function applySelectedSessionMode() {
    const sessionId = selectedId();
    sessionMode.value = modeForSession(sessionId);
    syncRouteMode(sessionMode.value);
  }

  function setSessionMode(mode = DEFAULT_VIBE64_SESSION_MODE) {
    const sessionId = selectedId();
    if (!sessionId) {
      return;
    }
    const normalizedMode = writeVibe64SessionMode(sessionId, normalizeVibe64SessionMode(mode));
    modeBySessionId.set(sessionId, normalizedMode);
    sessionMode.value = normalizedMode;
    syncRouteMode(normalizedMode);
  }

  watch(() => selectedId(), applySelectedSessionMode, {
    immediate: true
  });

  return {
    sessionMode,
    setSessionMode
  };
}

export {
  useVibe64SessionMode
};
