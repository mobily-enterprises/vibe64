// What the accounts client reads from the browser, each probe written once. Outside a browser, as in a test, there is
// no window.

/**
 * Whether the page's window has the named function; outside a browser there is no window.
 * @param {string} name
 */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window and its functions exist only in a browser
  return typeof window !== "undefined" && typeof window[name] === "function";
}

/**
 * The page's clipboard when it can write text; null where the browser offers none.
 * @param {Window | null} browserWindow
 * @returns {Clipboard | null}
 */
function pageClipboard(browserWindow) {
  const clipboard = browserWindow?.navigator?.clipboard || globalThis.navigator?.clipboard || null;
  // readable-check: allow method-probe - platform object: browsers offer navigator.clipboard only on secure (https or localhost) pages
  return typeof clipboard?.writeText === "function" ? clipboard : null;
}

export {
  hasWindowFunction,
  pageClipboard
};
