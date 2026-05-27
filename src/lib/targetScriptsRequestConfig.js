import {
  resolveWebSocketUrl,
  studioApiPath
} from "@/lib/studioHttp.js";

const TARGET_SCRIPTS_API_SUFFIX = "/studio/current-app/target-scripts";
const TARGET_SCRIPT_TERMINAL_API_SUFFIX = "/studio/current-app/target-script-terminal";
const TARGET_SCRIPT_TERMINAL_ENDPOINT = studioApiPath("studio/current-app/target-script-terminal");

function targetScriptTerminalEndpoint(terminalSessionId = "") {
  return terminalSessionId
    ? `${TARGET_SCRIPT_TERMINAL_ENDPOINT}/${encodeURIComponent(terminalSessionId)}`
    : TARGET_SCRIPT_TERMINAL_ENDPOINT;
}

function targetScriptTerminalWebSocketUrl(terminalSessionId) {
  return resolveWebSocketUrl(`${targetScriptTerminalEndpoint(terminalSessionId)}/ws`);
}

function targetScriptsQueryKey(surfaceId, ownershipFilter) {
  return ["vibe64", surfaceId, ownershipFilter, "target-scripts"];
}

export {
  TARGET_SCRIPT_TERMINAL_API_SUFFIX,
  TARGET_SCRIPTS_API_SUFFIX,
  targetScriptTerminalWebSocketUrl,
  targetScriptsQueryKey
};
