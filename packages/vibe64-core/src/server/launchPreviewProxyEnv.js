const PREVIEW_PROXY_PORT_START = 49100;
const PREVIEW_PROXY_PORT_END = 49999;
const PREVIEW_PROXY_HOST_ENV = "VIBE64_PREVIEW_PROXY_HOST";
const PREVIEW_PROXY_PUBLIC_HOST_ENV = "VIBE64_PREVIEW_PROXY_PUBLIC_HOST";
const PREVIEW_PROXY_PORT_START_ENV = "VIBE64_PREVIEW_PROXY_PORT_START";
const PREVIEW_PROXY_PORT_END_ENV = "VIBE64_PREVIEW_PROXY_PORT_END";
const VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV = "VIBE64_PREVIEW_PUBLIC_DOMAIN";
const VIBE64_PUBLIC_PROTOCOL_ENV = "VIBE64_PUBLIC_PROTOCOL";
const VIBE64_PUBLIC_USER_DOMAIN_ENV = "VIBE64_PUBLIC_USER_DOMAIN";

function normalizePreviewProxyPort(value, fallback) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : fallback;
}

function previewProxyPortRange(env = process.env) {
  const start = normalizePreviewProxyPort(
    env?.[PREVIEW_PROXY_PORT_START_ENV],
    PREVIEW_PROXY_PORT_START
  );
  const end = normalizePreviewProxyPort(
    env?.[PREVIEW_PROXY_PORT_END_ENV],
    Math.max(start, PREVIEW_PROXY_PORT_END)
  );
  return {
    end: end >= start ? end : start,
    start
  };
}

export {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END,
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START,
  PREVIEW_PROXY_PORT_START_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV,
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV,
  previewProxyPortRange
};
