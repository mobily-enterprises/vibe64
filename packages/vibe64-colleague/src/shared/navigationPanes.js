// The project views Colleague can open, each the dashboard page of that name.
// navigation.open offers exactly these on the server and every host's browser
// navigator accepts them. A composed host adds its own views to both: on the
// server through the vibe64.colleague.navigation-panes capability, in the
// browser through useVibe64ColleagueNavigation({ panes }).
const VIBE64_COLLEAGUE_PANES = Object.freeze(["preview", "settings", "env", "integrations", "access", "publish", "history",
  "project-files", "health", "session", "changes", "repository", "files", "database", "system", "ai-terminal", "issues", "pull-requests"]);
// The views of one development session, which need its exact sessionId.
const VIBE64_COLLEAGUE_SESSION_PANES = Object.freeze(["session", "changes", "repository", "files", "database", "system", "ai-terminal"]);

// The optional capability through which a composed host adds its own project views, and the named default a
// composition without it uses: no host views.
const COLLEAGUE_NAVIGATION_PANES_TOKEN = "vibe64.colleague.navigation-panes";
const NO_HOST_PANES = Object.freeze([]);

/** @typedef {{ pane: string, meaning: string }} ColleagueNavigationPane A composed host's view and what it shows. */

export {
  COLLEAGUE_NAVIGATION_PANES_TOKEN,
  NO_HOST_PANES,
  VIBE64_COLLEAGUE_PANES,
  VIBE64_COLLEAGUE_SESSION_PANES
};
