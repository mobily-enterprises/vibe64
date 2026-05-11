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

function requireLocalStudioRequest(request, reply, {
  message = "This Studio route only accepts loopback requests."
} = {}) {
  const remoteAddress = request.ip || request.socket?.remoteAddress || request.raw?.socket?.remoteAddress || "";
  const host = request.hostname || request.headers?.host || "";
  const originHost = hostFromOrigin(request.headers?.origin);
  if (!isLoopbackAddress(remoteAddress) || !isLoopbackAddress(host) || !isLoopbackAddress(originHost)) {
    reply.code(403).send({
      ok: false,
      errors: [
        {
          code: "studio_local_request_required",
          message,
          repairCommand: "Open JSKIT AI Studio on localhost or 127.0.0.1."
        }
      ]
    });
    return false;
  }
  return true;
}

export {
  isLoopbackAddress,
  normalizeHostName,
  requireLocalStudioRequest
};
