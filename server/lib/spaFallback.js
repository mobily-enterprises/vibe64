import { existsSync, readFileSync } from "node:fs";
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

function readSpaDocument(distRoot) {
  return readFileSync(path.resolve(distRoot, SPA_INDEX_FILE), "utf8");
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
        return reply.sendFile(staticFilePath);
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
      .send(readSpaDocument(distRoot));
  });
}

export {
  SPA_INDEX_FILE,
  buildGlobalUiPaths,
  registerSpaNotFoundHandler
};
