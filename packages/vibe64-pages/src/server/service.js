// A project's pages: what project members list, open, archive, restore and
// delete, and what a session's agent publishes and updates through its
// command. Every operation runs inside the project request context that the
// project access check (or the agent command's project binding) set up.
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import { pageAppPath } from "../shared/pageLinks.js";
import { checkedTitle, decodedPageFiles, htmlTitle } from "./pageFiles.js";
import { createPageStore, projectPagesRoot } from "./pageStore.js";
import { createPageViewLinks } from "./pageViewLinks.js";
import { PAGE_VIEW_ROUTE } from "./pageSandbox.js";
import { createPageFont } from "./pageStylesheet.js";

/** @typedef {import("./types.js").PageAuthor} PageAuthor */
/** @typedef {import("./types.js").PageRecord} PageRecord */
/** @typedef {import("./types.js").PageSummary} PageSummary */

function currentProject() {
  const context = currentProjectRequestContext();
  return {
    pagesRoot: projectPagesRoot(context?.projectRuntimeRoot),
    slug: String(context?.slug || "").trim()
  };
}

/**
 * What a project member or the agent sees of a page.
 * @param {PageRecord} record
 * @param {string} projectSlug
 * @returns {PageSummary}
 */
function pageSummary(record, projectSlug) {
  return {
    id: record.id,
    title: record.title,
    createdBy: record.createdBy,
    sessionId: record.sessionId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
    archived: record.archived,
    archivedAt: record.archivedAt,
    version: record.version,
    versions: record.versions.map(({ number, createdAt, createdBy, restoredFrom }) => ({
      number, createdAt, createdBy, ...(restoredFrom ? { restoredFrom } : {})
    })),
    link: pageAppPath(projectSlug, record.id)
  };
}

/**
 * @param {object} clocks
 * @param {() => string} clocks.now the time a version records, as ISO text
 * @param {() => number} clocks.clock the milliseconds viewing links expire by
 */
function createPagesService({ now, clock }) {
  const store = createPageStore({ now });
  const viewLinks = createPageViewLinks({ clock });
  const font = createPageFont();

  async function listPages() {
    const { pagesRoot, slug } = currentProject();
    const records = await store.list(pagesRoot);
    return { ok: true, pages: records.map((record) => pageSummary(record, slug)) };
  }

  /** @param {{ pageId: string }} input */
  async function readPage({ pageId }) {
    const { pagesRoot, slug } = currentProject();
    return { ok: true, page: pageSummary(await store.read(pagesRoot, pageId), slug) };
  }

  /**
   * Brings back an earlier kept version as the page's newest one.
   * @param {{ pageId: string, version: number, by: PageAuthor, sessionId?: string }} input
   */
  async function restorePageVersion({ pageId, version, by, sessionId = "" }) {
    const { pagesRoot, slug } = currentProject();
    return { ok: true, page: pageSummary(await store.restoreVersion(pagesRoot, pageId, version, { by, sessionId }), slug) };
  }

  /**
   * A short-lived viewing link to one of the project's pages.
   * @param {{ pageId: string, theme?: string }} input
   */
  async function openPageView({ pageId, theme = "" }) {
    const { pagesRoot, slug } = currentProject();
    const record = await store.read(pagesRoot, pageId);
    const { token, expiresAt } = viewLinks.mint({ pagesRoot, pageId: record.id, theme });
    return { ok: true, page: pageSummary(record, slug), viewPath: `${PAGE_VIEW_ROUTE}/${token}`, expiresAt };
  }

  /** @param {{ pageId: string }} input */
  async function archivePage({ pageId }) {
    const { pagesRoot, slug } = currentProject();
    return { ok: true, page: pageSummary(await store.changeArchived(pagesRoot, pageId, true), slug) };
  }

  /** @param {{ pageId: string }} input */
  async function restorePage({ pageId }) {
    const { pagesRoot, slug } = currentProject();
    return { ok: true, page: pageSummary(await store.changeArchived(pagesRoot, pageId, false), slug) };
  }

  /** @param {{ pageId: string }} input */
  async function deletePage({ pageId }) {
    const { pagesRoot } = currentProject();
    const removed = await store.remove(pagesRoot, pageId);
    viewLinks.revokePage(pagesRoot, removed.id);
    return { ok: true, pageId: removed.id };
  }

  /**
   * Publishes a new page from the agent command's files; without a title, the
   * page's own <title> names it, else the file or folder it came from.
   * @param {{ title?: string, fallbackTitle?: string, files: unknown, by: PageAuthor, sessionId: string }} input
   */
  async function publishPage({ title, fallbackTitle = "", files, by, sessionId }) {
    const { pagesRoot, slug } = currentProject();
    const pageFiles = decodedPageFiles(files);
    const index = pageFiles.find((file) => file.path === "index.html");
    const pageTitle = checkedTitle(title || htmlTitle(index.content) || fallbackTitle || "Untitled page");
    const record = await store.create(pagesRoot, { title: pageTitle, files: pageFiles, by, sessionId });
    return { ok: true, page: pageSummary(record, slug) };
  }

  /**
   * A new version of a current page from the agent command's files.
   * @param {{ pageId: string, title?: string, files: unknown, by: PageAuthor, sessionId: string }} input
   */
  async function updatePage({ pageId, title, files, by, sessionId }) {
    const { pagesRoot, slug } = currentProject();
    const pageFiles = decodedPageFiles(files);
    const record = await store.addVersion(pagesRoot, pageId, {
      title: title ? checkedTitle(title) : "",
      files: pageFiles,
      by,
      sessionId
    });
    return { ok: true, page: pageSummary(record, slug) };
  }

  /**
   * The page a viewing link names, with its current version, while the link lasts.
   * @param {string} token
   */
  async function viewedPage(token) {
    const link = viewLinks.use(token);
    if (!link) return null;
    const current = await store.currentVersion(link.pagesRoot, link.pageId);
    return current ? { link, ...current } : null;
  }

  return Object.freeze({
    archivePage,
    deletePage,
    font,
    listPages,
    openPageView,
    publishPage,
    readPage,
    restorePage,
    restorePageVersion,
    updatePage,
    viewedPage
  });
}

export { createPagesService };
