const PREVIEW_BRIDGE_VERSION = 6;
const PREVIEW_BRIDGE_READY_MESSAGE_TYPE = "vibe64:preview-bridge-ready";
const PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE = "vibe64:preview-diagnostics-request";
const PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE = "vibe64:preview-diagnostics-response";
const PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE = "vibe64:preview-identity-request";
const PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE = "vibe64:preview-identity-response";
const PREVIEW_LOCATION_MESSAGE_TYPE = "vibe64:preview-location";
const PREVIEW_QUERY_MESSAGE_TYPE = "vibe64:preview-query";
const PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE = "vibe64:preview-resource-failure";
const PREVIEW_PROXY_TOKEN_QUERY_PARAM = "vibe64_preview_token";

// Diagnostic URLs retain the module path, never credentials, query values or fragments.
function previewDiagnosticUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}`.slice(0, 2048) : "";
  } catch { return ""; }
}

export {
  previewDiagnosticUrl,
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
};
