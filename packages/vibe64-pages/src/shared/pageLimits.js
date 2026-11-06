// What one page version may hold. The agent command checks these before it
// sends a page, and the server checks them again before it stores one.
const PAGE_LIMITS = Object.freeze({
  maxFiles: 500,
  maxTotalBytes: 20 * 1024 * 1024,
  maxPathLength: 240,
  maxSegmentLength: 120,
  maxTitleLength: 120,
  versionsKept: 10
});

// The optional Vibe64 stylesheet, relative to a page's top folder. Its folder
// is Vibe64's: a page's own files cannot use it.
const PAGE_STYLESHEET_PATH = "_vibe64/page.css";

export { PAGE_LIMITS, PAGE_STYLESHEET_PATH };
