// What the chat cards know about each linked page. Every card of one page
// shows the same answer, and a new card reads the page again, so a page the AI
// has just updated shows its new title and time on the older cards too. Cards
// of one page that ask while its read is still on the way share that read.
import { reactive } from "vue";
import { readPage } from "./pagesRequests.js";

// readable-check: allow module-state - shared resource: every chat card of one page shows its one latest answer
const pageLinkAnswers = reactive({});
// readable-check: allow module-state - shared resource: the one read of each page on the way, for every card asking
const pageLinkReads = new Map();

/** @param {{ path: string, projectSlug: string, pageId: string }} link */
function readPageLink(link) {
  const pending = pageLinkReads.get(link.path);
  if (pending) return pending;
  pageLinkAnswers[link.path] ||= { loading: true };
  const read = readPage(link.projectSlug, link.pageId).then(
    (answer) => { pageLinkAnswers[link.path] = { page: answer.page }; },
    (cause) => {
      const missing = cause?.status === 404 || cause?.code === "vibe64_pages_not_found";
      pageLinkAnswers[link.path] = { error: missing ? "This page no longer exists." : cause?.message || "This page could not load." };
    }
  ).finally(() => { pageLinkReads.delete(link.path); });
  pageLinkReads.set(link.path, read);
  return read;
}

export { pageLinkAnswers, readPageLink };
