const VIBE64_OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent"
});

const VIBE64_ACTION_DISPATCH_ROUTES = Object.freeze({
  ...VIBE64_OPERATION_ROUTES,
  EXTERNAL_LINK: "external-link"
});

const VIBE64_CLIENT_CONTROL_ACTIONS = Object.freeze({
  CONTINUE_CODEX_TURN: "continue_codex_turn",
  OPEN_DIFF: "open_diff",
  START_CODEX_TERMINAL: "start_codex_terminal"
});

const VIBE64_CLIENT_CONTROL_ICON_TOKENS = Object.freeze({
  DIFF: "diff"
});

const VIBE64_CLIENT_CONTROL_STATE_FLAGS = Object.freeze({
  DIFF_DISABLED: "diff_disabled",
  DIFF_LOADING: "diff_loading"
});

export {
  VIBE64_ACTION_DISPATCH_ROUTES,
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS,
  VIBE64_OPERATION_ROUTES
};
