import { isIP } from "node:net";
/**
 * How a Studio request is checked: the server computes once, from its runtime
 * env, whether it was started with the localhost check bypassed.
 * @typedef {object} LocalStudioRequestCheck
 * @property {boolean} localhostCheckBypassed
 */

function normalizeHostName(value = "") {
  const host = String(value || "").trim();
  if (!host) {
    return "";
  }
  const ipv6Host = /^\[([^\]]+)\](?::\d+)?$/u.exec(host);
  if (ipv6Host) {
    return ipv6Host[1];
  }
  return host.includes(":") && !host.includes("::") ? host.split(":")[0] : host;
}

function isLoopbackAddress(value = "") {
  const normalized = normalizeHostName(value).toLowerCase();
  return !normalized ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    (isIP(normalized) === 4 && normalized.startsWith("127.")) ||
    (isIP(normalized) === 6 && normalized.startsWith("::ffff:127."));
}

function hostFromOrigin(value = "") {
  const origin = String(value || "").trim();
  if (!origin) {
    return "";
  }
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function hasAuthenticatedVibe64User(request = {}) {
  const user = request.vibe64User;
  return Boolean(
    user &&
    typeof user === "object" &&
    (String(user.username || "").trim() || String(user.email || "").trim())
  );
}

function originMatchesRequest(request = {}) {
  const origin = request.headers?.origin;
  const host = request.headers?.host;
  if (typeof origin !== "string" || typeof host !== "string" || !origin || !host) {
    return false;
  }
  try {
    const originUrl = new URL(origin);
    const forwardedProtocol = String(request.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProtocol || request.protocol ||
      (request.socket?.encrypted || request.raw?.socket?.encrypted ? "https" : "http");
    const requestUrl = new URL(`${protocol}://${host}`);
    return ["http:", "https:"].includes(originUrl.protocol) &&
      originUrl.origin === origin &&
      !requestUrl.username && !requestUrl.password && requestUrl.pathname === "/" &&
      !requestUrl.search && !requestUrl.hash && originUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Whether a WebSocket upgrade comes from this Studio's own page, or from a
 * local command-line client that sends no Origin and no signed-in session.
 * @param {object} request
 * @param {LocalStudioRequestCheck} check
 */
function isTrustedStudioWebSocketRequest(request, check) {
  if (request.headers?.origin !== undefined) {
    return originMatchesRequest(request) && isLocalStudioRequest(request, check);
  }
  // Local command-line clients may omit Origin; signed-in cookie sessions may not.
  return !hasAuthenticatedVibe64User(request) && isLocalStudioRequest(request, check);
}

/**
 * Whether a request is this computer's Studio: a signed-in person's, or one
 * whose address, host and origin are all loopback, unless the server was
 * started with the localhost check bypassed.
 * @param {object} request
 * @param {LocalStudioRequestCheck} check
 */
function isLocalStudioRequest(request, { localhostCheckBypassed }) {
  if (localhostCheckBypassed) {
    return true;
  }
  if (hasAuthenticatedVibe64User(request)) {
    return true;
  }
  const remoteAddress = request.ip || request.socket?.remoteAddress || request.raw?.socket?.remoteAddress || "";
  const host = request.hostname || request.headers?.host || "";
  const originHost = hostFromOrigin(request.headers?.origin);
  return isLoopbackAddress(remoteAddress) && isLoopbackAddress(host) && isLoopbackAddress(originHost);
}

/**
 * Answers 403 to a request that is not this computer's Studio.
 * @param {object} request
 * @param {object} reply
 * @param {LocalStudioRequestCheck & { message?: string }} options
 */
function requireLocalStudioRequest(request, reply, {
  localhostCheckBypassed,
  message = "This Studio route only accepts loopback requests."
}) {
  if (!isLocalStudioRequest(request, { localhostCheckBypassed })) {
    reply.code(403).send({
      ok: false,
      errors: [
        {
          code: "studio_local_request_required",
          message,
          repairCommand: "Open Studio on localhost or 127.0.0.1."
        }
      ]
    });
    return false;
  }
  return true;
}

export {
  isLocalStudioRequest,
  isLoopbackAddress,
  isTrustedStudioWebSocketRequest,
  normalizeHostName,
  originMatchesRequest,
  requireLocalStudioRequest
};
