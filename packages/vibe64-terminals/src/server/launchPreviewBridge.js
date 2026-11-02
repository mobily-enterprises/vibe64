import { readFileSync } from "node:fs";
import {
  PREVIEW_APP_REQUEST_MESSAGE_TYPE,
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_BRIDGE_VERSION,
  PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_PICK_START_MESSAGE_TYPE,
  PREVIEW_PICK_STOP_MESSAGE_TYPE,
  PREVIEW_PROXY_TOKEN_QUERY_PARAM,
  PREVIEW_QUERY_MESSAGE_TYPE,
  PREVIEW_RECORDING_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
} from "../shared/launchPreviewProtocol.js";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import {
  USAGE_RECORDING_ID_PATTERN,
  USAGE_RECORDING_INTERACTION_HEADER
} from "@local/vibe64-usage-recording/shared/contract";

// The bridge's browser script, read once and served as written; the page's
// config goes where its placeholder stands.
const BRIDGE_SCRIPT_CONFIG_PLACEHOLDER = "__VIBE64_PREVIEW_BRIDGE_CONFIG__";
const [BRIDGE_SCRIPT_HEAD, BRIDGE_SCRIPT_TAIL] = readFileSync(new URL("./launchPreviewBridgeScript.txt", import.meta.url), "utf8")
  .trimEnd()
  .split(BRIDGE_SCRIPT_CONFIG_PLACEHOLDER);

/**
 * The project's Preview locator runs as its own script after the bridge, so a
 * locator that throws or fails to parse leaves the bridge working. Its text is
 * kept from closing the element early or opening an HTML comment.
 */
function previewLocatorScript(source = "") {
  const text = typeof source === "string" ? source : "";
  if (!text.trim()) {
    return "";
  }
  return `<script data-vibe64-preview-locator="1">(() => {\n${text.replace(/<(?=\/script|!--)/giu, "\\x3C")}\n})();</script>`;
}

/**
 * The bridge talks only to the editors that asked for this Preview: it ignores
 * messages from any other parent origin and addresses every reply to those
 * editor origins, so a foreign page that frames the Preview learns nothing.
 * `recording` is the session's Preview recording when the page was served; the
 * editor keeps it current and numbers its interactions.
 */
function launchPreviewBridgeScript({
  debug = false,
  locatorSource = "",
  parentOrigins = [],
  recording = null,
  targetOrigin = ""
} = {}) {
  const recordingId = String(recording?.recordingId || "");
  const config = JSON.stringify({
    appRequestMessageType: PREVIEW_APP_REQUEST_MESSAGE_TYPE,
    bridgeReadyMessageType: PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
    debug: debug === true,
    diagnosticsRequestMessageType: PREVIEW_DIAGNOSTICS_REQUEST_MESSAGE_TYPE,
    diagnosticsResponseMessageType: PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
    identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
    identityRequestMessageType: PREVIEW_IDENTITY_REQUEST_MESSAGE_TYPE,
    identityResponseMessageType: PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
    interactionHeader: USAGE_RECORDING_INTERACTION_HEADER,
    interactionMessageType: PREVIEW_INTERACTION_MESSAGE_TYPE,
    locationMessageType: PREVIEW_LOCATION_MESSAGE_TYPE,
    parentOrigins: [...new Set((Array.isArray(parentOrigins) ? parentOrigins : [])
      .map((origin) => String(origin || "").trim())
      .filter(Boolean))],
    pickResultMessageType: PREVIEW_PICK_RESULT_MESSAGE_TYPE,
    pickStartMessageType: PREVIEW_PICK_START_MESSAGE_TYPE,
    pickStopMessageType: PREVIEW_PICK_STOP_MESSAGE_TYPE,
    queryMessageType: PREVIEW_QUERY_MESSAGE_TYPE,
    recording: recording?.active === true && USAGE_RECORDING_ID_PATTERN.test(recordingId) ? recordingId : "",
    recordingIdPattern: USAGE_RECORDING_ID_PATTERN.source,
    recordingMessageType: PREVIEW_RECORDING_MESSAGE_TYPE,
    resourceFailureMessageType: PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE,
    targetOrigin: String(targetOrigin || ""),
    tokenQueryParam: PREVIEW_PROXY_TOKEN_QUERY_PARAM,
    version: PREVIEW_BRIDGE_VERSION
  });

  return `<script data-vibe64-preview-bridge="1">${BRIDGE_SCRIPT_HEAD}${config}${BRIDGE_SCRIPT_TAIL}</script>${previewLocatorScript(locatorSource)}`;
}

function injectLaunchPreviewBridge(html = "", options = {}) {
  const source = String(html || "");
  if (!source || source.includes("data-vibe64-preview-bridge")) {
    return source;
  }
  const bridge = launchPreviewBridgeScript(options);
  if (/<head(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  if (/<body(?:\s[^>]*)?>/iu.test(source)) {
    return source.replace(/<body(?:\s[^>]*)?>/iu, (match) => `${match}${bridge}`);
  }
  return `${bridge}${source}`;
}

export {
  injectLaunchPreviewBridge
};
