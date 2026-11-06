// A project's pages: what project members list, open, star, archive, restore
// and delete, and what a session's agent publishes and updates through its
// command. Every operation runs inside the project request context that the
// project access check (or the agent command's project binding) set up.
import { vibe64Error } from "@local/vibe64-core/server/core";

import { pageAppPath } from "../shared/pageLinks.js";
import { checkedTitle, decodedPageFiles, htmlTitle } from "./pageFiles.js";
import { createPageRefreshRecords } from "./pageRefreshRecords.js";
import { createPageRefreshes, INTERPRETERS } from "./pageRefreshes.js";
import { checkedSchedule, nextRefreshAt, scheduleText } from "./pageRefreshSchedule.js";
import { changePageStar, forgetPageStars, readPageStars } from "./pageStars.js";
import { createPageStore, currentProjectPages, pageFolder } from "./pageStore.js";
import { createPageViewLinks } from "./pageViewLinks.js";
import { PAGE_VIEW_ROUTE } from "./pageSandbox.js";
import { createPageDesignGuide, createPageFont } from "./pageStylesheet.js";

/** @typedef {import("./types.js").PageAuthor} PageAuthor */
/** @typedef {import("./types.js").PageRecord} PageRecord */
/** @typedef {import("./types.js").PageSummary} PageSummary */
/** @typedef {import("./types.js").PageRefreshTasks} PageRefreshTasks */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const SCRIPT_MAX_BYTES = 256 * 1024;
const PROMPT_MAX_LENGTH = 4000;
const DATA_MAX_BYTES = 5 * 1024 * 1024;

function refreshRefusal(message, code = "vibe64_pages_refresh_invalid") {
  return vibe64Error(message, code, { status: 400 });
}

/**
 * What everyone sees of a page's refresh: its schedule and state, and how the last run went.
 * @param {object | null} refresh
 */
function refreshSummary(refresh) {
  if (!refresh) return null;
  const last = refresh.runs.at(-1);
  return {
    kind: refresh.kind,
    schedule: scheduleText(refresh.schedule),
    scheduledBy: refresh.scheduledBy,
    sessionId: refresh.sessionId,
    nextAt: refresh.nextAt,
    paused: refresh.paused,
    pausedReason: refresh.pausedReason,
    failures: refresh.failures,
    running: refresh.running
      ? { startedAt: refresh.running.startedAt, ...(refresh.running.taskId ? { taskId: refresh.running.taskId } : {}) }
      : null,
    lastRun: last ? { ...last, log: undefined } : null
  };
}

/**
 * What a project member or the agent sees of a page.
 * @param {PageRecord} record
 * @param {string} projectSlug
 * @param {object | null} [refresh]
 * @returns {PageSummary}
 */
function pageSummary(record, projectSlug, refresh = null) {
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
    versions: record.versions.map(({ number, title, createdAt, createdBy, restoredFrom }) => ({
      number, title: title || record.title, createdAt, createdBy, ...(restoredFrom ? { restoredFrom } : {})
    })),
    link: pageAppPath(projectSlug, record.id),
    refresh: refreshSummary(refresh)
  };
}

/**
 * The script a command refresh runs, as the agent command sent it.
 * @param {{ name?: string, base64?: string } | undefined} script
 */
function checkedScript(script) {
  const name = String(script?.name || "");
  if (!SCRIPT_NAME.test(name) || !INTERPRETERS[name.slice(name.lastIndexOf("."))]) {
    throw refreshRefusal("A refresh script is a .mjs, .js, .cjs, .py or .sh file.");
  }
  const content = Buffer.from(String(script.base64 || ""), "base64");
  if (!content.length) throw refreshRefusal("The refresh script is empty.");
  if (content.length > SCRIPT_MAX_BYTES) throw refreshRefusal("A refresh script holds at most 256 KiB.");
  return { name, content };
}

/**
 * @param {object} dependencies
 * @param {() => string} dependencies.now the time a version records, as ISO text
 * @param {() => number} dependencies.clock the milliseconds viewing links expire by and refreshes fall due
 * @param {ProjectService} dependencies.project reads the saved project and enters each project for its refreshes
 * @param {RuntimeLogger} dependencies.logger
 * @param {Function} [dependencies.runCommand] runs a command refresh's script
 * @param {number} [dependencies.refreshTaskPollMs] how often a running prompt refresh's task is read
 */
function createPagesService({ now, clock, project, logger, runCommand, refreshTaskPollMs }) {
  const store = createPageStore({ now });
  const viewLinks = createPageViewLinks({ clock });
  const font = createPageFont();
  const designGuide = createPageDesignGuide();
  const refreshRecords = createPageRefreshRecords();
  const writeData = (pagesRoot, pageId, data, by, sessionId) => store.addDataVersion(pagesRoot, pageId, { data, by, sessionId });
  const refreshes = createPageRefreshes({
    project,
    store,
    records: refreshRecords,
    writeData,
    logger,
    clock,
    ...(runCommand ? { runCommand } : {}),
    ...(refreshTaskPollMs ? { taskPollMs: refreshTaskPollMs } : {})
  });

  async function summarise(pagesRoot, slug, record) {
    return pageSummary(record, slug, await refreshRecords.read(pageFolder(pagesRoot, record.id)));
  }

  async function listPages() {
    const { pagesRoot, slug } = currentProjectPages();
    const records = await store.list(pagesRoot);
    return { ok: true, pages: await Promise.all(records.map((record) => summarise(pagesRoot, slug, record))) };
  }

  /** @param {{ pageId: string }} input */
  async function readPage({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    return { ok: true, page: await summarise(pagesRoot, slug, await store.read(pagesRoot, pageId)) };
  }

  /**
   * The current pages among these ids, in their order: an archived page is
   * left out until it is restored, and a missing one is skipped.
   * @param {string} pagesRoot
   * @param {string} slug
   * @param {string[]} pageIds
   */
  async function currentPagesAmong(pagesRoot, slug, pageIds) {
    const records = await Promise.all(pageIds.map((pageId) => store.read(pagesRoot, pageId).catch((error) => {
      if (error?.code === "vibe64_pages_not_found") return null;
      throw error;
    })));
    return records.filter((record) => record && !record.archived).map((record) => pageSummary(record, slug));
  }

  /**
   * The current pages this person starred, in the order they starred them.
   * @param {{ vibe64User?: object | null }} input
   */
  async function starredPages({ vibe64User }) {
    const { pagesRoot, slug } = currentProjectPages();
    return { ok: true, pages: await currentPagesAmong(pagesRoot, slug, await readPageStars(pagesRoot, vibe64User)) };
  }

  /**
   * Stars or unstars a page for this person; a star needs a page to name.
   * @param {{ pageId: string, starred: boolean, vibe64User?: object | null }} input
   */
  async function setPageStar({ pageId, starred, vibe64User }) {
    const { pagesRoot, slug } = currentProjectPages();
    if (starred) await store.read(pagesRoot, pageId);
    const pageIds = await changePageStar(pagesRoot, vibe64User, pageId, starred);
    return { ok: true, pages: await currentPagesAmong(pagesRoot, slug, pageIds) };
  }

  /**
   * Brings back an earlier kept version as the page's newest one.
   * @param {{ pageId: string, version: number, by: PageAuthor, sessionId?: string }} input
   */
  async function restorePageVersion({ pageId, version, by, sessionId = "" }) {
    const { pagesRoot, slug } = currentProjectPages();
    return { ok: true, page: await summarise(pagesRoot, slug, await store.restoreVersion(pagesRoot, pageId, version, { by, sessionId })) };
  }

  /**
   * A short-lived viewing link to one of the project's pages.
   * @param {{ pageId: string, theme?: string }} input
   */
  async function openPageView({ pageId, theme = "" }) {
    const { pagesRoot, slug } = currentProjectPages();
    const record = await store.read(pagesRoot, pageId);
    const { token, expiresAt } = viewLinks.mint({ pagesRoot, pageId: record.id, theme });
    return { ok: true, page: await summarise(pagesRoot, slug, record), viewPath: `${PAGE_VIEW_ROUTE}/${token}`, expiresAt };
  }

  /** Archiving stops the page's refreshes, and cancels one that is running. */
  async function archivePage({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const record = await store.changeArchived(pagesRoot, pageId, true);
    await refreshes.cancel(slug, record.id);
    const refresh = await refreshRecords.read(pageFolder(pagesRoot, record.id));
    refreshes.track(slug, record.id, refresh, record);
    return { ok: true, page: pageSummary(record, slug, refresh) };
  }

  /** Restoring starts a page's refreshes again from now. */
  async function restorePage({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const record = await store.changeArchived(pagesRoot, pageId, false);
    const refresh = await refreshRecords.change(pageFolder(pagesRoot, record.id), (current) => current && {
      ...current,
      nextAt: new Date(nextRefreshAt(current.schedule, { after: clock(), anchor: Date.parse(current.scheduledAt) })).toISOString()
    });
    refreshes.track(slug, record.id, refresh, record);
    return { ok: true, page: pageSummary(record, slug, refresh) };
  }

  /** @param {{ pageId: string }} input */
  async function deletePage({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const removed = await store.remove(pagesRoot, pageId);
    viewLinks.revokePage(pagesRoot, removed.id);
    await forgetPageStars(pagesRoot, removed.id);
    refreshes.track(slug, removed.id, null, null);
    return { ok: true, pageId: removed.id };
  }

  /**
   * Sets how a page refreshes, from the agent command: a command refresh runs its script, a
   * prompt refresh asks the AI in this session. Setting it again replaces it and starts it afresh,
   * run as the person who set it.
   * @param {{ pageId: string, kind: string, every?: string, daily?: string, timeZone?: string, script?: object, prompt?: string, by: PageAuthor, sessionId: string }} input
   */
  async function setPageRefresh({ pageId, kind, every, daily, timeZone, script, prompt, by, sessionId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    if (page.archived) throw vibe64Error(`Page ${pageId} is archived. Restore it before setting its refresh.`, "vibe64_pages_archived", { status: 409 });
    const schedule = checkedSchedule({ every, daily, timeZone });
    const command = kind === "command" ? checkedScript(script) : null;
    const text = String(prompt || "").trim();
    if (kind !== "command" && kind !== "prompt") throw refreshRefusal("A refresh runs a --command script or a --prompt.");
    if (kind === "prompt" && (!text || text.length > PROMPT_MAX_LENGTH)) throw refreshRefusal("A prompt refresh needs its prompt, at most 4000 characters.");
    const folder = pageFolder(pagesRoot, page.id);
    if (refreshes.running(slug, page.id)) await refreshes.cancel(slug, page.id);
    const scheduledAt = clock();
    const record = await refreshRecords.replace(folder, {
      kind,
      schedule,
      ...(command ? { script: command.name } : { prompt: text }),
      sessionId,
      scheduledBy: by,
      scheduledAt: new Date(scheduledAt).toISOString(),
      paused: false,
      pausedReason: "",
      failures: 0,
      nextAt: new Date(nextRefreshAt(schedule, { after: scheduledAt, anchor: scheduledAt })).toISOString(),
      running: null,
      runs: (await refreshRecords.read(folder))?.runs || []
    }, command);
    refreshes.track(slug, page.id, record, page);
    return { ok: true, page: pageSummary(page, slug, record) };
  }

  /** Stops a page's refreshes for good; its last version stays. */
  async function removePageRefresh({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    await refreshes.cancel(slug, page.id);
    await refreshRecords.remove(pageFolder(pagesRoot, page.id));
    refreshes.track(slug, page.id, null, null);
    return { ok: true, page: pageSummary(page, slug, null) };
  }

  /**
   * A new version with new data.json and every other file kept, from the agent command.
   * @param {{ pageId: string, data: string, by: PageAuthor, sessionId: string }} input data as base64
   */
  async function updatePageData({ pageId, data, by, sessionId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const content = Buffer.from(String(data || ""), "base64");
    if (content.length > DATA_MAX_BYTES) throw refreshRefusal("A page's data.json holds at most 5 MiB.");
    try {
      JSON.parse(content.toString("utf8"));
    } catch (error) {
      throw refreshRefusal(`That file is not valid JSON: ${error.message}`);
    }
    const record = await store.addDataVersion(pagesRoot, pageId, { data: content, by, sessionId });
    return { ok: true, page: await summarise(pagesRoot, slug, record) };
  }

  async function changeRefresh(pageId, edit) {
    const { pagesRoot, slug } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    const refresh = await refreshRecords.change(pageFolder(pagesRoot, page.id), (current) => {
      if (!current) throw vibe64Error("This page has no refresh.", "vibe64_pages_refresh_missing", { status: 404 });
      return edit(current);
    });
    refreshes.track(slug, page.id, refresh, page);
    return { ok: true, page: pageSummary(page, slug, refresh) };
  }

  /** @param {{ pageId: string, by: PageAuthor }} input */
  function pauseRefresh({ pageId, by }) {
    return changeRefresh(pageId, (current) => ({ ...current, paused: true, pausedReason: `Paused by ${by.name || by.id}.`, pausedAt: new Date(clock()).toISOString() }));
  }

  /** Resuming runs the refresh as the person who resumed it, from now on. */
  function resumeRefresh({ pageId, by }) {
    return changeRefresh(pageId, (current) => {
      const scheduledAt = clock();
      return {
        ...current,
        scheduledBy: by,
        scheduledAt: new Date(scheduledAt).toISOString(),
        paused: false,
        pausedReason: "",
        failures: 0,
        nextAt: new Date(nextRefreshAt(current.schedule, { after: scheduledAt, anchor: scheduledAt })).toISOString()
      };
    });
  }

  /** Runs a page's refresh once now; its schedule carries on as it was. */
  async function runRefreshNow({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    const refresh = await refreshes.begin(slug, page.id, { scheduled: false });
    if (!refresh) throw vibe64Error("This page has no refresh.", "vibe64_pages_refresh_missing", { status: 404 });
    return { ok: true, page: pageSummary(page, slug, refresh) };
  }

  /** Cancels a running refresh; the page keeps the version it has. */
  async function cancelRefresh({ pageId }) {
    const { pagesRoot, slug } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    await refreshes.cancel(slug, page.id);
    return { ok: true, page: await summarise(pagesRoot, slug, page) };
  }

  /** A page's last refresh runs, newest first, with their logs. */
  async function refreshRuns({ pageId }) {
    const { pagesRoot } = currentProjectPages();
    const page = await store.read(pagesRoot, pageId);
    const refresh = await refreshRecords.read(pageFolder(pagesRoot, page.id));
    return { ok: true, pageId: page.id, runs: [...(refresh?.runs || [])].reverse() };
  }

  /**
   * Publishes a new page from the agent command's files; without a title, the
   * page's own <title> names it, else the file or folder it came from.
   * @param {{ title?: string, fallbackTitle?: string, files: unknown, by: PageAuthor, sessionId: string }} input
   */
  async function publishPage({ title, fallbackTitle = "", files, by, sessionId }) {
    const { pagesRoot, slug } = currentProjectPages();
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
    const { pagesRoot, slug } = currentProjectPages();
    const pageFiles = decodedPageFiles(files);
    const record = await store.addVersion(pagesRoot, pageId, {
      title: title ? checkedTitle(title) : "",
      files: pageFiles,
      by,
      sessionId
    });
    return { ok: true, page: await summarise(pagesRoot, slug, record) };
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
    cancelRefresh,
    closeRefreshes: refreshes.close,
    deletePage,
    designGuide,
    font,
    listPages,
    openPageView,
    pauseRefresh,
    publishPage,
    readPage,
    refreshRuns,
    removePageRefresh,
    restorePage,
    restorePageVersion,
    resumeRefresh,
    resumeRefreshes: refreshes.resume,
    runRefreshNow,
    // readable-check: allow setter-seam - not a slot: setPageRefresh sets one page's refresh schedule
    setPageRefresh,
    // readable-check: allow setter-seam - not a slot: setPageStar stars a page for one person
    setPageStar,
    // readable-check: allow setter-seam - cycle: vibe64.ai-tasks requires vibe64.pages, and runs a prompt refresh as an AI task
    setRefreshTasks: refreshes.setTasks,
    starredPages,
    updatePage,
    updatePageData,
    viewedPage
  });
}

export { createPagesService };
