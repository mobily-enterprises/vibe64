# Viewing pages

A page opens beside the chat, in a new tab, or from a card in the chat, and it
always runs sandboxed: page content is untrusted.

## Sources

- Main: `packages/vibe64-pages/src/server/pageSandbox.js`
- `packages/vibe64-pages/src/server/pageViewLinks.js`
- `packages/vibe64-pages/src/server/pageStylesheet.js`
- `packages/vibe64-pages/src/server/registerRoutes.js`
- `packages/vibe64-pages/src/client/Vibe64PageViewer.vue`
- `packages/vibe64-pages/src/client/Vibe64PageLinkCards.vue`
- `src/pages/app/project/[slug]/dashboard/pages/[pageId].vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue`
- `src/components/studio/Vibe64DashboardShell.vue`

## Public contract

- `vibe64.pages.view.open` (`POST /api/app/:slug/vibe64/pages/:pageId/view`,
  `{ theme }`) passes the project access check and returns a viewing link,
  `/api/vibe64/pages/view/<token>`. A link names one page; it lapses after 15
  minutes without a request and after 4 hours in any case, ends when its page is
  deleted or the server restarts, and always shows the current version.
- The link's frame host (`GET /api/vibe64/pages/view/:token`) holds no script
  and one sandboxed frame of `GET /api/vibe64/pages/files/:token/*`. Both are
  served with a Content-Security-Policy `sandbox allow-scripts allow-forms
  allow-modals` (an opaque origin: no cookies, no reach into the Vibe64 window),
  `no-store`, `no-referrer` and `nosniff`. The files' policy admits scripts,
  styles, images, fonts, media, connections and frames only from that link's own
  files, no workers, objects, form submissions or base changes, and the frame
  host lets its frame show only those files. A page therefore cannot read
  Vibe64's cookies, call Vibe64's API as the viewer, reach another page or
  project, or send anything to another address. Missing files, other paths,
  links and ended links answer 404 in plain text.
- `_vibe64/page.css` is Vibe64's optional stylesheet: its colours as `--v64-*`
  custom properties, its font (`_vibe64/roboto.woff2`), the viewer's light or
  dark theme (the device setting in a tab without one), plain element styles and
  `v64-card`, `v64-grid`, `v64-stat`, `v64-badge` and `v64-muted` classes.
- Open shows the viewer in the Dashboard panel beside the chat, with the
  Dashboard menu hidden, the page's version and last update, Reload, Versions
  (bring back a kept version), Archive or Restore, and Open in new tab, which
  gets its own viewing link and leaves the new tab no way back to Vibe64.
- Every page link in a main or temporary chat message, the AI's or a pasted
  one (a path or a full address on this Vibe64), shows as a card with the
  page's title and last update, and Open shows it beside the chat. A deleted
  page's card says so.
