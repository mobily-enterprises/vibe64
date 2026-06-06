import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import getPort, { portNumbers } from "get-port";
import { resolveRuntimeEnv } from "./server/lib/runtimeEnv.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface,
  tryCreateProviderRuntimeFromApp
} from "@jskit-ai/kernel/server/platform";
import { matchesPathPrefix, normalizePathname } from "@jskit-ai/kernel/shared/surface/paths";
import { surfaceRuntime } from "./server/lib/surfaceRuntime.js";
import {
  resolveStudioAppRoot,
  VIBE64_PROJECTS_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  configureStudioProjectContext,
  normalizeWorkspaceSlug
} from "@local/vibe64-core/server/studioProjectContext";
import {
  closeTerminalSessionsForNamespacePrefix
} from "@local/studio-terminal-core/server/terminalSessions";
import {
  isLocalhostCheckBypassEnabled
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  cleanupStaleStudioTerminals
} from "@local/studio-terminal-core/server/studioTerminalCleanup";
import {
  createBrowserLifecycleMonitor,
  registerBrowserLifecycleWebSocketRoute
} from "./server/lib/browserLifecycle.js";
import {
  createVibe64Auth,
  registerVibe64AuthGate,
  registerVibe64AuthRoutes
} from "./server/lib/auth/index.js";
import {
  registerVibe64WorkspaceRoutes
} from "./server/lib/workspaceRoutes.js";
import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const SPA_INDEX_FILE = "index.html";
const API_BASE_PATH = "/api";
const MODULE_APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT_SEARCH_LIMIT = 50;
const STATIC_GLOBAL_UI_PATHS = Object.freeze([
  "/assets",
  "/favicon.svg",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest"
]);

function isTruthyEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

function toRequestPathname(urlValue) {
  const rawUrl = String(urlValue || "").trim() || "/";
  try {
    return normalizePathname(new URL(rawUrl, "http://localhost").pathname || "/");
  } catch {
    return normalizePathname(rawUrl.split("?")[0] || "/");
  }
}

function isApiPath(pathname) {
  return matchesPathPrefix(pathname, API_BASE_PATH);
}

function hasFileExtension(pathname) {
  return path.extname(normalizePathname(pathname)) !== "";
}

function resolveGlobalUiPaths(runtimeGlobalUiPaths = []) {
  const paths = new Set(Array.isArray(runtimeGlobalUiPaths) ? runtimeGlobalUiPaths : []);
  for (const staticPath of STATIC_GLOBAL_UI_PATHS) {
    paths.add(staticPath);
  }
  return [...paths];
}

function resolveStaticFilePath(pathname) {
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

function preferredPortRange(port) {
  const requestedPort = Number(port) || 0;
  if (requestedPort < 1024 || requestedPort >= 65535) {
    return requestedPort;
  }
  return portNumbers(requestedPort, Math.min(65535, requestedPort + DEFAULT_PORT_SEARCH_LIMIT - 1));
}

function startupBrowserPath({
  startupSlug = ""
} = {}) {
  const slug = String(startupSlug || "").trim();
  return slug ? `/app/${encodeURIComponent(normalizeWorkspaceSlug(slug))}` : "/app/manage";
}

function browserUrlForListenAddress(address = "", options = {}) {
  const url = new URL(address);
  if (["0.0.0.0", "[::]"].includes(url.hostname)) {
    url.hostname = "127.0.0.1";
  }
  return `${url.origin}${startupBrowserPath(options)}`;
}

async function createServer(options = {}) {
  const app = Fastify({
    logger: true,
    ajv: {
      customOptions: {
        allowUnionTypes: true
      }
    }
  });
  if (isTruthyEnvValue(process.env[VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV])) {
    app.log.warn("Skipping stale Studio terminal cleanup for this process.");
  } else {
    await cleanupStaleStudioTerminals({
      logger: app.log
    });
  }
  await app.register(fastifyWebsocket);

  const auth = createVibe64Auth({
    dataRoot: options.authDataRoot,
    env: process.env,
    verifySupabaseAccessToken: options.verifySupabaseAccessToken
  });
  app.vibe64Auth = auth;
  registerVibe64AuthRoutes(app, auth);
  registerVibe64AuthGate(app, auth);

  const browserLifecycleMonitor = createBrowserLifecycleMonitor({
    logger: app.log,
    shutdownDelayMs: options.browserLifecycleShutdownDelayMs
  });
  app.browserLifecycleMonitor = browserLifecycleMonitor;

  app.addHook("onClose", async () => {
    browserLifecycleMonitor.stop();
    await closeTerminalSessionsForNamespacePrefix("");
  });

  registerBrowserLifecycleWebSocketRoute(app, browserLifecycleMonitor);

  app.get("/api/health", async () => {
    return {
      ok: true,
      app: "vibe64"
    };
  });
  const runtimeEnv = resolveRuntimeEnv();
  if (isLocalhostCheckBypassEnabled({ env: runtimeEnv })) {
    app.log.warn("Studio localhost request checks are bypassed for this process.");
  }
  const appRoot = resolveStudioAppRoot({
    env: runtimeEnv,
    explicitRoot: options.appRoot,
    fallbackRoot: MODULE_APP_ROOT
  });
  const projectContext = configureStudioProjectContext({
    cwd: process.cwd(),
    env: runtimeEnv,
    explicitProjectsRoot: options.projectsRoot,
    explicitTargetRoot: options.targetRoot
  });
  registerVibe64WorkspaceRoutes(app, projectContext);
  const targetRoot = projectContext.targetRoot || "";
  const distRoot = path.resolve(appRoot, "dist");
  const hasWebBuild = existsSync(path.resolve(distRoot, SPA_INDEX_FILE));
  const providerEnv = {
    ...runtimeEnv,
    [VIBE64_APP_ROOT_ENV]: appRoot,
    [VIBE64_PROJECTS_ROOT_ENV]: projectContext.projectsRoot,
    ...(targetRoot ? { [VIBE64_TARGET_ROOT_ENV]: targetRoot } : {})
  };
  const previousStudioAppRoot = process.env[VIBE64_APP_ROOT_ENV];
  const previousStudioProjectsRoot = process.env[VIBE64_PROJECTS_ROOT_ENV];
  const previousStudioTargetRoot = process.env[VIBE64_TARGET_ROOT_ENV];
  process.env[VIBE64_APP_ROOT_ENV] = appRoot;
  process.env[VIBE64_PROJECTS_ROOT_ENV] = projectContext.projectsRoot;
  if (targetRoot) {
    process.env[VIBE64_TARGET_ROOT_ENV] = targetRoot;
  } else {
    delete process.env[VIBE64_TARGET_ROOT_ENV];
  }
  let runtime;
  try {
    runtime = await tryCreateProviderRuntimeFromApp({
      appRoot,
      profile: resolveRuntimeProfileFromSurface({
        surfaceRuntime,
        serverSurface: runtimeEnv.SERVER_SURFACE
      }),
      env: providerEnv,
      logger: app.log,
      fastify: app
    });
  } finally {
    if (previousStudioAppRoot == null) {
      delete process.env[VIBE64_APP_ROOT_ENV];
    } else {
      process.env[VIBE64_APP_ROOT_ENV] = previousStudioAppRoot;
    }
    if (previousStudioProjectsRoot == null) {
      delete process.env[VIBE64_PROJECTS_ROOT_ENV];
    } else {
      process.env[VIBE64_PROJECTS_ROOT_ENV] = previousStudioProjectsRoot;
    }
    if (previousStudioTargetRoot == null) {
      delete process.env[VIBE64_TARGET_ROOT_ENV];
    } else {
      process.env[VIBE64_TARGET_ROOT_ENV] = previousStudioTargetRoot;
    }
  }

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: resolveGlobalUiPaths(runtime?.globalUiPaths || [])
  });

  if (hasWebBuild) {
    await app.register(fastifyStatic, {
      root: distRoot,
      index: false,
      serve: false
    });
  } else {
    app.log.warn("Frontend build not found (dist/index.html). Page routes will return 404 until `npm run build`.");
  }

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = toRequestPathname(request?.url);
    const method = String(request?.method || "GET")
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
      const staticFilePath = resolveStaticFilePath(pathname);
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

  if (runtime) {
    app.log.info(
      {
        routeCount: runtime.routeCount,
        surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
        projectsRoot: projectContext.projectsRoot,
        targetRoot: projectContext.targetRoot || "",
        providerPackages: runtime.providerPackageOrder,
        packageOrder: runtime.packageOrder
      },
      "Registered JSKIT provider server runtime."
    );
  }

  return app;
}

async function startServer(options = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const port = Number(options?.port) || runtimeEnv.PORT;
  const host = String(options?.host || "").trim() || runtimeEnv.HOST;
  const strictPort = options?.strictPort ?? Boolean(options?.port || String(process.env.PORT || "").trim());
  const app = await createServer({
    appRoot: options?.appRoot,
    authDataRoot: options?.authDataRoot,
    browserLifecycleShutdownDelayMs: options?.browserLifecycleShutdownDelayMs,
    projectsRoot: options?.projectsRoot,
    targetRoot: options?.targetRoot,
    verifySupabaseAccessToken: options?.verifySupabaseAccessToken
  });
  let closing = false;
  const closeAndExit = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    app.log.info({ signal }, "Stopping vibe64 server.");
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ error }, "Failed to stop vibe64 server cleanly.");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
  app.addHook("onClose", async () => {
    process.off("SIGINT", closeAndExit);
    process.off("SIGTERM", closeAndExit);
  });
  if (options?.browserLifecycleShutdown === true) {
    app.browserLifecycleMonitor?.enableShutdown(closeAndExit);
  }
  const selectedPort = strictPort ? port : await getPort({
    port: preferredPortRange(port)
  });
  const listenAddress = await app.listen({
    host,
    port: selectedPort
  });
  app.vibe64Url = browserUrlForListenAddress(listenAddress, {
    startupSlug: options?.startupSlug
  });
  return app;
}

export { browserUrlForListenAddress, createServer, startServer, startupBrowserPath };
