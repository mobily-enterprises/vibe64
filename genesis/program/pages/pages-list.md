# Pages list

Project members find, keep and tidy a project's pages in one Dashboard list.

## Sources

- Main: `packages/vibe64-pages/src/server/pagesActions.js`
- `packages/vibe64-pages/src/server/registerRoutes.js`
- `packages/vibe64-pages/src/server/inputSchemas.js`
- `packages/vibe64-pages/src/client/Vibe64PagesList.vue`
- `packages/vibe64-pages/src/client/pagesRequests.js`
- `src/pages/app/project/[slug]/dashboard/pages/index.vue`
- `src/placement.js`

## Public contract

- The Dashboard's **Pages** section lists the project's pages under **Current**
  and **Archived**, newest update first. Each row shows the title, who made the
  page, when it was last updated and an empty Refreshes column, with Open and
  Archive, or Restore and Delete under Archived. Delete asks first and removes
  the page and every kept version for everyone. The member's starred pages
  come first under Current, each row starting with its star (see
  `stars.md`).
- Actions, each a project operation behind the project access check and never an
  AI tool: `vibe64.pages.list` (`GET /api/app/:slug/vibe64/pages`),
  `vibe64.pages.read` (`GET …/pages/:pageId`), `vibe64.pages.archive` and
  `vibe64.pages.restore` (`POST …/pages/:pageId/archive|restore`),
  `vibe64.pages.version.restore` (`POST …/pages/:pageId/versions/:version/restore`)
  and `vibe64.pages.delete` (`DELETE …/pages/:pageId`).
- Deleting a current page is refused; archive it first. A version that is no
  longer kept is refused with the versions that are. Bringing a version back
  adds a new version by the member who asked, with that version's content and
  title, so nothing is lost.
