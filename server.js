import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
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

const SPA_INDEX_FILE = "index.html";
const API_BASE_PATH = "/api";
const MODULE_APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
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

function registerCodexTerminalWebSocketRoute(app, runtimeApp) {
  app.get(
    "/api/studio/current-app/issue-sessions/:sessionId/codex-terminal/:terminalSessionId/ws",
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
        service = runtimeApp.make("feature.current-app.service");
      } catch (error) {
        closeWithError(1011, String(error?.message || error || "Current app service is unavailable."));
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
          const response = service.writeCodexTerminal(sessionId, terminalSessionId, message.data);
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

      void service.subscribeCodexTerminal(sessionId, terminalSessionId, (message) => {
        sendSocketJson(socket, message);
      }).then((result) => {
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

function registerSessionStepTerminalWebSocketRoute(app, runtimeApp) {
  app.get(
    "/api/studio/current-app/issue-sessions/:sessionId/step-terminal/:terminalSessionId/ws",
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
        service = runtimeApp.make("feature.current-app.service");
      } catch (error) {
        closeWithError(1011, String(error?.message || error || "Current app service is unavailable."));
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
          const response = service.writeSessionStepTerminal(sessionId, terminalSessionId, message.data);
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

      void service.subscribeSessionStepTerminal(sessionId, terminalSessionId, (message) => {
        sendSocketJson(socket, message);
      }).then((result) => {
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

function registerAppTestTerminalWebSocketRoute(app, runtimeApp) {
  function registerRoute(routePath, { sessionScoped = false } = {}) {
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
          service = runtimeApp.make("feature.current-app.service");
        } catch (error) {
          closeWithError(1011, String(error?.message || error || "Current app service is unavailable."));
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
            const response = sessionScoped
              ? service.writeIssueSessionAppTestTerminal(sessionId, terminalSessionId, message.data)
              : service.writeAppTestTerminal(terminalSessionId, message.data);
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

        const subscriptionPromise = sessionScoped
          ? service.subscribeIssueSessionAppTestTerminal(sessionId, terminalSessionId, (message) => {
              sendSocketJson(socket, message);
            })
          : service.subscribeAppTestTerminal(terminalSessionId, (message) => {
              sendSocketJson(socket, message);
            });

        void subscriptionPromise.then((result) => {
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

  registerRoute("/api/studio/current-app/app-test-terminal/:terminalSessionId/ws");
  registerRoute(
    "/api/studio/current-app/issue-sessions/:sessionId/app-test-terminal/:terminalSessionId/ws",
    { sessionScoped: true }
  );
}

function registerNpmScriptTerminalWebSocketRoute(app, runtimeApp) {
  app.get(
    "/api/studio/current-app/npm-script-terminal/:terminalSessionId/ws",
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
        service = runtimeApp.make("feature.current-app.service");
      } catch (error) {
        closeWithError(1011, String(error?.message || error || "Current app service is unavailable."));
        return;
      }
      const terminalSessionId = String(request.params?.terminalSessionId || "");

      socket.on("message", async (rawMessage) => {
        try {
          const message = JSON.parse(rawMessage.toString());
          if (message?.type !== "input") {
            return;
          }
          const response = service.writeNpmScriptTerminal(terminalSessionId, message.data);
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

      void service.subscribeNpmScriptTerminal(terminalSessionId, (message) => {
        sendSocketJson(socket, message);
      }).then((result) => {
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

async function createServer(options = {}) {
  const app = Fastify({
    logger: true,
    ajv: {
      customOptions: {
        allowUnionTypes: true
      }
    }
  });
  if (isTruthyEnvValue(process.env.JSKIT_STUDIO_SKIP_STALE_TERMINAL_CLEANUP)) {
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
      app: "jskit-ai-studio"
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
    JSKIT_STUDIO_APP_ROOT: appRoot,
    JSKIT_STUDIO_TARGET_ROOT: targetRoot
  };
  const previousStudioAppRoot = process.env.JSKIT_STUDIO_APP_ROOT;
  const previousStudioTargetRoot = process.env.JSKIT_STUDIO_TARGET_ROOT;
  process.env.JSKIT_STUDIO_APP_ROOT = appRoot;
  process.env.JSKIT_STUDIO_TARGET_ROOT = targetRoot;
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
      delete process.env.JSKIT_STUDIO_APP_ROOT;
    } else {
      process.env.JSKIT_STUDIO_APP_ROOT = previousStudioAppRoot;
    }
    if (previousStudioTargetRoot == null) {
      delete process.env.JSKIT_STUDIO_TARGET_ROOT;
    } else {
      process.env.JSKIT_STUDIO_TARGET_ROOT = previousStudioTargetRoot;
    }
  }

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: resolveGlobalUiPaths(runtime?.globalUiPaths || [])
  });

  if (runtime?.app) {
    registerCodexTerminalWebSocketRoute(app, runtime.app);
    registerSessionStepTerminalWebSocketRoute(app, runtime.app);
    registerAppTestTerminalWebSocketRoute(app, runtime.app);
    registerNpmScriptTerminalWebSocketRoute(app, runtime.app);
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
    app.log.info({ signal }, "Stopping jskit-ai-studio server.");
    try {
      await app.close();
      process.exitCode = 0;
    } catch (error) {
      app.log.error({ error }, "Failed to stop jskit-ai-studio server cleanly.");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
  app.addHook("onClose", async () => {
    process.off("SIGINT", closeAndExit);
    process.off("SIGTERM", closeAndExit);
  });
  await app.listen({ port, host });
  return app;
}

export { createServer, startServer };
