import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { API_BASE_PATH, matchesPathPrefix, normalizePathname, toRequestPathname } from "@jskit-ai/kernel/shared/surface/paths";

const SPA_INDEX_FILE = "index.html";
const STATIC_GLOBAL_UI_PATHS = Object.freeze([
  "/assets",
  "/favicon.svg",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest"
]);
// Vite writes under assets/ only files named by their content's hash, however the build splits them, and copies
// public/'s files beside index.html instead; so a file under assets/ never changes at its address, and browsers keep
// it for good. The page and every other file are fetched again on each use, so a plain reload after an update runs
// the new build: with no validator, because @fastify/send's ETag and Last-Modified come from a file's size and date,
// and an installation such as the Nix store dates every file 1970, so a changed file of the same size would match
// and the browser would keep the old one.
const HASHED_BUILD_FILES = "assets/";
const HASHED_BUILD_FILE_CACHE = Object.freeze({ maxAge: 365 * 24 * 60 * 60 * 1000, immutable: true });
const UNHASHED_FILE_CACHE = "no-cache";
const UNHASHED_FILE_SEND = Object.freeze({ cacheControl: false, etag: false, lastModified: false });

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, API_BASE_PATH);
}

function hasFileExtension(pathname) {
  return path.extname(normalizePathname(pathname)) !== "";
}

/**
 * The runtime's global UI paths plus the static files every surface serves.
 * @param {readonly string[]} runtimeGlobalUiPaths
 */
function buildGlobalUiPaths(runtimeGlobalUiPaths) {
  const paths = new Set(runtimeGlobalUiPaths);
  for (const staticPath of STATIC_GLOBAL_UI_PATHS) {
    paths.add(staticPath);
  }
  return [...paths];
}

function toStaticFilePath(pathname) {
  const normalizedPathname = normalizePathname(pathname);

  const relativePath = normalizedPathname.replace(/^\/+/, "");
  if (!relativePath || relativePath.endsWith("/")) {
    return "";
  }

  const normalizedRelativePath = path.posix.normalize(relativePath);
  if (
    !normalizedRelativePath ||
    normalizedRelativePath === "." ||
    normalizedRelativePath === ".." ||
    normalizedRelativePath.startsWith("../") ||
    normalizedRelativePath.includes("/../")
  ) {
    return "";
  }

  return normalizedRelativePath;
}

function canServeStaticFile(distRoot, relativePath) {
  if (!distRoot || !relativePath) {
    return false;
  }

  const normalizedDistRoot = path.resolve(distRoot);
  const resolvedPath = path.resolve(normalizedDistRoot, relativePath);
  if (!(resolvedPath === normalizedDistRoot || resolvedPath.startsWith(`${normalizedDistRoot}${path.sep}`))) {
    return false;
  }

  return existsSync(resolvedPath);
}

// The index each build root last served, kept while its file is unchanged: by its change time too, which every write
// moves and no tool sets back, since an update's page may have the old one's size and the Nix store's 1970 date, and a
// filesystem may give it the deleted page's inode.
const spaDocuments = new Map();

async function readSpaDocument(distRoot) {
  const file = path.resolve(distRoot, SPA_INDEX_FILE);
  const stats = await stat(file, { bigint: true });
  const identity = `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  const cached = spaDocuments.get(file);
  if (cached?.identity === identity) {
    return cached.document;
  }
  const document = await readFile(file, "utf8");
  spaDocuments.set(file, { identity, document });
  return document;
}

/**
 * Lets the not-found handler send the build's files (reply.sendFile): a file's brotli or gzip copy beside it, which
 * the build writes for the files under assets/ (tooling/release/precompress-assets.mjs), to a browser that accepts
 * it, and `Vary: Accept-Encoding` on every file.
 * @param {import("fastify").FastifyInstance} app
 * @param {string} distRoot
 */
function registerWebBuildFiles(app, distRoot) {
  return app.register(fastifyStatic, {
    root: distRoot,
    index: false,
    serve: false,
    preCompressed: true
  });
}

/**
 * Sends one of the build's files, kept for good when it is under assets/, where every name carries its content's
 * hash, and fetched again on each use otherwise.
 * @param {import("fastify").FastifyReply} reply
 * @param {string} staticFilePath relative to the build's folder
 */
function sendBuildFile(reply, staticFilePath) {
  if (staticFilePath.startsWith(HASHED_BUILD_FILES)) {
    return reply.sendFile(staticFilePath, HASHED_BUILD_FILE_CACHE);
  }
  return reply.header("Cache-Control", UNHASHED_FILE_CACHE).sendFile(staticFilePath, UNHASHED_FILE_SEND);
}

/**
 * Answers every unmatched request: API paths, other methods and missing files
 * get a 404, and page routes get the single-page application's index.
 * @param {import("fastify").FastifyInstance} app
 * @param {object} build
 * @param {string} build.distRoot
 * @param {boolean} build.hasWebBuild
 */
function registerSpaNotFoundHandler(app, { distRoot, hasWebBuild }) {
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = toRequestPathname(request.url);
    const method = String(request.method || "GET")
      .trim()
      .toUpperCase();
    if (isApiPath(pathname) || (method !== "GET" && method !== "HEAD")) {
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (hasFileExtension(pathname)) {
      const staticFilePath = toStaticFilePath(pathname);
      if (hasWebBuild && staticFilePath && canServeStaticFile(distRoot, staticFilePath)) {
        return sendBuildFile(reply, staticFilePath);
      }
      return reply.code(404).send({
        message: `Route ${method}:${pathname} not found`,
        error: "Not Found",
        statusCode: 404
      });
    }
    if (!hasWebBuild) {
      return reply.code(404).send({
        error: "Frontend build is not available. Run `npm run build`."
      });
    }
    return reply
      .header("Cache-Control", "no-store")
      .type("text/html; charset=utf-8")
      .send(await readSpaDocument(distRoot));
  });
}

export {
  SPA_INDEX_FILE,
  buildGlobalUiPaths,
  registerSpaNotFoundHandler,
  registerWebBuildFiles
};
