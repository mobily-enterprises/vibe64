# Starred pages

A project member stars the pages they come back to and opens one from the
chat's Starred menu at once.

## Sources

- Main: `packages/vibe64-pages/src/server/pageStars.js`
- `packages/vibe64-core/src/server/personalStars.js`
- `packages/vibe64-pages/src/server/service.js`
- `packages/vibe64-pages/src/server/pagesActions.js`
- `packages/vibe64-pages/src/client/pageStars.js`
- `packages/vibe64-pages/src/client/Vibe64PageStarButton.vue`
- `packages/vibe64-pages/src/client/Vibe64StarredPagesList.vue`
- `src/components/studio/vibe64-session/Vibe64StarredMenu.vue`

## Public contract

- Stars are personal and per project, never per session: each member's starred
  page ids, in the order they were starred, are kept with the project's pages
  in `<project state>/pages/.stars/<sha256 of the member>.json`
  (`{ "pageIds": [...] }`, mode 0600, at most 100), through the same personal
  star store as starred files (`personalStars.js`: serialized atomic changes per
  member, the signed-in account's identity, else this computer's own).
- `vibe64.pages.stars.read` (`GET /api/app/:slug/vibe64/pages/stars`) answers
  the member's starred pages that are current, in star order; an archived page
  is left out and comes back when restored, and a missing one is skipped.
  `vibe64.pages.star.set` (`POST …/pages/:pageId/star`, `{ starred }`) stars or
  unstars a page and answers the same list; starring needs an existing page, and
  a 101st star is refused with `vibe64_pages_star_limit`. Both are project
  operations behind the project access check and never AI tools. Deleting a page
  removes it from every member's stars.
- The client keeps one starred list per project, shared by every star: the
  chat card's, the viewer's (current pages only) and each Current row of the
  Pages list, where starred pages come first. A star shows its change at once
  and rereads the saved list if saving fails.
- The chat's **Starred** menu (a popover, or a bottom sheet on a phone) lists
  starred pages above starred files with one search over both; Enter opens the
  first match. The starred list loads when the chat does. As the menu opens it
  asks for the viewing links of the first three pages shown, and of any row
  pointed at or focused, in the viewer's theme, and loads the page route's
  code. One click opens the page beside the chat, in front of it on a phone:
  the viewer takes that link and shows the title and frame in its first
  render. A link asked for ahead is kept in the browser for two minutes at
  most, never within a minute of its own end, is handed to one viewer only,
  and grants nothing more than any viewing link.
