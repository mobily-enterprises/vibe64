import { inject, provide, unref } from "vue";

const VIBE64_SESSION_DASHBOARD_CONTEXT_KEY = Symbol("vibe64-session-dashboard-context");

const EMPTY_VIBE64_SESSION_DASHBOARD_CONTEXT = Object.freeze({
  copyText: null,
  facts: [],
  session: null,
  sessionId: "",
  statusColor: "default",
  statusLabel: ""
});

function provideVibe64SessionDashboardContext(context) {
  provide(VIBE64_SESSION_DASHBOARD_CONTEXT_KEY, context);
}

function useVibe64SessionDashboardContext() {
  const context = inject(
    VIBE64_SESSION_DASHBOARD_CONTEXT_KEY,
    EMPTY_VIBE64_SESSION_DASHBOARD_CONTEXT
  );
  return () => unref(context) || EMPTY_VIBE64_SESSION_DASHBOARD_CONTEXT;
}

export {
  provideVibe64SessionDashboardContext,
  useVibe64SessionDashboardContext
};
