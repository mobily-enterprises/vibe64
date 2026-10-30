// Attribution of each function entry: the Preview proxy's request id read at
// Node's own HTTP boundary, else a local request scope, else the process's run
// (terminal targets) or background (web targets) scope. Only the request id
// header, the method and the path without its query are read from a request.
import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";
import https from "node:https";

import { USAGE_RECORDING_REQUEST_HEADER, USAGE_REQUEST_ID_PATTERN } from "../../src/shared/contract.js";

const PATH_LIMIT = 256;
const METHOD_PATTERN = /^[A-Z]{1,16}$/u;

function scopeRecord(id, kind, startedAt, label = "") {
  return { id, kind, label, startedAt, endedAt: "", counts: new Map(), lineWritten: false, endWritten: false };
}

// The path a local request scope is labelled with: never its query or fragment.
function requestPath(url = "") {
  const text = String(url || "");
  let pathname = text.split(/[?#]/u)[0];
  if (!pathname.startsWith("/")) {
    try { pathname = new URL(text).pathname; } catch { pathname = "/"; }
  }
  return pathname.slice(0, PATH_LIMIT) || "/";
}

function createScopes({ pid = process.pid, targetKind = "web", now = () => new Date().toISOString() } = {}) {
  const storage = new AsyncLocalStorage();
  const processScope = targetKind === "terminal"
    ? scopeRecord(`run_${pid}`, "run", now())
    : scopeRecord(`bg_${pid}`, "background", now());
  let localRequests = 0;

  function requestScope(request) {
    const proxied = request?.headers?.[USAGE_RECORDING_REQUEST_HEADER];
    if (typeof proxied === "string" && USAGE_REQUEST_ID_PATTERN.test(proxied)) {
      return scopeRecord(proxied, "request", now());
    }
    localRequests += 1;
    const method = METHOD_PATTERN.test(String(request?.method || "")) ? request.method : "GET";
    return scopeRecord(`l_${pid}_${localRequests}`, "local-request", now(), `${method} ${requestPath(request?.url)}`);
  }

  return {
    processScope,
    current: () => storage.getStore() || processScope,

    // Every request a Node http or https server emits runs in its own scope
    // while recording; once idle, requests are emitted untouched.
    patchServers({ isActive, onRequestEnd }) {
      for (const Server of [http.Server, https.Server]) {
        const emit = Server.prototype.emit;
        Server.prototype.emit = function emitWithUsageScope(event, request, response) {
          if (event !== "request" || !isActive()) return emit.apply(this, arguments);
          let scope = null;
          try {
            scope = requestScope(request);
            response?.once?.("close", () => onRequestEnd(scope));
          } catch {
            scope = null;
          }
          return scope ? storage.run(scope, () => emit.apply(this, arguments)) : emit.apply(this, arguments);
        };
      }
    }
  };
}

export { createScopes, requestPath };
