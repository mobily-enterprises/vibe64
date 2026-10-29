// A browser page watches each project it has open, in a visible or a
// background tab, and each session it shows, over its realtime connection.
// Watching a project delivers summaries of its sessions' changes and keeps the
// server probing it for repository updates; watching a session delivers that
// session's changes in full.
export const PROJECT_WATCH = "vibe64.sessions.project.watch";
export const PROJECT_WATCH_RELEASE = "vibe64.sessions.project.release";
