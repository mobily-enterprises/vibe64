import {
  resolveWebSocketUrl,
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

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

function targetScriptsQueryKey(surfaceId, ownershipFilter, projectSlug, sessionId = "") {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "target-scripts",
    String(sessionId || "")
  ];
}

export {
  TARGET_SCRIPT_TERMINAL_API_SUFFIX,
  TARGET_SCRIPTS_API_SUFFIX,
  targetScriptTerminalWebSocketUrl,
  targetScriptsQueryKey
};
