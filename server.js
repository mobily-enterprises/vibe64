import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import getPort from "get-port";
import {
  resolveRuntimeEnv
} from "./server/lib/runtimeEnv.js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInstalledRuntime,
  registerSurfaceRequestConstraint,
  resolveRuntimeProfileFromSurface
} from "@jskit-ai/kernel/server/platform";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";
import { resolveTrustedProxies } from "@jskit-ai/kernel/server/http";
import { surfaceRuntime } from "./server/lib/surfaceRuntime.js";
import {
  resolveStudioAppRoot,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  resolveVibe64Roots
} from "@local/vibe64-core/server/studioRoots";
import {
  assertProjectDirectoryUsable,
  configureStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  closeTerminalSessionsForNamespacePrefix
} from "@local/vibe64-execution/server/terminalSessions";
import { beginServerStop, resetServerStop } from "@local/vibe64-execution/server/serverStop";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  normalizeGithubAccountMode
} from "@local/vibe64-execution/server";
import {
  assertLocalhostCheckBypassAllowed,
  isLocalhostCheckBypassEnabled
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  createVibe64FastifyLoggerOptions,
  logOperationalEvent
} from "@local/vibe64-core/server/logging";
import { registerEditorFraming } from "@local/vibe64-core/server/editorFraming";
import {
  createBrowserLifecycleMonitor,
  registerBrowserLifecycleWebSocketRoute
} from "./server/lib/browserLifecycle.js";
import { handleUpgradeSocketErrors } from "./server/lib/upgradeSocketErrors.js";
import { STOP_DRAIN_MS, endRunningCommands, registerStopGate, stopAcceptingConnections } from "./server/lib/stopGate.js";
import {
  VIBE64_APP_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  configureCodexAttachmentHostRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { configureVibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { readVibe64WorkingTurns } from "@local/vibe64-runtime/server/workingTurns";
import { recordUntracedStops, startCrashWatch } from "@local/vibe64-core/server/crashWatch";
import {
  BASELINE_LEDGER_EXISTS,
  BASELINE_STATE_WITHOUT_LEDGER,
  recordStateUpgradeBaseline
} from "@local/vibe64-core/server/stateUpgrades";
import {
  assertSafeLocalModeListenTarget,
  createVibe64RuntimeProfile
} from "./server/lib/runtimeProfile.js";
import {
  defaultListenSocketPath,
  hasExplicitPortOption,
  preferredPortRange,
  prepareListenSocket,
  publishListenSocket,
  resolveListenTarget
} from "./server/lib/listenTarget.js";
import {
  SPA_INDEX_FILE,
  registerSpaNotFoundHandler,
  registerWebBuildFiles,
  buildGlobalUiPaths
} from "./server/lib/spaFallback.js";
import {
  browserUrlForListenAddress,
  browserUrlForPublicOrigin,
  startupBrowserPath,
  startupRedirectPathForRequest
} from "./server/lib/startupUrls.js";
import {
  localAccessTokenForStart,
  requireLocalAccessToken,
  urlWithLocalAccessToken
} from "./server/lib/localAccess.js";

/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/shared/capabilities").createCapabilityRuntime>} CapabilityRuntime */

const MODULE_APP_ROOT = path.dirname(fileURLToPath(import.meta.url));
// A stop's budget. On release 10's move of a hosted workspace (24 Nov 2026) the old editor took 3.33 s to stop,
// starting helper calls after SIGTERM, while the edge in front of it answered 502 and 503; the page now rides out the
// restart, and the editor is gone in under a second. Requests in flight, and the commands that were running when the
// stop began, get STOP_DRAIN_MS; then those connections close and those commands end. The stop's own work (each
// provider's shutdown) has until DEFAULT_SHUTDOWN_TIMEOUT_MS, when whatever still runs is ended and the process exits.
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 850;

function resolveShutdownTimeoutMs(value = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
  const timeoutMs = Math.floor(Number(value));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100) {
    return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  }
  return timeoutMs;
}

/** @param {import("node:http").Server} server */
function forceCloseServerConnections(server) {
  try {
    server.closeIdleConnections();
  } catch {
    // Shutdown is already failing; continue with the stronger close below.
  }
  try {
    server.closeAllConnections();
  } catch {
    // The process exits immediately after this in the signal path.
  }
}

/**
 * The SIGINT and SIGTERM handler. The stop begins before anything else (`beginStop`): nothing new starts from then
 * on, the next server will read this stop as planned, and every AI engine closes its fence. The listener stops taking
 * connections, and the runtime terminals and the capability runtime stop together, then Fastify closes. Requests in
 * flight, and the commands that were running when the stop began, have `drainMs`: then those connections close and
 * those commands end, which ends the work still waiting on them. Every command this process started that still runs
 * is ended before it exits, and it exits within the shutdown deadline. The stop is logged at warn, which a hosted
 * editor's default level keeps, with how long it took and each provider's shutdown.
 * @param {object} dependencies
 * @param {import("fastify").FastifyInstance} dependencies.app
 * @param {CapabilityRuntime} dependencies.capabilityRuntime
 * @param {(signal: string) => unknown} dependencies.beforeClose Runs with the runtime terminals and the capability runtime.
 * @param {(signal: string, options: { logger: unknown }) => unknown} [dependencies.beginStop]
 * @param {typeof clearTimeout} [dependencies.clearTimeoutFn]
 * @param {() => unknown} [dependencies.closeRuntimeTerminals]
 * @param {number} [dependencies.drainMs]
 * @param {(startedBefore: number) => Promise<{ ended?: number }>} [dependencies.endCommands] Ends the commands still
 *   running that started before the given time.
 * @param {(code: number) => void} [dependencies.exitProcess]
 * @param {() => number} [dependencies.now]
 * @param {(error: Error) => unknown} [dependencies.onStopFailed] Records a stop that failed or overran, before the exit.
 * @param {typeof setTimeout} [dependencies.setTimeoutFn]
 * @param {number} [dependencies.shutdownTimeoutMs]
 */
function createSignalShutdownHandler({
  app,
  capabilityRuntime,
  beforeClose,
  beginStop = beginServerStop,
  clearTimeoutFn = clearTimeout,
  closeRuntimeTerminals = () => closeTerminalSessionsForNamespacePrefix(""),
  drainMs = STOP_DRAIN_MS,
  endCommands = endRunningCommands,
  exitProcess = process.exit.bind(process),
  now = Date.now,
  onStopFailed = () => {},
  setTimeoutFn = setTimeout,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
}) {
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
    const startedAt = now();
    beginStop(signal, { logger: app.log });
    stopAcceptingConnections(app.server);
    logOperationalEvent(app.log, "warn", {
      component: "server-lifecycle",
      event: "vibe64.server.stopping",
      signal
    }, "Stopping vibe64 server.");

    // Every stop event says how long it took, which operations were still
    // running, how long each capability provider's shutdown took and how many
    // running commands the stop ended.
    const pendingOperations = new Set();
    let commandsEnded = 0;
    function progressFields() {
      return {
        commandsEnded,
        durationMs: now() - startedAt,
        providerShutdowns: capabilityRuntime.diagnostics().providerShutdowns
      };
    }
    function startOperation({ name, run }) {
      pendingOperations.add(name);
      return Promise.resolve().then(run).finally(() => pendingOperations.delete(name));
    }
    // Each command's SIGTERM goes out before this returns, so an exit straight after still sends it.
    function endCommandsStartedBefore(time) {
      let ending;
      try {
        ending = Promise.resolve(endCommands(time));
      } catch {
        return Promise.resolve();
      }
      return ending.then((result) => {
        commandsEnded += Number(result?.ended) || 0;
      }, () => {});
    }

    const drain = setTimeoutFn(() => {
      forceCloseServerConnections(app.server);
      void endCommandsStartedBefore(startedAt);
    }, Math.min(drainMs, timeoutMs));
    drain.unref?.();
    const timeout = setTimeoutFn(() => {
      logOperationalEvent(app.log, "error", {
        component: "server-lifecycle",
        event: "vibe64.server.shutdown_timeout",
        signal,
        shutdownTimeoutMs: timeoutMs,
        pendingOperations: [...pendingOperations],
        ...progressFields()
      }, "Vibe64 server shutdown timed out; forcing process exit.");
      onStopFailed(Object.assign(
        new Error(`Vibe64 did not stop within ${timeoutMs} ms; still running: ${[...pendingOperations].join(", ") || "nothing named"}.`),
        { code: "vibe64_shutdown_timeout" }
      ));
      forceCloseServerConnections(app.server);
      // Each command still running gets its SIGTERM before the exit, which does not wait for it.
      void endCommandsStartedBefore(Infinity);
      exitOnce(1);
    }, timeoutMs);
    timeout.unref?.();

    try {
      const preCloseOperations = [
        { name: "before-close", run: () => beforeClose(signal) },
        { name: "runtime-terminals", run: () => closeRuntimeTerminals() },
        { name: "capability-runtime", run: () => capabilityRuntime.shutdown() }
      ];
      const preClosePromises = preCloseOperations.map(startOperation);
      const capabilityRuntimeIndex = preCloseOperations.findIndex(({ name }) => (
        name === "capability-runtime"
      ));
      await preClosePromises[capabilityRuntimeIndex].catch(() => null);
      const operations = [
        ...preCloseOperations,
        { name: "fastify", run: () => app.close() }
      ];
      const results = await Promise.allSettled([
        ...preClosePromises,
        startOperation(operations.at(-1))
      ]);
      const failures = results.flatMap((result, index) => {
        if (result.status === "fulfilled") {
          return [];
        }
        const cause = result.reason instanceof Error
          ? result.reason
          : new Error(String(result.reason || "Shutdown operation failed."));
        const error = new Error(
          `Shutdown operation "${operations[index].name}" failed: ${cause.message}`,
          { cause }
        );
        error.operation = operations[index].name;
        return [error];
      });
      clearTimeoutFn(drain);
      // Nothing this process started outlives it.
      await endCommandsStartedBefore(Infinity);
      if (failures.length > 0) {
        throw new AggregateError(failures, `${failures.length} shutdown operation(s) failed.`);
      }
      clearTimeoutFn(timeout);
      logOperationalEvent(app.log, "warn", {
        component: "server-lifecycle",
        event: "vibe64.server.stopped",
        signal,
        ...progressFields()
      }, "Stopped vibe64 server.");
      exitOnce(0);
    } catch (error) {
      clearTimeoutFn(drain);
      clearTimeoutFn(timeout);
      logOperationalEvent(app.log, "error", {
        component: "server-lifecycle",
        error,
        event: "vibe64.server.stop_failed",
        failedOperations: (error?.errors || []).map(({ operation }) => operation).filter(Boolean),
        ...progressFields()
      }, "Failed to stop vibe64 server cleanly.");
      onStopFailed(error);
      exitOnce(1);
    }
  };
}

/**
 * Sets these process env values (undefined deletes) while fn runs, then
 * restores what was there before.
 */
async function withProcessEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const assign = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  assign(values);
  try {
    return await fn();
  } finally {
    assign(previous);
  }
}

/** What a crash record names as running: the app's package name and version, such as vibe64@0.1.81. */
function serverVersion(appRoot) {
  try {
    const { name, version } = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8"));
    return `${name || "vibe64"}@${version || "unknown"}`;
  } catch {
    return "vibe64@unknown";
  }
}

function resolveServerRuntimeProfile(serverOptions = {}, options = {}) {
  const {
    defaultLocalTargetRoot = process.cwd()
  } = options;
  if (serverOptions.runtimeProfile && typeof serverOptions.runtimeProfile === "object") {
    return Object.freeze({
      ...serverOptions.runtimeProfile
    });
  }
  const explicitTargetRoot = String(serverOptions.targetRoot || "").trim();
  return createVibe64RuntimeProfile({
    mode: serverOptions.runtimeMode,
    targetRoot: explicitTargetRoot || String(defaultLocalTargetRoot || "").trim()
  });
}

function targetRootForRuntimeProfile(options = {}, runtimeProfile = {}) {
  const explicitTargetRoot = String(options.targetRoot || "").trim();
  if (explicitTargetRoot) {
    return explicitTargetRoot;
  }
  return runtimeProfile.local === true ? process.cwd() : "";
}

async function createServer(options = {}) {
  // This process's server starts unstopped, even after an earlier one in the same process stopped.
  resetServerStop();
  const runtimeEnv = resolveRuntimeEnv();
  const loggerOptions = createVibe64FastifyLoggerOptions({
    env: runtimeEnv,
    level: options.logLevel
  });
  const runtimeProfile = resolveServerRuntimeProfile(options);
  const requestedTargetRoot = targetRootForRuntimeProfile(options, runtimeProfile);
  const localhostCheckBypassed = isLocalhostCheckBypassEnabled({ env: runtimeEnv });
  if (localhostCheckBypassed) {
    assertLocalhostCheckBypassAllowed({ local: runtimeProfile.local === true });
  }
  if (runtimeProfile.local) {
    if (!runtimeProfile.singleTargetRoot) {
      const error = new Error("Local editor mode requires a target directory.");
      error.code = "vibe64_local_mode_target_required";
      throw error;
    }
    await assertProjectDirectoryUsable(runtimeProfile.singleTargetRoot);
  }
  const app = Fastify({
    logger: loggerOptions.logger,
    // The proxies whose X-Forwarded-For and -Proto the editor believes (JSKIT's TRUSTED_PROXIES; only loopback when
    // unset), so request.ip, and every limit counted by it, is the visitor behind a host's edge, never the edge.
    trustProxy: resolveTrustedProxies(runtimeEnv),
    // Conversation selectors carry project, session and saved chat identities.
    routerOptions: { maxParamLength: 1024 },
    // The stop gate answers every request that arrives once the stop has begun (server/lib/stopGate.js), with what
    // tells the page it may send it again.
    return503OnClosing: false,
    ajv: {
      customOptions: {
        allowUnionTypes: true
      }
    }
  });
  // Before any upgrade handler (WebSocket routes, realtime, a host's own), so no upgrade's connection is ever left
  // without an error listener.
  handleUpgradeSocketErrors(app.server, { logger: app.log });
  // Before any plugin or route, so a request that arrives while the server stops runs none of them. Hooks that only
  // time or label answers may come before it.
  registerStopGate(app);
  // Before any plugin or route, so every answer, the release bundle's included, refuses other sites' frames.
  registerEditorFraming(app, { env: runtimeEnv });
  for (const warning of loggerOptions.warnings) {
    logOperationalEvent(
      app.log,
      "warn",
      {
        ...warning,
        component: "logging",
        event: "vibe64.logging.invalid_level"
      },
      "Invalid Vibe64 log level; using the default log level."
    );
  }
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 1024 * 1024 }
  });

  const requestedProjectsRoot = runtimeProfile.projectCatalogEnabled === false
    ? String(options.projectsRoot || "").trim()
    : String(options.projectsRoot || runtimeEnv[VIBE64_PROJECTS_ROOT_ENV] || "").trim();
  const rootContract = resolveVibe64Roots({
    env: runtimeEnv,
    explicitManagedSourceRoot: options.managedSourceRoot,
    explicitSystemRoot: options.systemRoot,
    projectsRoot: requestedProjectsRoot,
    runtimeProfile
  });
  const projectsRoot = rootContract.projectsRoot;
  const managedSourceRoot = rootContract.managedSourceRoot;
  const systemRoot = rootContract.systemRoot;
  // A brand-new installation starts with the current format, so it records
  // this release's upgrades before writing any state. Existing state, with or
  // without history, is left to the operator's upgrade command.
  await recordStateUpgradeBaseline({
    systemRoot,
    report: (level, message) => app.log.info({ component: "state-upgrades" }, message)
  }).catch(error => {
    if (error.code !== BASELINE_LEDGER_EXISTS && error.code !== BASELINE_STATE_WITHOUT_LEDGER) throw error;
  });
  // The previous server's end, before anything starts that resumes its work: a crash it could not record (SIGKILL,
  // an out-of-memory kill, power loss) is recorded now, and the turns it left working are counted.
  await recordUntracedStops({
    systemRoot,
    countActiveTurns: async () => (await readVibe64WorkingTurns({ systemRoot })).length,
    logger: app.log
  }).catch((error) => logOperationalEvent(app.log, "error", {
    component: "server-lifecycle",
    error,
    event: "vibe64.server.crash_records_unreadable"
  }, "Could not check how the previous Vibe64 server ended."));
  app.vibe64SystemRoot = systemRoot;
  // Live session state (agent command helpers, pending uploads) lives below the
  // system root for the life of the process, so every caller resolves it alike.
  const attachmentsRoot = configureCodexAttachmentHostRoot(systemRoot, process.env);

  const browserLifecycleMonitor = createBrowserLifecycleMonitor({
    logger: app.log,
    shutdownDelayMs: options.browserLifecycleShutdownDelayMs
  });
  app.browserLifecycleMonitor = browserLifecycleMonitor;

  app.addHook("onClose", async () => {
    browserLifecycleMonitor.stop();
    await closeTerminalSessionsForNamespacePrefix("");
  });

  registerBrowserLifecycleWebSocketRoute(app, browserLifecycleMonitor, { localhostCheckBypassed });

  app.get("/api/health", async () => {
    return {
      ok: true,
      app: "vibe64"
    };
  });
  if (localhostCheckBypassed) {
    logOperationalEvent(app.log, "warn", {
      component: "local-request-check",
      event: "vibe64.security.localhost_check_bypassed"
    }, "Studio localhost request checks are bypassed for this process.");
  }
  const appRoot = resolveStudioAppRoot({
    env: runtimeEnv,
    explicitRoot: options.appRoot,
    fallbackRoot: MODULE_APP_ROOT
  });
  app.vibe64AppRoot = appRoot;
  const projectContext = configureStudioProjectContext({
    cwd: process.cwd(),
    env: runtimeEnv,
    explicitManagedSourceRoot: managedSourceRoot,
    explicitProjectsRoot: projectsRoot,
    explicitSystemRoot: systemRoot,
    explicitTargetRoot: requestedTargetRoot,
    runtimeProfile
  });
  const orphanRuntimeSlugs = await projectContext.sweepOrphanProjectRuntimeRoots();
  if (orphanRuntimeSlugs.length > 0) {
    logOperationalEvent(app.log, "info", {
      component: "project-catalogue",
      event: "vibe64.projects.orphan_runtime_removed",
      slugs: orphanRuntimeSlugs
    }, "Removed the runtime state of projects whose project directory is gone.");
  }
  const targetRoot = projectContext.targetRoot || "";
  const distRoot = path.resolve(appRoot, "dist");
  const indexFile = path.resolve(distRoot, SPA_INDEX_FILE);
  const hasWebBuild = existsSync(indexFile);
  // The one env every feature receives as runtime.env: the runtime env with the roots this server settled on.
  const providerEnv = {
    ...runtimeEnv,
    [VIBE64_APP_ROOT_ENV]: appRoot,
    [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentsRoot,
    [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: normalizeGithubAccountMode(
      options.githubAccountMode,
      GITHUB_ACCOUNT_MODE_LOCAL
    ),
    [VIBE64_PROJECTS_ROOT_ENV]: projectContext.projectsRoot,
    [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
    [VIBE64_TARGET_ROOT_ENV]: targetRoot || undefined
  };
  configureVibe64SessionDebugLog(providerEnv);
  const { createInstalledRuntime: createRuntime = createInstalledRuntime } = options;
  const runtime = await withProcessEnv({
    [VIBE64_APP_ROOT_ENV]: appRoot,
    [VIBE64_PROJECTS_ROOT_ENV]: projectContext.projectsRoot,
    [VIBE64_SYSTEM_ROOT_ENV]: systemRoot,
    [VIBE64_TARGET_ROOT_ENV]: targetRoot || undefined
  }, async () => createRuntime({
    appRoot,
    profile: resolveRuntimeProfileFromSurface({
      surfaceRuntime,
      serverSurface: runtimeEnv.SERVER_SURFACE
    }),
    config: await loadAppConfigFromAppRoot({ appRoot }),
    env: providerEnv,
    logger: app.log,
    fastify: app
  }));
  app.vibe64CapabilityRuntime = runtime.runtime;

  registerSurfaceRequestConstraint({
    fastify: app,
    surfaceRuntime,
    serverSurface: runtimeEnv.SERVER_SURFACE,
    globalUiPaths: buildGlobalUiPaths(runtime.globalUiPaths)
  });

  const localStartupRedirectPath = runtimeProfile.local === true &&
    runtimeProfile.singleTargetRoot
    ? startupBrowserPath({
      startupSlug: options.startupSlug
    })
    : "";
  if (localStartupRedirectPath && localStartupRedirectPath !== "/app") {
    const redirectLocalStartup = async (request, reply) => reply.redirect(
      startupRedirectPathForRequest(request.url, {
        startupSlug: options.startupSlug
      }),
      302
    );
    // A local Vibe64 has no Projects page: "/" and /app open the started project.
    app.get("/", redirectLocalStartup);
    app.get("/app", redirectLocalStartup);
    app.get("/app/", redirectLocalStartup);
  }

  if (hasWebBuild) {
    await registerWebBuildFiles(app, distRoot);
  } else {
    logOperationalEvent(app.log, "warn", {
      component: "web-assets",
      event: "vibe64.web.frontend_build_missing",
      indexFile
    }, "Frontend build not found (dist/index.html). Page routes will return 404 until `npm run build`.");
  }

  registerSpaNotFoundHandler(app, { distRoot, hasWebBuild });

  logOperationalEvent(
    app.log,
    "info",
    {
      component: "jskit-runtime",
      event: "vibe64.server.jskit_runtime_registered",
      surface: surfaceRuntime.normalizeSurfaceMode(runtimeEnv.SERVER_SURFACE),
      projectsRoot: projectContext.projectsRoot,
      systemRoot,
      targetRoot: projectContext.targetRoot || "",
      providerPackages: runtime.providerPackageOrder,
      packageOrder: runtime.packageOrder
    },
    "Registered JSKIT capability runtime."
  );

  return app;
}

async function startServer(options = {}) {
  const runtimeEnv = resolveRuntimeEnv();
  const runtimeProfile = resolveServerRuntimeProfile(options);
  const requestedTargetRoot = targetRootForRuntimeProfile(options, runtimeProfile);
  const listenTarget = resolveListenTarget({
    env: runtimeEnv,
    options
  });
  if (isLocalhostCheckBypassEnabled({ env: runtimeEnv })) {
    assertLocalhostCheckBypassAllowed({
      host: listenTarget.transport === "tcp" ? listenTarget.host : "",
      local: runtimeProfile.local === true
    });
  }
  assertSafeLocalModeListenTarget(runtimeProfile, listenTarget);
  const localAccessToken = localAccessTokenForStart({
    env: runtimeEnv,
    listenTarget,
    required: options.localAccessKey !== false,
    runtimeProfile
  });
  const strictPort = options.strictPort ?? (
    listenTarget.transport === "tcp" &&
    (hasExplicitPortOption(options) || runtimeEnv.PORT !== "")
  );
  const app = await createServer({
    appRoot: options.appRoot,
    browserLifecycleShutdownDelayMs: options.browserLifecycleShutdownDelayMs,
    createInstalledRuntime: options.createInstalledRuntime,
    githubAccountMode: options.githubAccountMode,
    logLevel: options.logLevel,
    managedSourceRoot: options.managedSourceRoot,
    projectsRoot: options.projectsRoot,
    runtimeProfile,
    runtimeMode: runtimeProfile.mode,
    systemRoot: options.systemRoot,
    startupSlug: options.startupSlug,
    targetRoot: requestedTargetRoot
  });
  // Started below once the server listens: from then on, its process records its own abnormal end.
  /** @type {ReturnType<typeof startCrashWatch> | null} */
  let crashWatch = null;
  let stoppingOnSignal = false;
  const closeAndExit = createSignalShutdownHandler({
    app,
    capabilityRuntime: app.vibe64CapabilityRuntime,
    beforeClose() {
      stoppingOnSignal = true;
      app.browserLifecycleMonitor.stop();
    },
    // The exit ends the watch: cleanly on code 0, and a failed stop has its record by then.
    onStopFailed: (error) => crashWatch?.recordStopFailure(error),
    shutdownTimeoutMs: options.shutdownTimeoutMs
  });
  process.once("SIGINT", closeAndExit);
  process.once("SIGTERM", closeAndExit);
  app.addHook("onClose", async () => {
    process.off("SIGINT", closeAndExit);
    process.off("SIGTERM", closeAndExit);
    // A server closed without a stop signal (a caller's app.close()) ends cleanly here.
    if (!stoppingOnSignal) crashWatch?.stop();
  });
  if (options.browserLifecycleShutdown === true) {
    app.browserLifecycleMonitor.enableShutdown(closeAndExit);
  }
  let listenAddress = "";
  if (listenTarget.transport === "socket") {
    await prepareListenSocket(listenTarget.socketPath, { privateDirectory: listenTarget.privateDirectory });
    try {
      listenAddress = await app.listen({
        path: listenTarget.socketPath
      });
      await publishListenSocket(listenTarget.socketPath);
    } catch (error) {
      await app.close();
      throw error;
    }
    app.vibe64Listen = {
      address: listenAddress,
      socketPath: listenTarget.socketPath,
      transport: "socket"
    };
  } else {
    const selectedPort = strictPort ? listenTarget.port : await getPort({
      port: preferredPortRange(listenTarget.port)
    });
    if (localAccessToken) {
      requireLocalAccessToken(app.server, { token: localAccessToken });
    }
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
  crashWatch = startCrashWatch({
    systemRoot: app.vibe64SystemRoot,
    version: serverVersion(app.vibe64AppRoot),
    logger: app.log
  });
  const publicOrigin = String(options.publicOrigin || "").trim();
  const browserUrl = publicOrigin
    ? browserUrlForPublicOrigin(publicOrigin, {
      startupSlug: options.startupSlug
    })
    : listenTarget.transport === "tcp"
      ? browserUrlForListenAddress(listenAddress, {
        startupSlug: options.startupSlug
      })
      : "";
  app.vibe64Url = localAccessToken && browserUrl ? urlWithLocalAccessToken(browserUrl, localAccessToken) : browserUrl;
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
  resolveServerRuntimeProfile,
  startServer,
  startupBrowserPath
};
