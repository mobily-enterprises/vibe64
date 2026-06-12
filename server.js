import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import getPort, { portNumbers } from "get-port";
import {
  resolveRuntimeEnv
} from "./server/lib/runtimeEnv.js";
import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, rm } from "node:fs/promises";
import os from "node:os";
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
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  resolveVibe64Roots
} from "@local/vibe64-core/server/studioRoots";
import {
  assertProjectDirectoryUsable,
  configureStudioProjectContext,
  normalizeProjectSlug,
  resolveStudioProjectsRoot
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
  createService as createVibe64AccountsService
} from "@local/vibe64-accounts/server/service";
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
  registerVibe64ProjectRoutes
} from "./server/lib/projectRoutes.js";
import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  assertSafeLocalModeListenTarget,
  createVibe64RuntimeProfile
} from "./server/lib/runtimeProfile.js";

const SPA_INDEX_FILE = "index.html";
const API_BASE_PATH = "/api";
const MODULE_APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT_SEARCH_LIMIT = 50;
const DEFAULT_SOCKET_FILE_NAME = "server.sock";
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8000;
const SOCKET_IO_PATH = "/socket.io";
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

function isSocketIoPath(pathname) {
  return normalizePathname(pathname) === SOCKET_IO_PATH;
}

function registerSocketIoUpgradeHandoff(app) {
  app.addHook("onRequest", async (request, reply) => {
    if (request?.ws !== true) {
      return;
    }
    if (!isSocketIoPath(toRequestPathname(request?.raw?.url || request?.url))) {
      return;
    }

    reply.hijack();
  });
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

function hasOwnOption(options = {}, name = "") {
  return Object.prototype.hasOwnProperty.call(options, name);
}

function explicitOptionValue(options = {}, name = "") {
  return hasOwnOption(options, name) ? options[name] : undefined;
}

function hasExplicitPortOption(options = {}) {
  if (!hasOwnOption(options, "port")) {
    return false;
  }
  return String(options.port ?? "").trim() !== "";
}

function defaultListenSocketPath({
  env = process.env
} = {}) {
  const runtimeDir = String(env.XDG_RUNTIME_DIR || "").trim();
  if (runtimeDir) {
    return path.join(runtimeDir, "vibe64", DEFAULT_SOCKET_FILE_NAME);
  }
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "user";
  return path.join(os.tmpdir(), `vibe64-${uid}`, DEFAULT_SOCKET_FILE_NAME);
}

function resolveListenTarget({
  options = {},
  runtimeEnv = resolveRuntimeEnv()
} = {}) {
  const portRequested = hasExplicitPortOption(options) || runtimeEnv.PORT_CONFIGURED === true;
  if (portRequested) {
    const port = Number(explicitOptionValue(options, "port") ?? runtimeEnv.PORT);
    return {
      host: String(explicitOptionValue(options, "host") || runtimeEnv.HOST).trim() || "127.0.0.1",
      port: Number.isFinite(port) ? port : 3000,
      transport: "tcp"
    };
  }

  const socketPath = String(
    explicitOptionValue(options, "listenSocket") ||
    defaultListenSocketPath()
  ).trim();
  return {
    socketPath: path.resolve(socketPath),
    transport: "socket"
  };
}

function resolveShutdownTimeoutMs(value = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  const timeoutMs = Math.floor(Number(value));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) {
    return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }
  return timeoutMs;
}

function forceCloseServerConnections(server = null) {
  try {
    server?.closeIdleConnections?.();
  } catch {
    // Shutdown is already failing; continue with the stronger close below.
  }
  try {
    server?.closeAllConnections?.();
  } catch {
    // The process exits immediately after this in the signal path.
  }
}

function createSignalShutdownHandler({
  app,
  clearTimeoutFn = clearTimeout,
  exitProcess = process.exit.bind(process),
  setTimeoutFn = setTimeout,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
} = {}) {
  if (!app || typeof app.close !== "function") {
    throw new Error("createSignalShutdownHandler requires a Fastify app.");
  }

  const timeoutMs = resolveShutdownTimeoutMs(shutdownTimeoutMs);
  let closing = false;
  let exited = false;

  function exitOnce(code) {
    if (exited) {
      return;
    }
    exited = true;
    exitProcess(code);
  }

  return async function closeAndExit(signal) {
    if (closing) {
      return;
    }
    closing = true;
    app.log?.info?.({ signal }, "Stopping vibe64 server.");

    const timeout = setTimeoutFn(() => {
      app.log?.error?.({
        signal,
        shutdownTimeoutMs: timeoutMs
      }, "Vibe64 server shutdown timed out; forcing process exit.");
      forceCloseServerConnections(app.server);
      exitOnce(1);
    }, timeoutMs);
    timeout?.unref?.();

    try {
      await app.close();
      clearTimeoutFn(timeout);
      app.log?.info?.({ signal }, "Stopped vibe64 server.");
      exitOnce(0);
    } catch (error) {
      clearTimeoutFn(timeout);
      app.log?.error?.({ error }, "Failed to stop vibe64 server cleanly.");
      exitOnce(1);
    }
  };
}

async function removeStaleSocket(socketPath = "") {
  try {
    const info = await lstat(socketPath);
    if (!info.isSocket()) {
      const error = new Error(`Refusing to remove non-socket listen path: ${socketPath}`);
      error.code = "vibe64_listen_path_not_socket";
      throw error;
    }
    await rm(socketPath, {
      force: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function prepareListenSocket(socketPath = "") {
  if (!socketPath) {
    const error = new Error("Vibe64 listen socket path is required.");
    error.code = "vibe64_listen_socket_required";
    throw error;
  }
  await mkdir(path.dirname(socketPath), {
    recursive: true
  });
  await removeStaleSocket(socketPath);
}

function startupBrowserPath({
  startupSlug = ""
} = {}) {
  const slug = String(startupSlug || "").trim();
  return slug ? `/app/${encodeURIComponent(normalizeProjectSlug(slug))}` : "/app/manage/projects";
}

function browserUrlForListenAddress(address = "", options = {}) {
  const url = new URL(address);
  if (["0.0.0.0", "[::]"].includes(url.hostname)) {
    url.hostname = "127.0.0.1";
  }
  return `${url.origin}${startupBrowserPath(options)}`;
}

function browserUrlForPublicOrigin(origin = "", options = {}) {
  const normalizedOrigin = String(origin || "").trim();
  if (!normalizedOrigin) {
    return "";
  }
  const url = new URL(normalizedOrigin);
  return `${url.origin}${startupBrowserPath(options)}`;
}

function createCodexConnectedVerifier({
  accountService = null,
  env = process.env,
  providerHomesRoot = "",
  systemRoot = ""
} = {}) {
  const service = accountService || createVibe64AccountsService({
    env,
    providerHomesRoot,
    systemRoot
  });
  return async function verifyCodexConnected() {
    const status = await service.getCodexStatus();
    if (status?.ok === false) {
      return {
        ok: false,
        code: status.code || "vibe64_codex_status_failed",
        error: status.error || "Codex status could not be verified."
      };
    }
    return {
      connected: status?.account?.connected === true,
      ok: true
    };
  };
}

async function createServer(options = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const runtimeProfile = createVibe64RuntimeProfile({
    mode: options.runtimeMode,
    targetRoot: options.targetRoot
  });
  if (runtimeProfile.local) {
    if (!runtimeProfile.singleTargetRoot) {
      const error = new Error("Local editor mode requires a target directory.");
      error.code = "vibe64_local_mode_target_required";
      throw error;
    }
    await assertProjectDirectoryUsable(runtimeProfile.singleTargetRoot);
  }
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
  registerSocketIoUpgradeHandoff(app);

  const projectsRoot = resolveStudioProjectsRoot({
    env: runtimeEnv,
    explicitRoot: options.projectsRoot
  });
  const rootContract = resolveVibe64Roots({
    env: runtimeEnv,
    explicitSystemRoot: options.systemRoot,
    projectsRoot,
    runtimeProfile,
    targetRoot: runtimeProfile.singleTargetRoot
  });
  const systemRoot = rootContract.systemRoot;

  const accountService = createVibe64AccountsService({
    env: runtimeEnv,
    providerHomesRoot: options.providerHomesRoot,
    systemRoot
  });
  const codexConnectedVerifier = typeof options.codexConnectedVerifier === "function"
    ? options.codexConnectedVerifier
    : createCodexConnectedVerifier({
        accountService,
        env: runtimeEnv,
        providerHomesRoot: options.providerHomesRoot,
        systemRoot
      });
  const auth = createVibe64Auth({
    codexConnectedVerifier,
    env: runtimeEnv,
    runtimeProfile,
    systemRoot,
    verifySupabaseAccessToken: options.verifySupabaseAccessToken
  });
  app.vibe64Auth = auth;
  registerVibe64AuthRoutes(app, auth);
  registerVibe64AuthGate(app, auth, {
    accountService,
    runtimeProfile
  });

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
  if (isLocalhostCheckBypassEnabled()) {
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
    explicitProjectsRoot: projectsRoot,
    explicitSystemRoot: systemRoot,
    explicitTargetRoot: options.targetRoot,
    runtimeProfile
  });
  registerVibe64ProjectRoutes(app, projectContext, {
    auth,
    env: runtimeEnv,
    providerHomesRoot: options.providerHomesRoot,
    systemRoot,
    runGithubToolchain: options.runGithubToolchain
  });
  const targetRoot = projectContext.targetRoot || "";
  const distRoot = path.resolve(appRoot, "dist");
  const hasWebBuild = existsSync(path.resolve(distRoot, SPA_INDEX_FILE));
  const providerEnv = {
    ...runtimeEnv,
    [VIBE64_APP_ROOT_ENV]: appRoot,
    [VIBE64_PROJECTS_ROOT_ENV]: projectContext.projectsRoot,
    [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
    ...(targetRoot ? { [VIBE64_TARGET_ROOT_ENV]: targetRoot } : {})
  };
  const previousStudioAppRoot = process.env[VIBE64_APP_ROOT_ENV];
  const previousVibe64SystemRoot = process.env[VIBE64_SYSTEM_ROOT_ENV];
  const previousStudioProjectsRoot = process.env[VIBE64_PROJECTS_ROOT_ENV];
  const previousStudioTargetRoot = process.env[VIBE64_TARGET_ROOT_ENV];
  process.env[VIBE64_APP_ROOT_ENV] = appRoot;
  process.env[VIBE64_PROJECTS_ROOT_ENV] = projectContext.projectsRoot;
  process.env[VIBE64_SYSTEM_ROOT_ENV] = systemRoot;
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
    if (previousVibe64SystemRoot == null) {
      delete process.env[VIBE64_SYSTEM_ROOT_ENV];
    } else {
      process.env[VIBE64_SYSTEM_ROOT_ENV] = previousVibe64SystemRoot;
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
        systemRoot,
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
  const listenTarget = resolveListenTarget({
    options,
    runtimeEnv
  });
  const runtimeProfile = createVibe64RuntimeProfile({
    mode: options?.runtimeMode,
    targetRoot: options?.targetRoot
  });
  assertSafeLocalModeListenTarget(runtimeProfile, listenTarget, {
    env: runtimeEnv
  });
  const strictPort = options?.strictPort ?? (
    listenTarget.transport === "tcp" &&
    (hasExplicitPortOption(options) || runtimeEnv.PORT_CONFIGURED === true)
  );
  const app = await createServer({
    appRoot: options?.appRoot,
    browserLifecycleShutdownDelayMs: options?.browserLifecycleShutdownDelayMs,
    projectsRoot: options?.projectsRoot,
    runtimeMode: runtimeProfile.mode,
    systemRoot: options?.systemRoot,
    targetRoot: options?.targetRoot,
    verifySupabaseAccessToken: options?.verifySupabaseAccessToken
  });
  const closeAndExit = createSignalShutdownHandler({
    app,
    shutdownTimeoutMs: options?.shutdownTimeoutMs
  });
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
  app.addHook("onClose", async () => {
    process.off("SIGINT", closeAndExit);
    process.off("SIGTERM", closeAndExit);
  });
  if (options?.browserLifecycleShutdown === true) {
    app.browserLifecycleMonitor?.enableShutdown(closeAndExit);
  }
  let listenAddress = "";
  if (listenTarget.transport === "socket") {
    await prepareListenSocket(listenTarget.socketPath);
    listenAddress = await app.listen({
      path: listenTarget.socketPath
    });
    app.vibe64Listen = {
      address: listenAddress,
      socketPath: listenTarget.socketPath,
      transport: "socket"
    };
  } else {
    const selectedPort = strictPort ? listenTarget.port : await getPort({
      port: preferredPortRange(listenTarget.port)
    });
    listenAddress = await app.listen({
      host: listenTarget.host,
      port: selectedPort
    });
    app.vibe64Listen = {
      address: listenAddress,
      host: listenTarget.host,
      port: selectedPort,
      transport: "tcp"
    };
  }
  const publicOrigin = String(options?.publicOrigin || "").trim();
  app.vibe64Url = publicOrigin
    ? browserUrlForPublicOrigin(publicOrigin, {
      startupSlug: options?.startupSlug
    })
    : listenTarget.transport === "tcp"
      ? browserUrlForListenAddress(listenAddress, {
        startupSlug: options?.startupSlug
      })
      : "";
  return app;
}

export {
  browserUrlForListenAddress,
  browserUrlForPublicOrigin,
  createServer,
  createSignalShutdownHandler,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  defaultListenSocketPath,
  forceCloseServerConnections,
  resolveListenTarget,
  startServer,
  startupBrowserPath
};
