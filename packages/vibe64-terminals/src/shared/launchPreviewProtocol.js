const PREVIEW_BRIDGE_VERSION = 8;
// Learning-only reduced projection of a failed learner-started in-app request.
const PREVIEW_APP_REQUEST_MESSAGE_TYPE = "vibe64:preview-app-request";
const PREVIEW_BRIDGE_READY_MESSAGE_TYPE = "vibe64:preview-bridge-ready";
const PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE = "vibe64:preview-diagnostics-request";
const PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE = "vibe64:preview-diagnostics-response";
const PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE = "vibe64:preview-identity-request";
const PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE = "vibe64:preview-identity-response";
// Click in Preview: the editor starts and stops Pick, the bridge answers with
// what was picked; the editor names the active recording, the bridge reports
// each interaction it starts while that recording is on. Pick start may carry
// the editor's `color` and `onColor` (#rrggbb) for the highlight.
const PREVIEW_INTERACTION_MESSAGE_TYPE = "vibe64:preview-interaction";
const PREVIEW_PICK_RESULT_MESSAGE_TYPE = "vibe64:preview-pick-result";
const PREVIEW_PICK_START_MESSAGE_TYPE = "vibe64:preview-pick-start";
const PREVIEW_PICK_STOP_MESSAGE_TYPE = "vibe64:preview-pick-stop";
const PREVIEW_RECORDING_MESSAGE_TYPE = "vibe64:preview-recording";
const PREVIEW_LOCATION_MESSAGE_TYPE = "vibe64:preview-location";
const PREVIEW_QUERY_MESSAGE_TYPE = "vibe64:preview-query";
const PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE = "vibe64:preview-resource-failure";
const PREVIEW_PROXY_TOKEN_QUERY_PARAM = "vibe64_preview_token";
// The session change that asks the session's editors to open an app page in
// their Preview, as its address box would (`vibe64-helper preview open`).
const PREVIEW_OPEN_REQUESTED_REASON = "preview-open-requested";
const PREVIEW_APP_PATH_MAX_LENGTH = 2048;
const PREVIEW_APP_PATH_PROBE_ORIGIN = "http://preview.invalid";

/**
 * Diagnostic URLs retain the module path, never credentials, query values or fragments.
 */
function previewDiagnosticUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}`.slice(0, 2048) : "";
  } catch {
    return "";
  }
}

/**
 * Why a page someone asks the Preview to open is refused, or "" for a page of
 * the app. Only a path inside the app is accepted: one leading "/", an optional
 * query or hash, nothing a browser reads as another site (a scheme, "//", a
 * backslash, spaces or control characters, which it drops or turns into "/"),
 * none of Vibe64's own Preview pages and no Preview token, which the Preview
 * adds itself.
 * @param {unknown} value
 * @returns {string}
 */
function previewAppPathError(value) {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    return "Give a path inside the app that starts with a single /, for example /orders/42?tab=notes; addresses of other sites are refused.";
  }
  if (path.length > PREVIEW_APP_PATH_MAX_LENGTH) {
    return `A Preview path can be at most ${PREVIEW_APP_PATH_MAX_LENGTH} characters long.`;
  }
  if (/[\\\s\p{Cc}]/u.test(path)) {
    return "A Preview path cannot contain spaces, backslashes or control characters; encode a space as %20.";
  }
  let url;
  try {
    url = new URL(path, `${PREVIEW_APP_PATH_PROBE_ORIGIN}/`);
  } catch {
    return "The Preview path is not a valid address.";
  }
  if (url.origin !== PREVIEW_APP_PATH_PROBE_ORIGIN) {
    return "Give a path inside the app that starts with a single /, for example /orders/42?tab=notes; addresses of other sites are refused.";
  }
  let decodedPath = url.pathname;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    // An undecodable path is still checked as written.
  }
  if ([url.pathname, decodedPath].some((candidate) => /^\/__vibe64(?:\/|$)/iu.test(candidate))) {
    return "Vibe64's own Preview pages cannot be opened; give a page of the app.";
  }
  if (url.searchParams.has(PREVIEW_PROXY_TOKEN_QUERY_PARAM)) {
    return `Leave out ${PREVIEW_PROXY_TOKEN_QUERY_PARAM}; the Preview adds its own access.`;
  }
  return "";
}

export {
  previewAppPathError,
  previewDiagnosticUrl,
  PREVIEW_APP_REQUEST_MESSAGE_TYPE,
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_OPEN_REQUESTED_REASON,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
};
