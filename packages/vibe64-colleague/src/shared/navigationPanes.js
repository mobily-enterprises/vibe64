// The project views Colleague can open, each the dashboard page of that name.
// navigation.open offers exactly these on the server and every host's browser
// navigator accepts them. A composed host adds its own views to both: on the
// server through the vibe64.colleague.navigation-panes capability, in the
// browser through useVibe64ColleagueNavigation({ panes }).
const VIBE64_COLLEAGUE_PANES = Object.freeze(["preview", "settings", "env", "integrations", "access", "publish", "history",
  "health", "session", "changes", "repository", "files", "database", "system", "ai-terminal", "issues", "pull-requests"]);
// The views of one development session, which need its exact sessionId.
const VIBE64_COLLEAGUE_SESSION_PANES = Object.freeze(["session", "changes", "repository", "files", "database", "system", "ai-terminal"]);

export { VIBE64_COLLEAGUE_PANES, VIBE64_COLLEAGUE_SESSION_PANES };
