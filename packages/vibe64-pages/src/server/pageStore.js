// A project's pages in its Vibe64 state, never in the repository:
//
//   <project state>/pages/<page id>/page.json        title, who made it, its session, times, archived
//   <project state>/pages/<page id>/versions/<n>/    the files of version n; the last ten are kept
//
// A version's folder is written beside the others and renamed into place,
// and page.json is replaced in one step after it, so a reader sees the
// previous version or the new one, never half of one.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { serializeByKey, writeJsonFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { vibe64Error } from "@local/vibe64-core/server/core";

import { isPageId } from "../shared/pageLinks.js";
import { PAGE_LIMITS } from "../shared/pageLimits.js";

/** @typedef {import("./pageFiles.js").PageFile} PageFile */
/** @typedef {import("./types.js").PageAuthor} PageAuthor */
/** @typedef {import("./types.js").PageRecord} PageRecord */

const PAGE_CONTRACT = "vibe64.page.v1";
const PAGE_RECORD_FILE = "page.json";
const VERSIONS_DIR = "versions";
const PAGES_DIR = "pages";

function pageNotFound(pageId) {
  return vibe64Error(`No page ${pageId} exists in this project.`, "vibe64_pages_not_found", { status: 404, params: { pageId } });
}

/**
 * The folder holding a project's pages.
 * @param {string} projectRuntimeRoot
 */
function projectPagesRoot(projectRuntimeRoot) {
  const root = String(projectRuntimeRoot || "").trim();
  if (!path.isAbsolute(root)) {
    throw vibe64Error("Pages need this project's Vibe64 state folder.", "vibe64_pages_state_unavailable", { status: 409 });
  }
  return path.join(root, PAGES_DIR);
}

function pageFolder(pagesRoot, pageId) {
  if (!isPageId(pageId)) throw pageNotFound(String(pageId || "").slice(0, 64));
  return path.join(pagesRoot, pageId);
}

/**
 * A readable page id for a title: its words, then six random hex digits.
 * @param {string} title
 */
function pageIdForTitle(title) {
  const words = title.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 40).replace(/-+$/u, "");
  return `${words || "page"}-${randomBytes(3).toString("hex")}`;
}

function author(value) {
  return { id: String(value?.id || "").slice(0, 200), name: String(value?.name || value?.id || "").slice(0, 200) };
}

/**
 * The stored record, or null when the folder holds no page (a creation that
 * never finished, or something else).
 * @param {string} folder
 * @param {string} pageId
 * @returns {Promise<PageRecord | null>}
 */
async function readPageRecord(folder, pageId) {
  let record;
  try {
    record = JSON.parse(await readFile(path.join(folder, PAGE_RECORD_FILE), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error instanceof SyntaxError) return null;
    throw error;
  }
  if (record?.contract !== PAGE_CONTRACT || record.id !== pageId || !Number.isInteger(record.version)) return null;
  return record;
}

/**
 * Writes a version's files into a new folder beside the kept versions and
 * renames it to its number.
 * @param {string} folder
 * @param {number} number
 * @param {PageFile[]} files
 */
async function writeVersion(folder, number, files) {
  const versions = path.join(folder, VERSIONS_DIR);
  await mkdir(versions, { recursive: true });
  const incoming = path.join(versions, `.incoming-${randomBytes(8).toString("hex")}`);
  try {
    for (const file of files) {
      const target = path.join(incoming, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, { flag: "wx" });
    }
    await rename(incoming, path.join(versions, String(number)));
  } finally {
    await rm(incoming, { force: true, recursive: true });
  }
}

function versionEntry({ number, files, by, sessionId, at, restoredFrom = 0 }) {
  return {
    number,
    createdAt: at,
    createdBy: by,
    sessionId,
    files: files.length,
    bytes: files.reduce((total, file) => total + file.content.length, 0),
    ...(restoredFrom ? { restoredFrom } : {})
  };
}

/**
 * Every file of a kept version, as it was published.
 * @param {string} versionFolder
 * @returns {Promise<PageFile[]>}
 */
async function readVersionFiles(versionFolder) {
  const files = [];
  async function walk(folder, prefix) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(folder, entry.name), relative);
      else if (entry.isFile()) files.push({ path: relative, content: await readFile(path.join(folder, entry.name)) });
    }
  }
  await walk(versionFolder, "");
  return files;
}

/**
 * The store of every project's pages; each operation names the project's
 * pages folder (projectPagesRoot), and one page changes one step at a time.
 * @param {object} [options]
 * @param {() => string} [options.now]
 */
function createPageStore({ now = () => new Date().toISOString() } = {}) {
  const pending = new Map();
  const exclusive = (folder, operation) => serializeByKey(pending, folder, operation);

  /**
   * @param {string} pagesRoot
   * @returns {Promise<PageRecord[]>} newest update first
   */
  async function list(pagesRoot) {
    let entries;
    try {
      entries = await readdir(pagesRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const records = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && isPageId(entry.name))
      .map((entry) => readPageRecord(path.join(pagesRoot, entry.name), entry.name)));
    return records.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }

  /**
   * @param {string} pagesRoot
   * @param {string} pageId
   */
  async function read(pagesRoot, pageId) {
    const record = await readPageRecord(pageFolder(pagesRoot, pageId), pageId);
    if (!record) throw pageNotFound(pageId);
    return record;
  }

  /**
   * A new page holding version 1.
   * @param {string} pagesRoot
   * @param {{ title: string, files: PageFile[], by: PageAuthor, sessionId: string }} input
   */
  async function create(pagesRoot, { title, files, by, sessionId }) {
    await mkdir(pagesRoot, { recursive: true });
    let pageId = "";
    let folder = "";
    for (let attempt = 0; !folder; attempt += 1) {
      pageId = pageIdForTitle(title);
      try {
        await mkdir(path.join(pagesRoot, pageId));
        folder = path.join(pagesRoot, pageId);
      } catch (error) {
        if (error?.code !== "EEXIST" || attempt === 4) throw error;
      }
    }
    return exclusive(folder, async () => {
      const at = now();
      const maker = author(by);
      await writeVersion(folder, 1, files);
      const record = {
        contract: PAGE_CONTRACT,
        id: pageId,
        title,
        createdBy: maker,
        sessionId,
        createdAt: at,
        updatedAt: at,
        updatedBy: maker,
        archived: false,
        archivedAt: null,
        version: 1,
        versions: [versionEntry({ number: 1, files, by: maker, sessionId, at })]
      };
      await writeJsonFileAtomic(path.join(folder, PAGE_RECORD_FILE), record);
      return record;
    });
  }

  /**
   * Appends a version to a current page, keeping the last ten; the caller holds the page.
   * @param {string} folder
   * @param {PageRecord} current
   * @param {{ title?: string, files: PageFile[], by: PageAuthor, sessionId: string, restoredFrom?: number }} input
   */
  async function appendVersion(folder, current, { title, files, by, sessionId, restoredFrom = 0 }) {
    if (current.archived) {
      throw vibe64Error(
        `Page ${current.id} is archived. Restore it from the Pages list before changing it.`,
        "vibe64_pages_archived",
        { status: 409, params: { pageId: current.id } }
      );
    }
    const at = now();
    const maker = author(by);
    const number = current.version + 1;
    await writeVersion(folder, number, files);
    const versions = [...current.versions, versionEntry({ number, files, by: maker, sessionId, at, restoredFrom })]
      .slice(-PAGE_LIMITS.versionsKept);
    const record = { ...current, title: title || current.title, updatedAt: at, updatedBy: maker, version: number, versions };
    await writeJsonFileAtomic(path.join(folder, PAGE_RECORD_FILE), record);
    const kept = new Set(versions.map((version) => String(version.number)));
    const stored = await readdir(path.join(folder, VERSIONS_DIR));
    await Promise.all(stored
      .filter((name) => /^\d+$/u.test(name) && !kept.has(name))
      .map((name) => rm(path.join(folder, VERSIONS_DIR, name), { force: true, recursive: true })));
    return record;
  }

  /**
   * A new version of a current page.
   * @param {string} pagesRoot
   * @param {string} pageId
   * @param {{ title?: string, files: PageFile[], by: PageAuthor, sessionId: string }} input
   */
  async function addVersion(pagesRoot, pageId, input) {
    const folder = pageFolder(pagesRoot, pageId);
    return exclusive(folder, async () => appendVersion(folder, await read(pagesRoot, pageId), input));
  }

  /**
   * Brings back an earlier kept version as the page's newest one, so nothing
   * it replaces is lost.
   * @param {string} pagesRoot
   * @param {string} pageId
   * @param {number} number
   * @param {{ by: PageAuthor, sessionId?: string }} input
   */
  async function restoreVersion(pagesRoot, pageId, number, { by, sessionId = "" }) {
    const folder = pageFolder(pagesRoot, pageId);
    return exclusive(folder, async () => {
      const current = await read(pagesRoot, pageId);
      if (number === current.version) return current;
      if (!current.versions.some((version) => version.number === number)) {
        throw vibe64Error(
          `Page ${pageId} keeps no version ${number}; it keeps versions ${current.versions.map((version) => version.number).join(", ")}.`,
          "vibe64_pages_version_not_found",
          { status: 404, params: { pageId, version: number } }
        );
      }
      const files = await readVersionFiles(path.join(folder, VERSIONS_DIR, String(number)));
      return appendVersion(folder, current, { files, by, sessionId, restoredFrom: number });
    });
  }

  /**
   * Archives or restores a page.
   * @param {string} pagesRoot
   * @param {string} pageId
   * @param {boolean} archived
   */
  async function changeArchived(pagesRoot, pageId, archived) {
    const folder = pageFolder(pagesRoot, pageId);
    return exclusive(folder, async () => {
      const current = await read(pagesRoot, pageId);
      if (current.archived === archived) return current;
      const record = { ...current, archived, archivedAt: archived ? now() : null };
      await writeJsonFileAtomic(path.join(folder, PAGE_RECORD_FILE), record);
      return record;
    });
  }

  /**
   * Deletes an archived page and every version it kept.
   * @param {string} pagesRoot
   * @param {string} pageId
   */
  async function remove(pagesRoot, pageId) {
    const folder = pageFolder(pagesRoot, pageId);
    return exclusive(folder, async () => {
      const current = await read(pagesRoot, pageId);
      if (!current.archived) {
        throw vibe64Error(`Archive page ${pageId} before deleting it.`, "vibe64_pages_delete_requires_archive", { status: 409, params: { pageId } });
      }
      const doomed = path.join(pagesRoot, `.deleting-${pageId}-${randomBytes(4).toString("hex")}`);
      await rename(folder, doomed);
      await rm(doomed, { force: true, recursive: true });
      return current;
    });
  }

  /**
   * The folder of a page's current version and the page's record, or null.
   * @param {string} pagesRoot
   * @param {string} pageId
   */
  async function currentVersion(pagesRoot, pageId) {
    if (!isPageId(pageId)) return null;
    const folder = path.join(pagesRoot, pageId);
    const record = await readPageRecord(folder, pageId);
    if (!record) return null;
    const versionFolder = path.join(folder, VERSIONS_DIR, String(record.version));
    try {
      if (!(await lstat(versionFolder)).isDirectory()) return null;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    return { record, versionFolder };
  }

  return Object.freeze({
    addVersion,
    changeArchived,
    create,
    currentVersion,
    list,
    read,
    remove,
    restoreVersion
  });
}

export { createPageStore, projectPagesRoot };
