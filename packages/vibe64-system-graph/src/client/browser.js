// What this package's client code reads from the browser, each probe written once. Outside a browser, as in a
// test, there is no window.

/**
 * Whether the page's window has the named function. Outside a browser there is no window, and some functions
 * (ResizeObserver) only some hosts have.
 * @param {string} name
 */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window and its functions exist only in a browser, and not every browser has each one
  return typeof window !== "undefined" && typeof window[name] === "function";
}

export { hasWindowFunction };
