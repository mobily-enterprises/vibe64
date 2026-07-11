const VIBE64_OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent",
  SESSION_MESSAGE: "session-message"
});

const VIBE64_ACTION_DISPATCH_ROUTES = Object.freeze({
  ...VIBE64_OPERATION_ROUTES,
  EXTERNAL_LINK: "external-link"
});

const VIBE64_CLIENT_CONTROL_ACTIONS = Object.freeze({
  OPEN_DIFF: "open_diff",
  RECONNECT_AGENT_SESSIONS: "reconnect_agent_sessions",
  START_AGENT_TERMINAL: "start_agent_terminal"
});

const VIBE64_CLIENT_CONTROL_ICON_TOKENS = Object.freeze({
  ARCHIVE: "archive",
  BUG_CHECK: "bug-check",
  CODE_REVIEW: "code-review",
  DIFF: "diff",
  GITHUB: "github",
  MERGE: "merge",
  MONITOR_CHECK: "monitor-check",
  PULL_REQUEST: "pull-request",
  SOURCE_COMMIT: "source-commit",
  SYNC: "sync"
});

const VIBE64_CLIENT_CONTROL_STATE_FLAGS = Object.freeze({
  DIFF_DISABLED: "diff_disabled",
  DIFF_LOADING: "diff_loading"
});

function normalizeVibe64ComposerMenuGroupLabel(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function normalizeVibe64ComposerMenuGroupPath(value = [], fallback = []) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  return (Array.isArray(source) ? source : [])
    .map(normalizeVibe64ComposerMenuGroupLabel)
    .filter(Boolean);
}

export * from "./codexAuth.js";
export * from "./emailConfig.js";

export {
  VIBE64_ACTION_DISPATCH_ROUTES,
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS,
  VIBE64_OPERATION_ROUTES,
  normalizeVibe64ComposerMenuGroupLabel,
  normalizeVibe64ComposerMenuGroupPath
};
export * from "./logging.js";
