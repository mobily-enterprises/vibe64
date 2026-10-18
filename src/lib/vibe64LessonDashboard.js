import { computed, inject, unref } from "vue";

// A practice lesson shows the ordinary Dashboard for its practice project and
// lesson session. Its requests use the saved attempt's lesson URLs instead of
// the page's Working project; only these sections have declared lesson actions.
const VIBE64_LESSON_DASHBOARD_KEY = Symbol("vibe64.lesson-dashboard");
const LESSON_DASHBOARD_PROJECT_SECTIONS = Object.freeze(["repository", "env", "history", "health"]);
const LESSON_DASHBOARD_SESSION_TOOLS = Object.freeze(["info", "changes", "editor", "database", "system"]);

function lessonDashboardScope(attemptId = "", sessionId = "") {
  const attempt = String(attemptId || "").trim();
  return attempt ? Object.freeze({
    attemptId: attempt,
    apiBase: `/api/learning/${encodeURIComponent(attempt)}/vibe64`,
    sessionId: String(sessionId || "").trim()
  }) : null;
}

// Maps an ordinary `/api/vibe64/...` path onto the lesson's URL. Paths that
// are not Vibe64 project paths (for example Studio Health) stay unchanged.
function lessonDashboardApiPath(scope, path = "") {
  const value = String(path || "");
  if (!scope?.apiBase || !value.startsWith("/api/vibe64/")) return value;
  return `${scope.apiBase}/${value.slice("/api/vibe64/".length)}`;
}

function lessonDashboardSectionVisible(context = {}, section = "") {
  return !context?.lessonDashboard || LESSON_DASHBOARD_PROJECT_SECTIONS.includes(section);
}

function useVibe64LessonDashboard() {
  const scope = inject(VIBE64_LESSON_DASHBOARD_KEY, null);
  return computed(() => unref(scope) || null);
}

export {
  LESSON_DASHBOARD_PROJECT_SECTIONS,
  LESSON_DASHBOARD_SESSION_TOOLS,
  VIBE64_LESSON_DASHBOARD_KEY,
  lessonDashboardApiPath,
  lessonDashboardScope,
  lessonDashboardSectionVisible,
  useVibe64LessonDashboard
};
