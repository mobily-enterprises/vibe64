// What the app's client code reads from the browser, each probe written once. Outside a browser, as in a test,
// there is no window.

/**
 * Whether the page's window has the named function. Outside a browser there is no window, and some functions
 * (matchMedia, requestAnimationFrame, IntersectionObserver) only some hosts have.
 * @param {string} name
 */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window and its functions exist only in a browser, and not every browser has each one
  return typeof window !== "undefined" && typeof window[name] === "function";
}

/** The tab's session storage; null outside a browser or where the browser refuses storage. */
function browserSessionStorage() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return null;
  }
  return window.sessionStorage;
}

/**
 * A random UUID from the browser; empty where the page has none (crypto.randomUUID needs https or localhost).
 * @param {{ crypto?: Crypto }} [root] the page's global object
 */
function pageRandomUUID(root = globalThis) {
  // readable-check: allow method-probe - platform object: browsers offer crypto.randomUUID only on secure (https or localhost) pages
  return typeof root.crypto?.randomUUID === "function" ? root.crypto.randomUUID() : "";
}

/** Reloads the page, after a change only a fresh page shows; outside a browser there is no page to reload. */
function reloadPage() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

/**
 * Writes text to the page's clipboard. Outside a browser there is no clipboard (false); a page without the clipboard
 * API, which browsers offer only on https or localhost pages, writes nothing (undefined).
 * @param {string} text
 */
function writePageClipboardText(text) {
  if (typeof navigator === "undefined") {
    return false;
  }
  // readable-check: allow method-probe - platform object: browsers offer navigator.clipboard only on secure (https or localhost) pages
  return typeof navigator.clipboard?.writeText === "function" ? navigator.clipboard.writeText(text) : undefined;
}

/**
 * Calls sync(matches) now and whenever the media query's answer changes; returns the function that stops following
 * it. Outside a browser, or where the page has no matchMedia, nothing is followed.
 * @param {string} query
 * @param {(matches: boolean) => void} sync
 * @returns {() => void}
 */
function followMediaQuery(query, sync) {
  if (!hasWindowFunction("matchMedia")) return () => {};
  const media = window.matchMedia(query);
  const listener = () => sync(Boolean(media.matches));
  listener();
  // readable-check: allow method-probe - platform object: Safari before 14 reports a media query's changes only through addListener
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }
  media.addListener(listener);
  return () => media.removeListener(listener);
}

export {
  browserSessionStorage,
  followMediaQuery,
  hasWindowFunction,
  pageRandomUUID,
  reloadPage,
  writePageClipboardText
};
