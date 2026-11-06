// How a page runs: never as Vibe64. Its files come only from its viewing link,
// each with a Content-Security-Policy that admits nothing but that link's own
// files and turns the document into a sandbox with an opaque origin, so it has
// no cookies and no reach into Vibe64. The frame around it (the viewer's frame
// host) is just as sandboxed and lets the page navigate only inside its files.
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { relativePathInside } from "@local/vibe64-core/server/core";

import { PAGE_STYLESHEET_PATH } from "../shared/pageLimits.js";
import { pageFilePath } from "./pageFiles.js";
import { pageStylesheet } from "./pageStylesheet.js";

/** @typedef {import("./pageViewLinks.js").PageViewLink} PageViewLink */

const PAGE_VIEW_ROUTE = "/api/vibe64/pages/view";
const PAGE_FILES_ROUTE = "/api/vibe64/pages/files";
const PAGE_FONT_PATH = "_vibe64/roboto.woff2";
const SANDBOX = "allow-scripts allow-forms allow-modals";

const CONTENT_TYPES = Object.freeze({
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".gif": "image/gif",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8"
});

/**
 * The origin the browser used for this request: its Host, with the scheme a
 * proxy in front reports. A page cannot change either.
 * @param {{ headers?: Record<string, string | string[] | undefined>, protocol?: string }} request
 */
function requestOrigin(request) {
  const host = String(request.headers?.host || "").trim();
  if (!host || /[\s/\\@?#,;'"]/u.test(host)) return "";
  const forwarded = String(request.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  const protocol = ["http", "https"].includes(forwarded) ? forwarded : request.protocol === "https" ? "https" : "http";
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "";
  }
}

/**
 * The address of a viewing link's files, as a CSP source and a frame source.
 * @param {string} origin
 * @param {string} token
 */
function pageFilesBase(origin, token) {
  return `${origin}${PAGE_FILES_ROUTE}/${token}/`;
}

/**
 * The policy of a page's own files: only that link's files, never anything else.
 * @param {string} filesBase
 */
function pageContentSecurityPolicy(filesBase) {
  return [
    "default-src 'none'",
    `script-src ${filesBase} 'unsafe-inline' 'unsafe-eval'`,
    `style-src ${filesBase} 'unsafe-inline'`,
    `img-src ${filesBase} data: blob:`,
    `font-src ${filesBase} data:`,
    `media-src ${filesBase} data: blob:`,
    `connect-src ${filesBase}`,
    `frame-src ${filesBase}`,
    `child-src ${filesBase}`,
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `sandbox ${SANDBOX}`
  ].join("; ");
}

/**
 * The policy of the frame host: no content of its own, and a frame that may
 * only show the link's files, wherever the page tries to take it.
 * @param {string} filesBase
 */
function frameHostContentSecurityPolicy(filesBase) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src ${filesBase}`,
    "form-action 'none'",
    "base-uri 'none'",
    `sandbox ${SANDBOX}`
  ].join("; ");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

/**
 * The frame host: one full-size sandboxed frame showing the page.
 * @param {{ title: string, filesPath: string, theme: string }} input filesPath is the link's files path, ending in /
 */
function frameHostHtml({ title, filesPath, theme }) {
  const colorScheme = theme || "light dark";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>:root{color-scheme:${colorScheme}}html,body{margin:0;height:100%;background:Canvas}iframe{border:0;display:block;width:100%;height:100%}</style>
</head>
<body><iframe src="${escapeHtml(filesPath)}index.html" sandbox="${SANDBOX}" referrerpolicy="no-referrer" title="${escapeHtml(title)}"></iframe></body>
</html>
`;
}

/** Headers every sandboxed response carries. */
function sandboxHeaders(policy) {
  return {
    "content-security-policy": policy,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-dns-prefetch-control": "off"
  };
}

/**
 * The file a viewing link's request names in a version folder, or null when
 * it names none: the folder's index.html for a folder, never a link or a path
 * outside it.
 * @param {string} versionFolder
 * @param {string} requested
 */
async function versionFile(versionFolder, requested) {
  const relative = requested === "" || requested.endsWith("/") ? `${requested}index.html` : requested;
  let filePath;
  try {
    filePath = path.join(versionFolder, ...pageFilePath(relative).split("/"));
  } catch {
    return null;
  }
  try {
    const stat = await lstat(filePath);
    if (!stat.isFile()) return null;
    const real = await realpath(filePath);
    if (relativePathInside(await realpath(versionFolder), real) === null) return null;
    return { content: await readFile(real), filePath };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * The response for one request inside a viewing link: the stylesheet and font
 * Vibe64 offers every page, or the page's own file.
 * @param {object} input
 * @param {PageViewLink} input.link
 * @param {string} input.requested the path below the link, as the browser asked for it
 * @param {string} input.versionFolder the page's current version
 * @param {() => Promise<Buffer>} input.font
 * @returns {Promise<{ contentType: string, body: Buffer | string } | null>}
 */
async function pageFileResponse({ link, requested, versionFolder, font }) {
  if (requested === PAGE_STYLESHEET_PATH) return { contentType: CONTENT_TYPES[".css"], body: pageStylesheet(link.theme) };
  if (requested === PAGE_FONT_PATH) return { contentType: CONTENT_TYPES[".woff2"], body: await font() };
  const file = await versionFile(versionFolder, requested);
  if (!file) return null;
  return {
    contentType: CONTENT_TYPES[path.extname(file.filePath).toLowerCase()] || "application/octet-stream",
    body: file.content
  };
}

export {
  frameHostContentSecurityPolicy,
  frameHostHtml,
  PAGE_FILES_ROUTE,
  PAGE_VIEW_ROUTE,
  pageContentSecurityPolicy,
  pageFileResponse,
  pageFilesBase,
  requestOrigin,
  sandboxHeaders
};
