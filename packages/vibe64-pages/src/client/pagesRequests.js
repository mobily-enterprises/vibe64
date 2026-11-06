// The client's one connection to a project's page routes: each call returns
// the route's answer or throws its message.
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { scopedDevelopmentApiUrl } from "/src/lib/studioUrls.js";
import { vibe64ApiError } from "/src/lib/vibe64ApiResponses.js";

/**
 * @param {string} projectSlug
 * @param {string} [suffix]
 * @param {{ method?: string, body?: object }} [options]
 */
async function pagesRequest(projectSlug, suffix = "", { method = "GET", body } = {}) {
  const answer = await getHttpWebClient().request(scopedDevelopmentApiUrl(`/api/vibe64/pages${suffix}`, projectSlug), {
    method,
    ...(body === undefined ? {} : { body })
  });
  if (answer?.ok === false) throw vibe64ApiError(answer, "The page request failed.");
  return answer;
}

const pageSuffix = (pageId) => `/${encodeURIComponent(pageId)}`;

/** @param {string} projectSlug */
const listPages = (projectSlug) => pagesRequest(projectSlug);

/** @param {string} projectSlug @param {string} pageId */
const readPage = (projectSlug, pageId) => pagesRequest(projectSlug, pageSuffix(pageId));

/**
 * A short-lived viewing link for the page, in the viewer's theme.
 * @param {string} projectSlug
 * @param {string} pageId
 * @param {"light" | "dark"} theme
 */
const openPageView = (projectSlug, pageId, theme) =>
  pagesRequest(projectSlug, `${pageSuffix(pageId)}/view`, { method: "POST", body: { theme } });

/** The current pages this person starred, in the order they starred them. @param {string} projectSlug */
const listStarredPages = (projectSlug) => pagesRequest(projectSlug, "/stars");

/** @param {string} projectSlug @param {string} pageId @param {boolean} starred */
const setPageStar = (projectSlug, pageId, starred) =>
  pagesRequest(projectSlug, `${pageSuffix(pageId)}/star`, { method: "POST", body: { starred } });

/** @param {string} projectSlug @param {string} pageId */
const archivePage = (projectSlug, pageId) => pagesRequest(projectSlug, `${pageSuffix(pageId)}/archive`, { method: "POST", body: {} });

/** @param {string} projectSlug @param {string} pageId */
const restorePage = (projectSlug, pageId) => pagesRequest(projectSlug, `${pageSuffix(pageId)}/restore`, { method: "POST", body: {} });

/** @param {string} projectSlug @param {string} pageId */
const deletePage = (projectSlug, pageId) => pagesRequest(projectSlug, pageSuffix(pageId), { method: "DELETE" });

/** @param {string} projectSlug @param {string} pageId @param {number} version */
const restorePageVersion = (projectSlug, pageId, version) =>
  pagesRequest(projectSlug, `${pageSuffix(pageId)}/versions/${version}/restore`, { method: "POST", body: {} });

/** A page's last refreshes, newest first, with their logs. @param {string} projectSlug @param {string} pageId */
const readRefreshRuns = (projectSlug, pageId) => pagesRequest(projectSlug, `${pageSuffix(pageId)}/refresh/runs`);

/**
 * Refresh now, cancel the running refresh, pause or resume the schedule.
 * @param {"run" | "cancel" | "pause" | "resume"} step
 */
const changeRefresh = (step) => (projectSlug, pageId) =>
  pagesRequest(projectSlug, `${pageSuffix(pageId)}/refresh/${step}`, { method: "POST", body: {} });

/** @param {string} value an ISO time */
function pageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * How a page's refresh stands, in one short line, and whether it needs a look.
 * @param {object | null} refresh
 * @returns {{ text: string, alert: boolean }}
 */
function refreshState(refresh) {
  if (!refresh) return { text: "", alert: false };
  if (refresh.running) return { text: "Refreshing…", alert: false };
  if (refresh.paused) return { text: `Paused: ${refresh.pausedReason}`, alert: true };
  if (refresh.lastRun?.outcome === "failed") return { text: `Refresh failed ${pageTime(refresh.lastRun.endedAt)}`, alert: true };
  return { text: `Next ${pageTime(refresh.nextAt)}`, alert: false };
}

export {
  archivePage,
  changeRefresh,
  deletePage,
  listPages,
  listStarredPages,
  openPageView,
  pageTime,
  readPage,
  readRefreshRuns,
  refreshState,
  restorePage,
  restorePageVersion,
  setPageStar
};
