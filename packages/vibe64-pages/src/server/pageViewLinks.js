// Short-lived viewing links. Viewing a page starts with a project member's
// request that passed the project access check; it gets a random link that
// names one page and nothing else. The page's frame and files are reached
// only through it, so a page needs no cookie and never holds one.
import { randomBytes } from "node:crypto";

const VIEW_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
// A link lasts while the page is in use: it lapses after 15 minutes without
// a request, and after 4 hours in any case.
const IDLE_MS = 15 * 60 * 1000;
const LIFETIME_MS = 4 * 60 * 60 * 1000;
const MAX_LINKS = 2000;
const PAGE_THEMES = Object.freeze(["light", "dark"]);

/**
 * @typedef {object} PageViewLink
 * @property {string} pagesRoot the project's pages folder
 * @property {string} pageId
 * @property {"light" | "dark" | ""} theme the viewer's Vibe64 theme, for the optional stylesheet
 * @property {number} createdAt
 * @property {number} usedAt
 */

/**
 * The viewing links this server process has minted.
 * @param {object} [options]
 * @param {() => number} [options.clock]
 */
function createPageViewLinks({ clock = Date.now } = {}) {
  /** @type {Map<string, PageViewLink>} */
  const links = new Map();

  function lapsed(link, at) {
    return at - link.usedAt > IDLE_MS || at - link.createdAt > LIFETIME_MS;
  }

  function sweep(at) {
    for (const [token, link] of links) {
      if (lapsed(link, at)) links.delete(token);
    }
    while (links.size >= MAX_LINKS) links.delete(links.keys().next().value);
  }

  /**
   * A new link to one page.
   * @param {{ pagesRoot: string, pageId: string, theme?: string }} input
   */
  function mint({ pagesRoot, pageId, theme = "" }) {
    const at = clock();
    sweep(at);
    const token = randomBytes(32).toString("base64url");
    links.set(token, {
      pagesRoot,
      pageId,
      theme: PAGE_THEMES.includes(theme) ? /** @type {"light" | "dark"} */ (theme) : "",
      createdAt: at,
      usedAt: at
    });
    return { token, expiresAt: new Date(at + IDLE_MS).toISOString() };
  }

  /**
   * The link's page while the link lasts, which this use extends; null otherwise.
   * @param {unknown} token
   * @returns {PageViewLink | null}
   */
  function use(token) {
    if (typeof token !== "string" || !VIEW_LINK_TOKEN_PATTERN.test(token)) return null;
    const link = links.get(token);
    if (!link) return null;
    const at = clock();
    if (lapsed(link, at)) {
      links.delete(token);
      return null;
    }
    link.usedAt = at;
    return link;
  }

  /**
   * Ends every link to a page, when it is deleted.
   * @param {string} pagesRoot
   * @param {string} pageId
   */
  function revokePage(pagesRoot, pageId) {
    for (const [token, link] of links) {
      if (link.pagesRoot === pagesRoot && link.pageId === pageId) links.delete(token);
    }
  }

  return Object.freeze({
    mint,
    revokePage,
    use
  });
}

export { createPageViewLinks, PAGE_THEMES };
