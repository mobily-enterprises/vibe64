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

/** @param {string} projectSlug @param {string} pageId */
const archivePage = (projectSlug, pageId) => pagesRequest(projectSlug, `${pageSuffix(pageId)}/archive`, { method: "POST", body: {} });

/** @param {string} projectSlug @param {string} pageId */
const restorePage = (projectSlug, pageId) => pagesRequest(projectSlug, `${pageSuffix(pageId)}/restore`, { method: "POST", body: {} });

/** @param {string} projectSlug @param {string} pageId */
const deletePage = (projectSlug, pageId) => pagesRequest(projectSlug, pageSuffix(pageId), { method: "DELETE" });

/** @param {string} projectSlug @param {string} pageId @param {number} version */
const restorePageVersion = (projectSlug, pageId, version) =>
  pagesRequest(projectSlug, `${pageSuffix(pageId)}/versions/${version}/restore`, { method: "POST", body: {} });

/** @param {string} value an ISO time */
function pageTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export {
  archivePage,
  deletePage,
  listPages,
  openPageView,
  pageTime,
  readPage,
  restorePage,
  restorePageVersion
};
