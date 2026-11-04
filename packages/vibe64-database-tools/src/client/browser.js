// What the database tools read from the browser, each probe written once.

/**
 * Whether a page element has the named function. Optional browser APIs are missing from some browsers' elements,
 * such as requestFullscreen on iPhone Safari.
 * @param {Element} element
 * @param {string} name
 */
function hasElementFunction(element, name) {
  // readable-check: allow method-probe - platform object: optional element APIs, such as the Fullscreen API, exist only in browsers that offer them
  return typeof element[name] === "function";
}

export { hasElementFunction };
