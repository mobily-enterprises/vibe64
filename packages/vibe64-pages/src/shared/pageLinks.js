// A page's link is its place in the app: the project Dashboard's Pages list
// opened on that page. The agent command prints it, and the chat recognises
// it (written as a path or as a full address on this origin) to show a card.

const PAGE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const PAGE_LINK_PATTERN = /(?:https?:\/\/[^\s/<>()"'`]+)?\/app\/project\/([a-z0-9][a-z0-9_-]{0,47})\/dashboard\/pages\/([a-z0-9][a-z0-9-]{0,63})(?![a-z0-9-])/gu;
const MAX_PAGE_LINKS = 6;

/**
 * Whether a value is a page id.
 * @param {unknown} value
 */
function isPageId(value) {
  return typeof value === "string" && PAGE_ID_PATTERN.test(value);
}

/**
 * The in-app path that opens a project's page beside the chat.
 * @param {string} projectSlug
 * @param {string} pageId
 */
function pageAppPath(projectSlug, pageId) {
  return `/app/project/${encodeURIComponent(projectSlug)}/dashboard/pages/${encodeURIComponent(pageId)}`;
}

/**
 * The page links in a message, in order and once each, at most six. A full
 * address counts only on the given origin.
 * @param {string} text
 * @param {{ origin?: string }} [options]
 * @returns {{ projectSlug: string, pageId: string, path: string }[]}
 */
function pageLinksInText(text, { origin = "" } = {}) {
  const links = [];
  const seen = new Set();
  for (const match of String(text || "").matchAll(PAGE_LINK_PATTERN)) {
    const [whole, projectSlug, pageId] = match;
    if (!isPageId(pageId)) continue;
    const absolute = /^https?:\/\//u.test(whole);
    if (absolute && (!origin || !whole.startsWith(`${origin}/`))) continue;
    const path = pageAppPath(projectSlug, pageId);
    if (seen.has(path)) continue;
    seen.add(path);
    links.push({ projectSlug, pageId, path });
    if (links.length === MAX_PAGE_LINKS) break;
  }
  return links;
}

export { isPageId, pageAppPath, pageLinksInText };
