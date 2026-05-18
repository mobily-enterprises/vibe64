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
  resolveStudioTargetRoot
} from "./server/lib/studioRoots.js";
import {
  closeTerminalSessionsForNamespacePrefix
} from "./server/lib/terminalSessions.js";
import {
  isLocalStudioRequest
} from "./server/lib/localStudioRequest.js";
import {
  isLocalhostCheckBypassEnabled
} from "./server/lib/localhostCheckBypass.js";
import {
  cleanupStaleStudioTerminals
} from "./server/lib/studioTerminalCleanup.js";
import {
  AI_STUDIO_APP_ROOT_ENV,
  AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  AI_STUDIO_TARGET_ROOT_ENV
} from "./server/lib/studioRuntimeIdentity.js";

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

function sendSocketJson(socket, payload) {
  if (socket.readyState !== 1) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function publicTerminalSnapshot(session = {}) {
  const {
    unsubscribe,
    ...publicSession
  } = session || {};
  void unsubscribe;
  return publicSession;
}

function preferredPortRange(port) {
  const requestedPort = Number(port) || 0;
  if (requestedPort < 1024 || requestedPort >= 65535) {
    return requestedPort;
  }
  return portNumbers(requestedPort, Math.min(65535, requestedPort + DEFAULT_PORT_SEARCH_LIMIT - 1));
}

function browserUrlForListenAddress(address = "") {
  const url = new URL(address);
  if (["0.0.0.0", "[::]"].includes(url.hostname)) {
    url.hostname = "127.0.0.1";
  }
  return `${url.origin}/`;
}

function registerTerminalWebSocketRoute(
  app,
  runtimeApp,
  {
    routePath,
    serviceId,
    serviceUnavailableMessage,
    subscribe,
    write
  } = {}
) {
  app.get(
    routePath,
    { websocket: true },
    (socket, request) => {
      let subscription = null;
      let closed = false;

      const closeSubscription = () => {
        if (closed) {
          return;
        }
        closed = true;
        subscription?.unsubscribe?.();
        subscription = null;
      };

      const closeWithError = (code, error) => {
        sendSocketJson(socket, {
          error,
          type: "error"
        });
        socket.close(code, error);
      };

      if (!isLocalStudioRequest(request)) {
        closeWithError(1008, "Open Studio on localhost or 127.0.0.1.");
        return;
      }

      let service;
      try {
        service = runtimeApp.make(serviceId);
      } catch (error) {
        closeWithError(1011, String(error?.message || error || serviceUnavailableMessage));
        return;
      }
      const sessionId = String(request.params?.sessionId || "");
      const terminalSessionId = String(request.params?.terminalSessionId || "");

      socket.on("message", async (rawMessage) => {
        try {
          const message = JSON.parse(rawMessage.toString());
          if (message?.type !== "input") {
            return;
          }
          const response = await write(service, {
            data: message.data,
            sessionId,
            terminalSessionId
          });
          if (response?.ok === false) {
            sendSocketJson(socket, {
              error: response.error || "Terminal input failed.",
              type: "error"
            });
          }
        } catch (error) {
          sendSocketJson(socket, {
            error: String(error?.message || error || "Terminal input failed."),
            type: "error"
          });
        }
      });

      socket.on("close", closeSubscription);
      socket.on("error", closeSubscription);

      void Promise.resolve(subscribe(service, {
        sessionId,
        subscriber: (message) => {
          sendSocketJson(socket, message);
        },
        terminalSessionId
      })).then((result) => {
        if (result?.ok === false) {
          closeWithError(1008, result.error || "Terminal session not found.");
          return;
        }
        subscription = result;
        sendSocketJson(socket, {
          session: publicTerminalSnapshot(result),
          type: "snapshot"
        });
      }).catch((error) => {
        closeWithError(1011, String(error?.message || error || "Terminal stream failed."));
      });
    }
  );
}

function registerAiStudioCodexTerminalWebSocketRoute(app, runtimeApp) {
  registerTerminalWebSocketRoute(app, runtimeApp, {
    routePath: "/api/ai-studio/sessions/:sessionId/codex-terminal/:terminalSessionId/ws",
    serviceId: "feature.ai-studio-terminals.service",
    serviceUnavailableMessage: "AI Studio terminal service is unavailable.",
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeCodexTerminal(sessionId, terminalSessionId, subscriber);
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeCodexTerminal(sessionId, terminalSessionId, data);
    }
  });
}

function registerAiStudioCommandTerminalWebSocketRoute(app, runtimeApp) {
  registerTerminalWebSocketRoute(app, runtimeApp, {
    routePath: "/api/ai-studio/sessions/:sessionId/command-terminal/:terminalSessionId/ws",
    serviceId: "feature.ai-studio-terminals.service",
    serviceUnavailableMessage: "AI Studio terminal service is unavailable.",
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeCommandTerminal(sessionId, terminalSessionId, subscriber);
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeCommandTerminal(sessionId, terminalSessionId, data);
    }
  });
}

function registerAiStudioLaunchTargetTerminalWebSocketRoute(app, runtimeApp) {
  registerTerminalWebSocketRoute(app, runtimeApp, {
    routePath: "/api/ai-studio/sessions/:sessionId/launch-terminal/:terminalSessionId/ws",
    serviceId: "feature.ai-studio-terminals.service",
    serviceUnavailableMessage: "AI Studio terminal service is unavailable.",
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeLaunchTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeLaunchTargetTerminal(sessionId, terminalSessionId, data);
    }
  });
}

function registerTargetScriptTerminalWebSocketRoute(app, runtimeApp) {
  registerTerminalWebSocketRoute(app, runtimeApp, {
    routePath: "/api/studio/current-app/target-script-terminal/:terminalSessionId/ws",
    serviceId: "feature.current-app.service",
    serviceUnavailableMessage: "Current app service is unavailable.",
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeTargetScriptTerminal(terminalSessionId, subscriber);
    },
    write(service, { data, terminalSessionId }) {
      return service.writeTargetScriptTerminal(terminalSessionId, data);
    }
  });
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
  if (isTruthyEnvValue(process.env[AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV])) {
    app.log.warn("Skipping stale Studio terminal cleanup for this process.");
  } else {
    await cleanupStaleStudioTerminals({
      logger: app.log
    });
  }
  await app.register(fastifyWebsocket);

  app.addHook("onClose", async () => {
    await closeTerminalSessionsForNamespacePrefix("");
  });

  app.get("/api/health", async () => {
    return {
      ok: true,
      app: "ai-studio"
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
  const targetRoot = resolveStudioTargetRoot({
    env: runtimeEnv,
    explicitRoot: options.targetRoot,
    cwd: process.cwd(),
    studioAppRoot: appRoot
  });
  const distRoot = path.resolve(appRoot, "dist");
  const hasWebBuild = existsSync(path.resolve(distRoot, SPA_INDEX_FILE));
  const spaDocument = hasWebBuild ? readFileSync(path.resolve(distRoot, SPA_INDEX_FILE), "utf8") : "";
  const providerEnv = {
    ...runtimeEnv,
    [AI_STUDIO_APP_ROOT_ENV]: appRoot,
    [AI_STUDIO_TARGET_ROOT_ENV]: targetRoot
  };
  const previousStudioAppRoot = process.env[AI_STUDIO_APP_ROOT_ENV];
  const previousStudioTargetRoot = process.env[AI_STUDIO_TARGET_ROOT_ENV];
  process.env[AI_STUDIO_APP_ROOT_ENV] = appRoot;
  process.env[AI_STUDIO_TARGET_ROOT_ENV] = targetRoot;
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
      delete process.env[AI_STUDIO_APP_ROOT_ENV];
    } else {
      process.env[AI_STUDIO_APP_ROOT_ENV] = previousStudioAppRoot;
    }
    if (previousStudioTargetRoot == null) {
      delete process.env[AI_STUDIO_TARGET_ROOT_ENV];
    } else {
      process.env[AI_STUDIO_TARGET_ROOT_ENV] = previousStudioTargetRoot;
    }
  }

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: resolveGlobalUiPaths(runtime?.globalUiPaths || [])
  });

  if (runtime?.app) {
    registerAiStudioCodexTerminalWebSocketRoute(app, runtime.app);
    registerAiStudioCommandTerminalWebSocketRoute(app, runtime.app);
    registerAiStudioLaunchTargetTerminalWebSocketRoute(app, runtime.app);
    registerTargetScriptTerminalWebSocketRoute(app, runtime.app);
  }

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
    return reply.type("text/html; charset=utf-8").send(spaDocument);
  });

  if (runtime) {
    app.log.info(
      {
        routeCount: runtime.routeCount,
        surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
        targetRoot,
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
    targetRoot: options?.targetRoot
  });
  let closing = false;
  const closeAndExit = async (signal) => {
    if (closing) {
      return;
    }
    closing = true;
    app.log.info({ signal }, "Stopping ai-studio server.");
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ error }, "Failed to stop ai-studio server cleanly.");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
  app.addHook("onClose", async () => {
    process.off("SIGINT", closeAndExit);
    process.off("SIGTERM", closeAndExit);
  });
  const selectedPort = strictPort ? port : await getPort({
    port: preferredPortRange(port)
  });
  const listenAddress = await app.listen({
    host,
    port: selectedPort
  });
  app.aiStudioUrl = browserUrlForListenAddress(listenAddress);
  return app;
}

export { createServer, startServer };
