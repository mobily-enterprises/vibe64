import { NOT_A_TOOL, PROJECT_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import { currentActorUser } from "@local/vibe64-execution/server";

import { pageInput, pagesListInput, pageStarInput, pageVersionInput, pageViewInput } from "./inputSchemas.js";

/** @typedef {import("./types.js").PagesService} PagesService */

const PAGES_ACTIONS = Object.freeze({
  LIST: "vibe64.pages.list",
  READ: "vibe64.pages.read",
  VIEW_OPEN: "vibe64.pages.view.open",
  STARS_READ: "vibe64.pages.stars.read",
  STAR_SET: "vibe64.pages.star.set",
  ARCHIVE: "vibe64.pages.archive",
  RESTORE: "vibe64.pages.restore",
  VERSION_RESTORE: "vibe64.pages.version.restore",
  DELETE: "vibe64.pages.delete"
});

// Every page action is a project member's: the project access check admits it.
const PAGE_OPERATION = Object.freeze({ ...NOT_A_TOOL, vibe64: PROJECT_OPERATION });

/**
 * The project member acting: the signed-in Vibe64 user, else whoever runs Vibe64 here.
 * @param {object | null | undefined} vibe64User
 */
function memberAuthor(vibe64User) {
  const actor = vibe64User || currentActorUser();
  return {
    id: String(actor.username || actor.id || ""),
    name: String(actor.preferredName || actor.displayName || actor.name || actor.username || "")
  };
}

/**
 * @param {object} dependencies
 * @param {PagesService} dependencies.pages
 */
function createPagesActions({ pages }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: PAGES_ACTIONS.LIST,
      input: pagesListInput,
      extensions: PAGE_OPERATION,
      execute: () => pages.listPages()
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PAGES_ACTIONS.READ,
      input: pageInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.readPage(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.VIEW_OPEN,
      input: pageViewInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.openPageView(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: PAGES_ACTIONS.STARS_READ,
      input: pagesListInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.starredPages(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.STAR_SET,
      input: pageStarInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.setPageStar(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.ARCHIVE,
      input: pageInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.archivePage(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.RESTORE,
      input: pageInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.restorePage(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.VERSION_RESTORE,
      input: pageVersionInput,
      extensions: PAGE_OPERATION,
      execute: ({ pageId, version, vibe64User }) => pages.restorePageVersion({ pageId, version, by: memberAuthor(vibe64User) })
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: PAGES_ACTIONS.DELETE,
      input: pageInput,
      extensions: PAGE_OPERATION,
      execute: (input) => pages.deletePage(input)
    })
  ]);
}

export { createPagesActions, PAGES_ACTIONS };
