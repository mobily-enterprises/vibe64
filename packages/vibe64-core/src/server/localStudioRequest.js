import {
  isLocalhostCheckBypassEnabled
} from "./localhostCheckBypass.js";

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
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.");
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

function isLocalStudioRequest(request) {
  if (isLocalhostCheckBypassEnabled()) {
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

function requireLocalStudioRequest(request, reply, {
  message = "This Studio route only accepts loopback requests."
} = {}) {
  if (!isLocalStudioRequest(request)) {
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
  hasAuthenticatedVibe64User,
  isLocalStudioRequest,
  isLoopbackAddress,
  normalizeHostName,
  requireLocalStudioRequest
};
