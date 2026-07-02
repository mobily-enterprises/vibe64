import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  vibe64SessionViewStatePath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  projectAppPath,
  projectSlugFromRoute
} from "@/lib/vibe64ProjectScope.js";
import {
  vibe64BrowserTabOriginId,
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

function normalizeRouteUrl(routeFullPath = "") {
  const route = String(routeFullPath || "").trim();
  if (
    !route ||
    route.length > 1024 ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(route) ||
    route.startsWith("//")
  ) {
    return null;
  }
  try {
    const parsed = new URL(route, "http://vibe64.local");
    if (parsed.origin !== "http://vibe64.local") {
      return null;
    }
    const pathname = parsed.pathname.replace(/\/{2,}/gu, "/").replace(/\/+$/u, "") || "/";
    return {
      fullPath: `${pathname}${parsed.search}${parsed.hash}`,
      pathname
    };
  } catch {
    return null;
  }
}

function normalizeSessionViewRouteFullPath(routeFullPath = "", projectSlug = "") {
  const projectBasePath = projectAppPath(projectSlug);
  const route = normalizeRouteUrl(routeFullPath);
  if (!route || !projectSlug || projectBasePath === "/app") {
    return "";
  }
  const dashboardPrefix = `${projectBasePath}/dashboard`;
  if (
    route.pathname !== projectBasePath &&
    route.pathname !== dashboardPrefix &&
    !route.pathname.startsWith(`${dashboardPrefix}/`)
  ) {
    return "";
  }
  return route.fullPath;
}

function sessionViewProjectPane(routeFullPath = "", projectSlug = "") {
  const route = normalizeRouteUrl(normalizeSessionViewRouteFullPath(routeFullPath, projectSlug));
  const projectBasePath = projectAppPath(projectSlug);
  if (!route || !projectSlug || projectBasePath === "/app") {
    return "";
  }
  return route.pathname === projectBasePath ? "preview" : "dashboard";
}

function sessionViewPayloadMatches({
  originId = vibe64BrowserTabOriginId(),
  payload = {},
  projectSlug = "",
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedProjectSlug = String(projectSlug || "").trim();
  if (
    !normalizedSessionId ||
    !normalizedProjectSlug ||
    String(payload?.sessionId || "").trim() !== normalizedSessionId ||
    String(payload?.projectSlug || "").trim() !== normalizedProjectSlug ||
    vibe64RealtimePayloadFromCurrentTab(payload, { originId })
  ) {
    return false;
  }
  return Boolean(normalizeSessionViewRouteFullPath(payload?.routeFullPath, normalizedProjectSlug));
}

function sessionViewStateMatches({
  payload = {},
  projectSlug = "",
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedProjectSlug = String(projectSlug || "").trim();
  if (
    !normalizedSessionId ||
    !normalizedProjectSlug ||
    String(payload?.sessionId || "").trim() !== normalizedSessionId ||
    String(payload?.projectSlug || "").trim() !== normalizedProjectSlug
  ) {
    return false;
  }
  return Boolean(normalizeSessionViewRouteFullPath(payload?.routeFullPath, normalizedProjectSlug));
}

function sessionViewStateSignature(payload = {}, projectSlug = "") {
  const routeFullPath = normalizeSessionViewRouteFullPath(payload?.routeFullPath, projectSlug);
  return routeFullPath
    ? [
        String(payload?.sessionId || "").trim(),
        String(payload?.projectSlug || "").trim(),
        routeFullPath,
        String(payload?.updatedAt || "").trim()
      ].join("\u0000")
    : "";
}

function useVibe64SessionViewSync({
  enabled = true,
  sessionId,
  sessionsApiPath,
  viewState = null
} = {}) {
  const route = useRoute();
  const router = useRouter();
  const originId = vibe64BrowserTabOriginId();
  let suppressLocalPublishRoute = "";
  let suppressLocalPublishTimer = 0;
  let lastAppliedViewStateSignature = "";

  const activeSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const activeSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const activeProjectSlug = computed(() => String(projectSlugFromRoute(route) || "").trim());
  const activeRouteFullPath = computed(() => normalizeSessionViewRouteFullPath(
    route.fullPath,
    activeProjectSlug.value
  ));
  const activeViewState = computed(() => readRefOrGetterValue(viewState) || null);
  const active = computed(() => Boolean(
    readRefOrGetterValue(enabled) &&
    activeSessionId.value &&
    activeSessionsApiPath.value &&
    activeProjectSlug.value &&
    activeRouteFullPath.value
  ));

  useRealtimeEvent({
    enabled: computed(() => Boolean(
      readRefOrGetterValue(enabled) &&
      activeSessionId.value &&
      activeProjectSlug.value
    )),
    event: VIBE64_SESSION_VIEW_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => sessionViewPayloadMatches({
      originId,
      payload,
      projectSlug: activeProjectSlug.value,
      sessionId: activeSessionId.value
    }),
    onEvent: ({ payload = {} } = {}) => {
      applyRemoteRoute(payload.routeFullPath);
    }
  });

  watch(() => [
    active.value,
    activeSessionId.value,
    activeProjectSlug.value,
    activeSessionsApiPath.value,
    activeRouteFullPath.value
  ], (_nextState, previousState = []) => {
    if (!previousState.length || !active.value) {
      return;
    }
    const previousRoute = String(previousState[4] || "");
    if (previousRoute === activeRouteFullPath.value) {
      return;
    }
    if (suppressLocalPublishRoute === activeRouteFullPath.value) {
      suppressLocalPublishRoute = "";
      clearSuppressLocalPublishTimer();
      return;
    }
    publishCurrentRoute();
  }, {
    flush: "post"
  });

  watch(() => [
    active.value,
    activeSessionId.value,
    activeProjectSlug.value,
    sessionViewStateSignature(activeViewState.value, activeProjectSlug.value)
  ], () => {
    applyInitialViewState();
  }, {
    flush: "post",
    immediate: true
  });

  onBeforeUnmount(() => {
    clearSuppressLocalPublishTimer();
  });

  function clearSuppressLocalPublishTimer() {
    if (!suppressLocalPublishTimer) {
      return;
    }
    clearTimeout(suppressLocalPublishTimer);
    suppressLocalPublishTimer = 0;
  }

  function scheduleSuppressLocalPublishClear(routeFullPath = "") {
    clearSuppressLocalPublishTimer();
    suppressLocalPublishTimer = setTimeout(() => {
      if (suppressLocalPublishRoute === routeFullPath) {
        suppressLocalPublishRoute = "";
      }
      suppressLocalPublishTimer = 0;
    }, 0);
  }

  function applyRemoteRoute(routeFullPath = "") {
    const targetRoute = normalizeSessionViewRouteFullPath(routeFullPath, activeProjectSlug.value);
    if (!targetRoute || targetRoute === activeRouteFullPath.value) {
      return;
    }
    suppressLocalPublishRoute = targetRoute;
    void router.push(targetRoute).catch((error) => {
      suppressLocalPublishRoute = "";
      clearSuppressLocalPublishTimer();
      vibe64SessionDebugLog("client.sessionViewSync.route.error", {
        error: vibe64SessionDebugError(error),
        routeFullPath: targetRoute,
        sessionId: activeSessionId.value
      });
    }).finally(() => {
      scheduleSuppressLocalPublishClear(targetRoute);
    });
  }

  function applyInitialViewState() {
    const payload = activeViewState.value;
    if (
      !active.value ||
      !sessionViewStateMatches({
        payload,
        projectSlug: activeProjectSlug.value,
        sessionId: activeSessionId.value
      })
    ) {
      return;
    }
    const signature = sessionViewStateSignature(payload, activeProjectSlug.value);
    if (!signature || signature === lastAppliedViewStateSignature) {
      return;
    }
    lastAppliedViewStateSignature = signature;
    applyRemoteRoute(payload.routeFullPath);
  }

  function publishCurrentRoute() {
    if (!active.value) {
      return;
    }
    const routeFullPath = activeRouteFullPath.value;
    void getUsersWebHttpClient().request(
      vibe64SessionViewStatePath(activeSessionsApiPath.value, activeSessionId.value),
      {
        body: {
          originId,
          projectSlug: activeProjectSlug.value,
          routeFullPath
        },
        method: "POST"
      }
    ).catch((error) => {
      vibe64SessionDebugLog("client.sessionViewSync.publish.error", {
        error: vibe64SessionDebugError(error),
        routeFullPath,
        sessionId: activeSessionId.value
      });
    });
  }

  return {
    active,
    routeFullPath: activeRouteFullPath
  };
}

export {
  normalizeSessionViewRouteFullPath,
  sessionViewPayloadMatches,
  sessionViewProjectPane,
  useVibe64SessionViewSync
};
