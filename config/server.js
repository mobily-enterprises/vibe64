export const config = {
  securityHeaders: {
    // The editor's own hook (@local/vibe64-core/server/editorFraming) is the one writer of its framing headers: it
    // merges frame-ancestors into a route's own policy, adds X-Frame-Options and leaves the Pages viewer framed.
    frameAncestors: false,
    // No endpoint receives its reports, so a report-only policy would only log console messages on every load, for
    // the page's inline start-up scripts and every Preview frame among others.
    contentSecurityPolicy: { mode: "off" },
    // A year of HTTPS for the editor's own host name only: no includeSubDomains, as each Preview is a name below it,
    // and no preload.
    strictTransportSecurity: "max-age=31536000"
  }
};
