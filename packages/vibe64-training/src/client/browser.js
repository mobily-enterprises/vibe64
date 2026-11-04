// What the training client reads from the browser, each probe written once. Outside a browser, as in a test, only
// what the host defines exists.

/**
 * Whether the page has the named window function. Outside a browser there is no window, and some functions
 * (matchMedia, requestAnimationFrame) only some hosts have.
 * @param {string} name
 */
function hasWindowFunction(name) {
  // readable-check: allow method-probe - platform object: window functions exist only in a browser, and not every browser has each one
  return typeof globalThis[name] === "function";
}

/**
 * Whether a page element has the named method; newer ones (checkVisibility) exist only in some browsers.
 * @param {Element} element
 * @param {string} name
 */
function hasElementMethod(element, name) {
  // readable-check: allow method-probe - platform object: an element's newer methods, such as checkVisibility, exist only in some browsers
  return typeof element[name] === "function";
}

export {
  hasElementMethod,
  hasWindowFunction
};
