import { requestHeader } from "./launchPreviewHeaders.js";

// One terminal session's share of the session's Preview log: a target that keeps
// going away cannot grow it further.
const PREVIEW_FRAME_LOAD_RECORD_LIMIT = 20;
const PAGE_LOAD_DESTINATIONS = new Set(["document", "iframe"]);

function requestIsPageLoad(request) {
  return PAGE_LOAD_DESTINATIONS.has(requestHeader(request, "sec-fetch-dest").toLowerCase());
}

/**
 * What a Preview that showed no app leaves behind to be read later: when a page
 * load got the starting page, and when a real page was next served. A page load
 * is one the browser made for a document, so the starting page's own checks do
 * not count. Only the time and the status are kept: a path can hold a token.
 * @param {(record: { details?: { httpStatus: number }, reason: string, status: string }) => unknown} record
 */
function createPreviewFrameLoadRecorder(record) {
  let awaitingPage = true;
  let recorded = 0;
  let startingPageRecorded = false;

  function write(reason, details) {
    if (recorded >= PREVIEW_FRAME_LOAD_RECORD_LIMIT) {
      return;
    }
    recorded += 1;
    void record({ ...(details ? { details } : {}), reason, status: "frame-load" });
  }

  function startingPageServed(request) {
    if (startingPageRecorded || !requestIsPageLoad(request)) {
      return;
    }
    startingPageRecorded = true;
    awaitingPage = true;
    write("starting_page");
  }

  function pageServed(request, httpStatus) {
    if (!awaitingPage || !requestIsPageLoad(request)) {
      return;
    }
    awaitingPage = false;
    startingPageRecorded = false;
    write("first_page", { httpStatus });
  }

  return Object.freeze({
    pageServed,
    startingPageServed
  });
}

export {
  PREVIEW_FRAME_LOAD_RECORD_LIMIT,
  createPreviewFrameLoadRecorder
};
