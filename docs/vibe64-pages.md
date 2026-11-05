# Vibe64 pages

Pages are HTML pages an AI makes that everyone with access to a project can open: reports,
comparisons, dashboards, diagrams, status overviews. They work the same for Claude, Codex and
OpenCode. Vibe64 owns the whole feature; a host that composes Vibe64 only supplies who belongs to a
project, through its existing project access composition.

## 1. Owner: the project, not the session

- A page belongs to the project. It records who made it and in which session, and links back to
  that session. Archiving or renewing a session leaves its pages alone.
- Pages live in Vibe64's own project state, `<project state>/pages/<page id>/`, never in the Git
  repository. Otherwise every refresh would mean commits, Saves and rebases.
- The last 10 versions are kept, so a bad refresh can be rolled back.

## 2. Formats: freedom plus two light conventions

- The AI writes any HTML, as one file or a folder with `index.html` at its top.
- Vibe64 offers an optional stylesheet with its colours, fonts and light and dark modes. A page
  that links `_vibe64/page.css` looks native without effort.
- A page that refreshes keeps its layout in `index.html` and its numbers in `data.json`. A refresh
  rewrites only the data, so it cannot break the layout and costs far less.

## 3. A Pages list per project

- The Dashboard's **Pages** list has **Current** and **Archived** tabs. Each row shows the title,
  who made the page, when it was last updated, and its refresh schedule and state.
- A row offers open, archive and restore. Delete is offered only under Archived.
- Archiving a page stops its refreshes.

## 4. Scheduled refreshes, owned by Vibe64's server

- Engine timers cannot do this job: they end with the session that made them, or do not exist.
- The schedule is every N minutes or hours, or daily at a set time; never more often than every
  15 minutes.
- Each refresh is a separate, short run, never a message in anyone's chat. It is either a
  **command** (a small script the AI wrote regenerates `data.json`, with no AI cost) or a
  **prompt** (an AI run, for refreshes that need judgement).
- A refresh runs as the person who set the schedule, with their AI account and project access. If
  they lose either, the schedule pauses and the page says why.
- Refreshes never pile up: a turn whose previous refresh still runs is skipped, and ticks missed
  while Vibe64 was stopped collapse into one catch-up.
- A failed refresh keeps the last good version and shows when it failed, with its log; after 3
  failures in a row the schedule pauses itself. A running refresh can always be cancelled, and
  nothing runs between refreshes. A refresh reads the project's latest saved version and writes
  only its own page.

## 5. Reaching pages from the chat

- The AI publishes a page with one shell command every engine can run,
  `vibe64-helper pages publish`. It prints the page's link. The same command lists and updates
  pages, so "update the test dashboard" works.
- The AI offers pages when they help; see the agent guidance.
- In the chat, Vibe64 shows any page link as a card with the title, the last update and an Open
  button. A link that people paste gets the same card.
- Open shows the page in the panel beside the chat, like Preview, with **Open in new tab** for
  full screen.
- A Pages button in the chat header lists the project's pages, this session's first.

## Sandbox

Page content is untrusted. A page cannot see Vibe64, the viewer's sign-in or other projects and
pages, and it cannot send anything anywhere. It loads only its own files, so libraries are copied
into the page folder; that also makes pages work offline and on local Vibe64, which serves
everything from one origin.

- A project member's request to view a page passes the ordinary project access check and gets a
  short-lived link that names only that page.
- The page runs in sandboxed frames without same-origin access, so it has no cookies and cannot
  reach the Vibe64 window. Its files are served with a Content-Security-Policy that admits only
  that link's own files, and the frame around it may only navigate inside them.
- **Who sees a page:** everyone with access to the project. Locally, that is the one user.

## Delivery

1. This design.
2. A pilot as a new package: the publish command, storage, the Pages list, the chat card and the
   sandboxed viewer.
3. Scheduled refreshes.
4. The chat-header Pages button.
