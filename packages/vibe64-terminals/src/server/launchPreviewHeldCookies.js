// The app cookies a Preview holds for one held session, in place of its browser pages.
//
// A Preview on a domain of its own is a cross-site frame of the editor, so the browser keeps the pane's cookies
// apart from those of a window at the Preview's own address: an app signed in to in the pane's sign-in window would
// stay signed out in the pane. The Preview proxy therefore keeps the app's HttpOnly cookies itself, one set per held
// session (launchPreviewAccess.js: the pane, and each window it opened), and sends them with each request of that
// session. Only HttpOnly cookies are held: a page's script never reads or writes those, so holding them changes
// nothing it can see, while a cookie its script reads stays in the browser. They live in this process's memory only,
// for as long as the Preview runs.

// Cookies one held session keeps at most, the oldest giving way, as a browser's do for a host; and the longest
// name and value kept, as a browser's limit.
const HELD_COOKIES_MAX = 64;
const HELD_COOKIE_BYTES_MAX = 4096;

/**
 * One Set-Cookie header read as RFC 6265 reads it: the pair, then its attributes by lower-case name ("" for a flag).
 * @param {string} header
 */
function parseSetCookie(header = "") {
  const [pair = "", ...parts] = String(header || "").split(";");
  const separator = pair.indexOf("=");
  const name = separator < 0 ? "" : pair.slice(0, separator).trim();
  if (!name) {
    return null;
  }
  const attributes = new Map();
  for (const part of parts) {
    const index = part.indexOf("=");
    const key = (index < 0 ? part : part.slice(0, index)).trim().toLowerCase();
    if (key) {
      attributes.set(key, index < 0 ? "" : part.slice(index + 1).trim());
    }
  }
  return { attributes, name, value: pair.slice(separator + 1).trim() };
}

/** The path a cookie without its own Path gets: the request path up to its last "/". */
function defaultCookiePath(requestPath = "/") {
  const path = String(requestPath || "");
  const last = path.lastIndexOf("/");
  return path.startsWith("/") && last > 0 ? path.slice(0, last) : "/";
}

function cookiePathMatches(requestPath, cookiePath) {
  return requestPath === cookiePath || (
    requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/")
  );
}

/** When a cookie ends, in ms since the epoch: Max-Age wins over Expires; neither keeps it for the Preview's life. */
function cookieExpiresAt(attributes, nowMs) {
  if (attributes.has("max-age")) {
    const seconds = Number(attributes.get("max-age"));
    return Number.isFinite(seconds) ? nowMs + seconds * 1000 : Infinity;
  }
  if (attributes.has("expires")) {
    const at = Date.parse(attributes.get("expires"));
    return Number.isFinite(at) ? at : Infinity;
  }
  return Infinity;
}

/**
 * One held session's cookies.
 */
function createHeldCookieJar() {
  const cookies = new Map();

  /**
   * Keeps an HttpOnly cookie the app set and says it did, so the browser does not get it. One the app ends goes
   * from here and still reaches the browser, which may keep an older copy of it; any other cookie is the
   * browser's too.
   * @param {string} header a Set-Cookie header, already kept to the Preview's own host
   * @param {string} requestPath the path of the request the app answered
   */
  function hold(header, requestPath, nowMs = Date.now()) {
    const cookie = parseSetCookie(header);
    if (!cookie || !cookie.attributes.has("httponly")) {
      return false;
    }
    const rawPath = cookie.attributes.get("path") || "";
    const path = rawPath.startsWith("/") ? rawPath : defaultCookiePath(requestPath);
    const key = `${cookie.name}\n${path}`;
    const expiresAt = cookieExpiresAt(cookie.attributes, nowMs);
    cookies.delete(key);
    if (expiresAt <= nowMs) {
      return false;
    }
    if (Buffer.byteLength(cookie.name + cookie.value) > HELD_COOKIE_BYTES_MAX) {
      return true;
    }
    cookies.set(key, {
      expiresAt,
      name: cookie.name,
      path,
      sameSite: String(cookie.attributes.get("samesite") || "lax").toLowerCase(),
      value: cookie.value
    });
    if (cookies.size > HELD_COOKIES_MAX) {
      cookies.delete(cookies.keys().next().value);
    }
    return true;
  }

  /**
   * The held cookies a request gets, longest path first as a browser orders them. A request another site's page
   * started gets only SameSite=None ones, unless it is a page load (a GET navigation, which the editor's pane is):
   * a form another site posts, or a fetch it makes, does not carry the app's session.
   * @param {string} requestPath
   * @param {{ crossSite?: boolean, navigation?: boolean }} context
   */
  function cookieHeaderPairs(requestPath, { crossSite = false, navigation = false } = {}, nowMs = Date.now()) {
    const sent = [];
    for (const [key, cookie] of cookies) {
      if (cookie.expiresAt <= nowMs) {
        cookies.delete(key);
      } else if (
        cookiePathMatches(requestPath, cookie.path) &&
        (!crossSite || navigation || cookie.sameSite === "none")
      ) {
        sent.push(cookie);
      }
    }
    return sent
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => ({ name: cookie.name, pair: `${cookie.name}=${cookie.value}` }));
  }

  /** Whether any cookie of this name is held, so a browser's own copy of it, an older one, is not sent too. */
  function holds(name) {
    for (const cookie of cookies.values()) {
      if (cookie.name === name) {
        return true;
      }
    }
    return false;
  }

  return Object.freeze({
    cookieHeaderPairs,
    hold,
    holds
  });
}

export {
  createHeldCookieJar,
  HELD_COOKIES_MAX
};
