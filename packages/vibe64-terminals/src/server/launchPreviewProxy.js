import { createServer } from "node:http";
import crypto from "node:crypto";
import {
  lstatSync
} from "node:fs";

import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import { normalizePreviewAuthKind } from "@local/vibe64-core/server/previewAuth";

import { previewProxyDebugLog } from "./launchPreviewDebugLog.js";
import {
  appendPreviewTokenQueryParam,
  normalizePreviewEditorOrigin,
  normalizePreviewTargetHref,
  previewTokenHash,
  requestPreviewOrigin
} from "./launchPreviewHeaders.js";
import {
  listenOnPreviewPort,
  listenOnPreviewSocket,
  normalizePreviewPublicOrigin,
  previewPublicSocketPath,
  pruneStalePreviewSockets
} from "./launchPreviewListening.js";
import {
  closePreviewServer,
  createPreviewProxyConnectionTracker,
  DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS,
  trackPreviewServerSockets
} from "./launchPreviewConnections.js";
import { createPreviewIdentityGrantConsumer } from "./launchPreviewIdentity.js";
import { proxyPreviewRequest, proxyPreviewUpgrade } from "./launchPreviewForwarding.js";

const PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS_ENV = "VIBE64_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS";
function normalizePreviewProxySocketIdleTimeoutMs(value = undefined, options = {}) {
  const {
    env = process.env
  } = options;
  const number = Number(value ?? env?.[PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS_ENV]);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS;
}

function createLaunchPreviewProxyRegistry({
  env = process.env,
  hostEnv = process.env,
  socketIdleTimeoutMs = undefined
} = {}) {
  const runtimeEnv = previewProxyRuntimeEnv(env, hostEnv);
  const proxies = new Map();
  const pendingStarts = new Map();
  let publicSocketPreparation = null;
  const normalizedSocketIdleTimeoutMs = normalizePreviewProxySocketIdleTimeoutMs(socketIdleTimeoutMs, {
    env: runtimeEnv
  });

  async function ensure(input = {}, connectHref = "") {
    const publicOrigin = normalizePreviewPublicOrigin(input.previewPublicOrigin);
    if (publicOrigin) {
      if (!publicSocketPreparation) {
        publicSocketPreparation = pruneStalePreviewSockets({
          env: runtimeEnv
        }).catch((error) => {
          publicSocketPreparation = null;
          throw error;
        });
      }
      await publicSocketPreparation;
    }
    const scope = previewProxyScope(input, {
      publicOrigin,
      targetHref: connectHref
    });
    const targetUrl = normalizePreviewTargetHref(scope.targetHref);
    const connectUrl = normalizePreviewTargetHref(connectHref || targetUrl.toString());
    const key = previewProxyKey(scope);
    const existing = proxies.get(key);
    const previewAuth = normalizePreviewAuth(input.previewAuth, {
      targetHref: targetUrl.toString()
    });
    const identity = previewProxyIdentity({
      connectHref: connectUrl.toString(),
      previewAuth,
      publicOrigin,
      targetHref: targetUrl.toString(),
      terminalSessionId: scope.terminalSessionId
    });
    previewProxyDebugLog("server.launchPreviewProxy.ensure", {
      existingProxy: Boolean(existing),
      pendingStart: pendingStarts.has(key),
      existingConnectHref: String(existing?.connectHref || ""),
      existingTargetHref: String(existing?.targetHref || ""),
      connectHref: connectUrl.toString(),
      key,
      projectScope: String(scope.projectScope || ""),
      publicOrigin,
      sessionId: String(scope.sessionId || ""),
      targetHref: targetUrl.toString(),
      terminalSessionId: String(scope.terminalSessionId || "")
    });
    const existingIdentityMatches = Boolean(
      existing && previewProxyMatchesIdentity(existing, identity)
    );
    if (
      existingIdentityMatches &&
      existing.isPublished()
    ) {
      previewProxyDebugLog("server.launchPreviewProxy.reuse", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(existing.origin || ""),
        sessionId: String(scope.sessionId || ""),
        connectHref: connectUrl.toString(),
        targetHref: targetUrl.toString(),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      existing.allowEditorOrigin(input.editorOrigin);
      existing.useLocatorSource(input.locatorSource);
      return proxyDescriptor(existing, targetUrl);
    }
    const pending = pendingStarts.get(key);
    if (pending) {
      if (previewProxyIdentityMatches(pending.identity, identity)) {
        previewProxyDebugLog("server.launchPreviewProxy.awaitPending", {
          key,
          projectScope: String(scope.projectScope || ""),
          publicOrigin,
          sessionId: String(scope.sessionId || ""),
          targetHref: targetUrl.toString(),
          terminalSessionId: String(scope.terminalSessionId || "")
        });
        const proxy = await pending.promise;
        proxy.allowEditorOrigin(input.editorOrigin);
        proxy.useLocatorSource(input.locatorSource);
        return proxyDescriptor(proxy, targetUrl);
      }
      previewProxyDebugLog("server.launchPreviewProxy.awaitPendingReplacement", {
        key,
        projectScope: String(scope.projectScope || ""),
        publicOrigin,
        sessionId: String(scope.sessionId || ""),
        targetHref: targetUrl.toString(),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      await pending.promise.catch(() => null);
      return ensure(input, connectHref);
    }
    if (existing) {
      previewProxyDebugLog("server.launchPreviewProxy.replace", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(existing.origin || ""),
        publicOrigin,
        reason: existingIdentityMatches
          ? "proxy_listener_unpublished"
          : "proxy_identity_changed",
        sessionId: String(scope.sessionId || ""),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
    }

    const pendingEntry = {
      closeRequested: false,
      identity,
      promise: null,
      scope: {
        ...scope,
        targetHref: targetUrl.toString()
      }
    };
    pendingStarts.set(key, pendingEntry);
    if (existing) {
      proxies.delete(key);
    }
    pendingEntry.promise = (async () => {
      if (existing) {
        await existing.close();
      }
      const proxy = await startLaunchPreviewProxy({
        connectUrl,
        targetUrl
      }, {
        ...scope,
        targetHref: targetUrl.toString()
      }, {
        env: runtimeEnv,
        executePreviewIdentityCommand: input.executePreviewIdentityCommand,
        previewAuth,
        publicOrigin,
        socketIdleTimeoutMs: normalizedSocketIdleTimeoutMs
      });
      if (pendingEntry.closeRequested) {
        await proxy.close();
        throw new Error("Launch preview proxy was closed while starting.");
      }
      return proxy;
    })();
    try {
      const proxy = await pendingEntry.promise;
      proxy.allowEditorOrigin(input.editorOrigin);
      proxy.useLocatorSource(input.locatorSource);
      proxies.set(key, proxy);
      previewProxyDebugLog("server.launchPreviewProxy.created", {
        key,
        projectScope: String(scope.projectScope || ""),
        proxyOrigin: String(proxy.origin || ""),
        publicOrigin,
        sessionId: String(scope.sessionId || ""),
        targetHref: targetUrl.toString(),
        terminalSessionId: String(scope.terminalSessionId || "")
      });
      return proxyDescriptor(proxy, targetUrl);
    } finally {
      if (pendingStarts.get(key) === pendingEntry) {
        pendingStarts.delete(key);
      }
    }
  }

  /**
   * Pending starts are marked so their starter closes the proxy it opens.
   */
  async function closeMatching(matches, debugEvent, debugDetails = {}) {
    const closeEntries = [...proxies.entries()].filter(([, proxy]) => matches(proxy.scope));
    const pendingCloseEntries = [...pendingStarts.entries()].filter(([, pending]) => matches(pending.scope));
    if (closeEntries.length > 0 || pendingCloseEntries.length > 0) {
      previewProxyDebugLog(debugEvent, {
        count: closeEntries.length,
        pendingCount: pendingCloseEntries.length,
        ...debugDetails,
        targets: closeEntries.map(([, proxy]) => ({
          connectHref: String(proxy.connectHref || ""),
          projectScope: String(proxy.scope?.projectScope || ""),
          proxyOrigin: String(proxy.origin || ""),
          sessionId: String(proxy.scope?.sessionId || ""),
          targetHref: String(proxy.targetHref || ""),
          terminalSessionId: String(proxy.scope?.terminalSessionId || "")
        }))
      });
    }
    for (const [, pending] of pendingCloseEntries) {
      pending.closeRequested = true;
    }
    await Promise.all([
      ...closeEntries.map(async ([key, proxy]) => {
        proxies.delete(key);
        await proxy.close();
      }),
      ...pendingCloseEntries.map(async ([key, pending]) => {
        try {
          const proxy = await pending.promise;
          proxies.delete(key);
          await proxy.close();
        } catch {
          // The starter closes and rejects when closeRequested is set.
        } finally {
          if (pendingStarts.get(key) === pending) {
            pendingStarts.delete(key);
          }
        }
      })
    ]);
  }

  async function close(input = {}) {
    const scope = previewProxyScope(input);
    await closeMatching((candidate) => (
      candidate.projectScope === scope.projectScope &&
      candidate.sessionId === scope.sessionId &&
      (!scope.terminalSessionId || candidate.terminalSessionId === scope.terminalSessionId)
    ), "server.launchPreviewProxy.close", {
      projectScope: String(scope.projectScope || ""),
      sessionId: String(scope.sessionId || ""),
      terminalSessionId: String(scope.terminalSessionId || "")
    });
  }

  async function closeAll() {
    await closeMatching(() => true, "server.launchPreviewProxy.closeAll");
  }

  return Object.freeze({
    close,
    closeAll,
    ensure
  });
}

function previewProxyRuntimeEnv(env = {}, hostEnv = process.env) {
  const hostRuntimeEnv = hostEnv && typeof hostEnv === "object" && !Array.isArray(hostEnv)
    ? hostEnv
    : {};
  const configuredEnv = env && typeof env === "object" && !Array.isArray(env)
    ? env
    : {};
  return {
    ...hostRuntimeEnv,
    ...configuredEnv
  };
}

function previewProxyScope(input = {}, options = {}) {
  const {
    publicOrigin = "",
    targetHref = ""
  } = options;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      publicOrigin: String(publicOrigin || input.previewPublicOrigin || "").trim(),
      sessionId: String(input.sessionId || "").trim(),
      targetHref: String(input.targetHref || targetHref || "").trim(),
      terminalSessionId: String(input.terminalSessionId || "").trim(),
      projectScope: String(input.projectScope || currentProjectScopeKey()).trim() || "global"
    };
  }
  return {
    publicOrigin: String(publicOrigin || "").trim(),
    sessionId: String(input || "").trim(),
    targetHref: String(targetHref || "").trim(),
    terminalSessionId: "",
    projectScope: currentProjectScopeKey()
  };
}

function previewProxyKey(scope = {}) {
  return [
    scope.projectScope,
    `session:${scope.sessionId}`,
    `origin:${scope.publicOrigin || "local"}`
  ].join(":");
}

function previewProxyIdentity({
  connectHref = "",
  previewAuth = null,
  publicOrigin = "",
  targetHref = "",
  terminalSessionId = ""
} = {}) {
  return Object.freeze({
    connectHref: String(connectHref || ""),
    previewAuthFingerprint: previewAuthFingerprint(previewAuth),
    publicOrigin: String(publicOrigin || ""),
    targetHref: String(targetHref || ""),
    terminalSessionId: String(terminalSessionId || "")
  });
}

function previewProxyMatchesIdentity(proxy = {}, identity = {}) {
  return previewProxyIdentityMatches(previewProxyIdentity({
    connectHref: proxy.connectHref,
    previewAuth: proxy.previewAuth,
    publicOrigin: proxy.publicOrigin,
    targetHref: proxy.targetHref,
    terminalSessionId: proxy.scope?.terminalSessionId
  }), identity);
}

function previewProxyIdentityMatches(left = {}, right = {}) {
  return left.connectHref === right.connectHref &&
    left.targetHref === right.targetHref &&
    left.publicOrigin === right.publicOrigin &&
    left.terminalSessionId === right.terminalSessionId &&
    left.previewAuthFingerprint === right.previewAuthFingerprint;
}

async function startLaunchPreviewProxy({
  connectUrl,
  targetUrl
} = {}, scope = {}, options = {}) {
  const {
    env = process.env,
    executePreviewIdentityCommand = null,
    previewAuth = null,
    publicOrigin = "",
    socketIdleTimeoutMs = DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS
  } = options;
  const server = createServer();
  const tracker = createPreviewProxyConnectionTracker({
    socketIdleTimeoutMs
  });
  trackPreviewServerSockets(server, {
    tracker
  });
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenScope = {
    ...scope,
    targetHref: targetUrl.toString()
  };
  const connectOrigin = connectUrl.origin;
  const tokenHash = previewTokenHash(token, tokenScope);
  const consumeIdentityGrant = previewAuth
    ? createPreviewIdentityGrantConsumer(previewAuth)
    : null;
  let proxyOrigin = "";
  // Editors that were handed this Preview; only they may talk to its bridge.
  const editorOrigins = new Set();
  // The project's Preview locator, inlined into each page's bridge.
  let locatorSource = "";
  server.on("request", (request, response) => {
    void proxyPreviewRequest(request, response, {
      connectOrigin,
      consumeIdentityGrant,
      editorOrigins: [...editorOrigins],
      executePreviewIdentityCommand,
      locatorSource,
      previewAuth,
      proxyOrigin: requestPreviewOrigin(request, proxyOrigin),
      tracker,
      token,
      tokenScope,
      tokenHash,
      targetHost: targetUrl.host,
      targetOrigin: targetUrl.origin
    });
  });
  server.on("upgrade", (request, socket, head) => {
    proxyPreviewUpgrade(request, socket, head, {
      connectOrigin,
      proxyOrigin: requestPreviewOrigin(request, proxyOrigin),
      tracker,
      tokenScope,
      tokenHash,
      targetHost: targetUrl.host,
      targetOrigin: targetUrl.origin
    });
  });

  const listen = publicOrigin
    ? await listenOnPreviewSocket(server, {
      env,
      publicOrigin
    })
    : await listenOnPreviewPort(server, {
      env
    });

  server.unref();
  proxyOrigin = listen.origin;
  previewProxyDebugLog("server.launchPreviewProxy.started", {
    connectHref: connectUrl.toString(),
    listenKind: listen.kind,
    port: listen.port,
    projectScope: String(scope.projectScope || ""),
    proxyOrigin,
    sessionId: String(scope.sessionId || ""),
    socketPath: listen.socketPath || "",
    targetHref: targetUrl.toString(),
    terminalSessionId: String(scope.terminalSessionId || "")
  });
  function allowEditorOrigin(value = "") {
    const origin = normalizePreviewEditorOrigin(value);
    if (origin) {
      editorOrigins.add(origin);
    }
  }

  function useLocatorSource(value = "") {
    locatorSource = typeof value === "string" ? value : "";
  }

  function close() {
    return closePreviewServer({
      listen,
      server,
      tracker
    });
  }

  /** Whether the proxy still listens, on the same socket file when it listens on one. */
  function isPublished() {
    if (!server.listening) {
      return false;
    }
    if (!listen.socketPath) {
      return true;
    }
    try {
      const socket = lstatSync(listen.socketPath);
      return socket.isSocket() &&
        socket.dev === listen.socketDevice &&
        socket.ino === listen.socketInode;
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(String(error?.code || ""))) {
        return false;
      }
      throw error;
    }
  }

  return Object.freeze({
    allowEditorOrigin,
    useLocatorSource,
    close,
    isPublished,
    origin: proxyOrigin,
    connectHref: connectUrl.toString(),
    publicOrigin,
    previewAuth,
    scope: Object.freeze({
      sessionId: String(scope.sessionId || "").trim(),
      terminalSessionId: String(scope.terminalSessionId || "").trim(),
      projectScope: String(scope.projectScope || "").trim(),
      publicOrigin: String(scope.publicOrigin || "").trim()
    }),
    token,
    targetHref: targetUrl.toString()
  });
}

function normalizePreviewAuth(value = {}, options = {}) {
  const {
    targetHref = ""
  } = options;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const kind = normalizePreviewAuthKind(value.kind);
  if (!kind) {
    return null;
  }
  return {
    identityTypes: Array.isArray(value.identityTypes)
      ? value.identityTypes.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
    kind,
    projectScope: String(value.projectScope || ""),
    secret: String(value.secret || ""),
    sessionSourceRoot: String(value.sessionSourceRoot || ""),
    sessionId: String(value.sessionId || ""),
    sessionRoot: String(value.sessionRoot || ""),
    targetHref: String(value.targetHref || targetHref || ""),
    terminalSessionId: String(value.terminalSessionId || "")
  };
}

function previewAuthFingerprint(value = null) {
  if (!value) {
    return "";
  }
  return JSON.stringify([
    value.kind,
    value.identityTypes,
    value.projectScope,
    value.secret
      ? crypto.createHash("sha256").update(String(value.secret)).digest("hex")
      : "",
    value.sessionSourceRoot,
    value.sessionId,
    value.sessionRoot,
    value.targetHref,
    value.terminalSessionId
  ]);
}

function proxyDescriptor(proxy, targetUrl) {
  const href = new URL(proxy.origin);
  href.pathname = targetUrl.pathname;
  href.search = appendPreviewTokenQueryParam(targetUrl.search, proxy.token);
  href.hash = targetUrl.hash;
  return {
    available: true,
    disabledReason: "",
    href: href.toString(),
    kind: "url",
    label: "Preview",
    targetHref: targetUrl.toString()
  };
}

export {
  createLaunchPreviewProxyRegistry,
  normalizePreviewEditorOrigin,
  previewPublicSocketPath
};
