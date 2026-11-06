// Each person's starred pages in a project, kept with its pages as personal
// stars, so they show in every session of the project:
//   <project state>/pages/.stars/<hash of the person>.json   { "pageIds": [...] }
import path from "node:path";
import {
  changePersonalStar,
  forgetPersonalStar,
  personalStarsFile,
  readPersonalStars
} from "@local/vibe64-core/server/personalStars";
import { vibe64Error } from "@local/vibe64-core/server/core";

const MAX_STARRED_PAGES = 100;
const STARRED_PAGES = Object.freeze({
  field: "pageIds",
  limit: MAX_STARRED_PAGES,
  overLimit: () => vibe64Error(`You can star up to ${MAX_STARRED_PAGES} pages per project.`, "vibe64_pages_star_limit", {
    status: 400,
    params: { limit: MAX_STARRED_PAGES }
  })
});

const starsFolder = (pagesRoot) => path.join(pagesRoot, ".stars");

/**
 * The ids of the pages this person starred, in the order they starred them.
 * @param {string} pagesRoot
 * @param {object | null | undefined} user
 */
function readPageStars(pagesRoot, user) {
  return readPersonalStars(personalStarsFile(starsFolder(pagesRoot), user), STARRED_PAGES);
}

/**
 * @param {string} pagesRoot
 * @param {object | null | undefined} user
 * @param {string} pageId
 * @param {boolean} starred
 */
function changePageStar(pagesRoot, user, pageId, starred) {
  return changePersonalStar(personalStarsFile(starsFolder(pagesRoot), user), STARRED_PAGES, pageId, starred);
}

/**
 * A deleted page's stars go with it, for everyone.
 * @param {string} pagesRoot
 * @param {string} pageId
 */
function forgetPageStars(pagesRoot, pageId) {
  return forgetPersonalStar(starsFolder(pagesRoot), STARRED_PAGES, pageId);
}

export { changePageStar, forgetPageStars, readPageStars };
