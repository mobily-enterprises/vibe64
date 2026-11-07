import { randomBytes, timingSafeEqual } from "node:crypto";

// A server on a TCP port is reachable by every process and Unix account on this
// computer, so loopback alone does not show a request is the person's. Each
// start makes a secret access key: the address Vibe64 prints carries it once,
// the server answers with a cookie, and every request and WebSocket upgrade
// must bring the cookie (or, from a development proxy, the header).
const LOCAL_ACCESS_TOKEN_ENV = "VIBE64_LOCAL_ACCESS_TOKEN";
const LOCAL_ACCESS_QUERY_PARAMETER = "vibe64-access";
const LOCAL_ACCESS_HEADER = "x-vibe64-local-access";
const LOCAL_ACCESS_MIN_TOKEN_LENGTH = 32;
const LOCAL_ACCESS_OPEN_PATHS = new Set(["/api/health"]);
const LOCAL_ACCESS_REFUSAL = Object.freeze({
  code: "vibe64_local_access_required",
  message: "Open Vibe64 from the address it printed when it started."
});

/**
 * This start's key: the configured one (a development proxy or test harness
 * that must send it), otherwise a new random one.
 * @param {object} input
 * @param {Record<string, string | undefined>} input.env
 */
function resolveLocalAccessToken({ env }) {
  const configured = String(env[LOCAL_ACCESS_TOKEN_ENV] || "").trim();
  if (!configured) {
    return randomBytes(32).toString("base64url");
  }
  if (configured.length < LOCAL_ACCESS_MIN_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(configured)) {
    const error = new Error(
      `${LOCAL_ACCESS_TOKEN_ENV} must be at least ${LOCAL_ACCESS_MIN_TOKEN_LENGTH} letters, digits, "-" or "_".`
    );
    error.code = "vibe64_local_access_token_invalid";
    throw error;
  }
  return configured;
}

/**
 * The key this start needs, or "" for none: a socket reaches only this user,
 * and a host that signs its people in serves them through its own proxy.
 * @param {object} input
 * @param {Record<string, string | undefined>} input.env
 * @param {{ transport: string }} input.listenTarget
 * @param {{ local?: boolean }} input.runtimeProfile
 * @param {boolean} [input.required] false only for a harness that starts the server in-process
 */
function localAccessTokenForStart({ env, listenTarget, runtimeProfile, required = true }) {
  return required && runtimeProfile.local === true && listenTarget.transport === "tcp"
    ? resolveLocalAccessToken({ env })
    : "";
}

/** Cookies ignore ports, so each port's server keeps its own cookie. */
function localAccessCookieName(port) {
  return `vibe64_local_access_${port}`;
}

function sameToken(candidate = "", token = "") {
  const given = Buffer.from(String(candidate || ""));
  const expected = Buffer.from(token);
  return expected.length > 0 && given.length === expected.length && timingSafeEqual(given, expected);
}

function requestCookie(request, name) {
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return "";
}

function hasLocalAccess(request, { cookieName, token }) {
  const header = request.headers[LOCAL_ACCESS_HEADER];
  return sameToken(requestCookie(request, cookieName), token) ||
    sameToken(Array.isArray(header) ? header[0] : header, token);
}

/** The address to open: the browser address with this start's key. */
function urlWithLocalAccessToken(url, token) {
  const parsed = new URL(url);
  parsed.searchParams.set(LOCAL_ACCESS_QUERY_PARAMETER, token);
  return parsed.href;
}

function refuseRequest(response) {
  const body = JSON.stringify({ ok: false, errors: [LOCAL_ACCESS_REFUSAL] });
  response.writeHead(403, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(body);
}

function refuseUpgrade(socket) {
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
  socket.destroy();
}

/**
 * Lets through only requests and upgrades that carry this start's key, before
 * Fastify, its WebSocket routes or realtime see them. A GET bringing the key
 * in its address gets the cookie and goes to the same address without it.
 * @param {import("node:http").Server} server
 * @param {object} input
 * @param {string} input.token
 */
function requireLocalAccessToken(server, { token }) {
  const emit = server.emit;
  const cookieName = () => localAccessCookieName(server.address()?.port);
  server.emit = function emitWithLocalAccess(event, ...args) {
    if (event === "request") {
      const [request, response] = args;
      const url = new URL(request.url || "/", "http://localhost");
      const access = { cookieName: cookieName(), token };
      if (LOCAL_ACCESS_OPEN_PATHS.has(url.pathname) || hasLocalAccess(request, access)) {
        return emit.call(this, event, ...args);
      }
      if (["GET", "HEAD"].includes(request.method) && sameToken(url.searchParams.get(LOCAL_ACCESS_QUERY_PARAMETER), token)) {
        url.searchParams.delete(LOCAL_ACCESS_QUERY_PARAMETER);
        response.writeHead(302, {
          "cache-control": "no-store",
          // One leading slash keeps the redirect on this server.
          location: `/${url.pathname.replace(/^\/+/u, "")}${url.search}`,
          "set-cookie": `${access.cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax`
        });
        response.end();
        return true;
      }
      refuseRequest(response);
      return true;
    }
    if (event === "upgrade" && !hasLocalAccess(args[0], { cookieName: cookieName(), token })) {
      refuseUpgrade(args[1]);
      return true;
    }
    return emit.call(this, event, ...args);
  };
}

export {
  LOCAL_ACCESS_HEADER,
  LOCAL_ACCESS_QUERY_PARAMETER,
  LOCAL_ACCESS_TOKEN_ENV,
  localAccessCookieName,
  localAccessTokenForStart,
  requireLocalAccessToken,
  resolveLocalAccessToken,
  urlWithLocalAccessToken
};
