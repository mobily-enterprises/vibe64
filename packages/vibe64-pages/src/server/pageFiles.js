// The files of one page version: the paths a page may use and the limits it
// must keep, checked before anything is written.
import { vibe64Error } from "@local/vibe64-core/server/core";

import { PAGE_LIMITS } from "../shared/pageLimits.js";

const RESERVED_TOP_FOLDER = "_vibe64";
// eslint-disable-next-line no-control-regex -- a page path never holds a control character
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

/**
 * @typedef {object} PageFile
 * @property {string} path the file's place below the page's top folder, with / between folders
 * @property {Buffer} content
 */

function invalidFiles(message, params = {}) {
  return vibe64Error(message, "vibe64_pages_files_invalid", { status: 400, params });
}

/**
 * The normalised path of one page file, or an error naming what is wrong.
 * @param {unknown} value
 */
function pageFilePath(value) {
  const text = typeof value === "string" ? value : "";
  if (!text || text.length > PAGE_LIMITS.maxPathLength || text.startsWith("/") || text.includes("\\") ||
      CONTROL_CHARACTERS.test(text)) {
    throw invalidFiles(`A page file path is not usable: ${JSON.stringify(text.slice(0, 80))}.`, { path: text.slice(0, 80) });
  }
  const segments = text.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." || segment.startsWith(".") ||
        segment.length > PAGE_LIMITS.maxSegmentLength) {
      throw invalidFiles(`A page file path is not usable: ${JSON.stringify(text)}. Hidden names and empty, . or .. parts are not allowed.`, { path: text });
    }
  }
  if (segments[0] === RESERVED_TOP_FOLDER) {
    throw invalidFiles(`The ${RESERVED_TOP_FOLDER} folder belongs to Vibe64; rename ${text}.`, { path: text });
  }
  return segments.join("/");
}

/**
 * The checked files of a new page version: within the limits, each path once,
 * no file in a folder's place, and an index.html at the top.
 * @param {{ path: unknown, content: Buffer }[]} files
 * @returns {PageFile[]}
 */
function checkedPageFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw invalidFiles("A page needs at least its index.html.");
  }
  if (files.length > PAGE_LIMITS.maxFiles) {
    throw invalidFiles(`A page holds at most ${PAGE_LIMITS.maxFiles} files; this one has ${files.length}.`);
  }
  let totalBytes = 0;
  const byPath = new Map();
  for (const file of files) {
    const filePath = pageFilePath(file?.path);
    if (!Buffer.isBuffer(file.content)) throw invalidFiles(`The content of ${filePath} is missing.`, { path: filePath });
    if (byPath.has(filePath)) throw invalidFiles(`${filePath} appears twice.`, { path: filePath });
    totalBytes += file.content.length;
    byPath.set(filePath, file.content);
  }
  if (totalBytes > PAGE_LIMITS.maxTotalBytes) {
    throw invalidFiles(`A page holds at most ${PAGE_LIMITS.maxTotalBytes / (1024 * 1024)} MiB; this one has ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB.`);
  }
  for (const filePath of byPath.keys()) {
    const segments = filePath.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join("/");
      if (byPath.has(folder)) throw invalidFiles(`${folder} is both a file and a folder.`, { path: folder });
    }
  }
  if (!byPath.has("index.html")) {
    throw invalidFiles("A page needs an index.html at its top folder.");
  }
  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, content]) => ({ path: filePath, content }));
}

/**
 * The files sent by the agent command, each as { path, base64 }.
 * @param {unknown} files
 * @returns {PageFile[]}
 */
function decodedPageFiles(files) {
  if (!Array.isArray(files)) throw invalidFiles("The page files are missing.");
  if (files.length > PAGE_LIMITS.maxFiles) {
    throw invalidFiles(`A page holds at most ${PAGE_LIMITS.maxFiles} files; this one has ${files.length}.`);
  }
  return checkedPageFiles(files.map((file) => ({
    path: file?.path,
    content: typeof file?.base64 === "string" ? Buffer.from(file.base64, "base64") : null
  })));
}

/**
 * The title an HTML page gives itself, or "".
 * @param {Buffer | string} html
 */
function htmlTitle(html) {
  const match = /<title[^>]*>([\s\S]{0,2000}?)<\/title>/iu.exec(String(html).slice(0, 64 * 1024));
  if (!match) return "";
  return match[1]
    .replace(/<[^>]*>/gu, "")
    .replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"").replace(/&#0?39;|&apos;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, PAGE_LIMITS.maxTitleLength);
}

/**
 * A page title: one line, at most 120 characters.
 * @param {unknown} value
 */
function checkedTitle(value) {
  const title = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!title) throw vibe64Error("A page needs a title.", "vibe64_pages_title_required", { status: 400 });
  if (title.length > PAGE_LIMITS.maxTitleLength) {
    throw vibe64Error(`A page title has at most ${PAGE_LIMITS.maxTitleLength} characters.`, "vibe64_pages_title_too_long", { status: 400 });
  }
  return title;
}

export { checkedPageFiles, checkedTitle, decodedPageFiles, htmlTitle, pageFilePath };
