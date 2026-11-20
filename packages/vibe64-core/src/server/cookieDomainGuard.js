// A cookie an app sets stays on the host that answered. A Domain attribute naming a domain above that host (a host's
// own Preview or app domain, or the workspace's name below it) would share the cookie with every other name below
// that domain, other people's apps and Previews among them, so the proxies in front of apps take such an attribute
// off. The cookie then stays on the host alone, as one set without Domain does.

/**
 * A host as a cookie compares it: lowercase, without a port or a trailing dot.
 * @param {string} host
 */
function normalizeCookieHost(host = "") {
  const text = String(host || "").trim().toLowerCase();
  if (text.startsWith("[")) {
    return text.slice(0, text.indexOf("]") + 1);
  }
  return text.replace(/:\d+$/u, "").replace(/\.+$/u, "");
}

/**
 * The domain a `Domain=` attribute names, as the browser reads it (no leading dot), or null for another attribute.
 * @param {string} part one `;`-separated part of a Set-Cookie header
 */
function cookieDomainAttribute(part = "") {
  const separatorIndex = part.indexOf("=");
  const name = (separatorIndex < 0 ? part : part.slice(0, separatorIndex)).trim().toLowerCase();
  if (name !== "domain") {
    return null;
  }
  return separatorIndex < 0
    ? ""
    : part.slice(separatorIndex + 1).trim().toLowerCase().replace(/^\.+/u, "").replace(/\.+$/u, "");
}

/**
 * Whether a cookie for `domain` reaches more than `host`: `domain` is a domain above it.
 * @param {string} domain
 * @param {string} host
 */
function domainWidensBeyondHost(domain = "", host = "") {
  return Boolean(domain) && domain !== host && host.endsWith(`.${domain}`);
}

/**
 * One Set-Cookie header without the Domain attributes that would share its cookie beyond `host`. A Domain naming the
 * host itself stays, as does one naming an unrelated domain, which the browser refuses anyway. A header with nothing
 * to take off comes back unchanged.
 * @param {string} header one Set-Cookie header
 * @param {string} host the host the response answered for
 * @returns {{ header: string, name: string, widenedDomains: string[] }} the header, its cookie's name and the domains
 *   taken off
 */
function withoutWideningCookieDomain(header = "", host = "") {
  const text = String(header || "");
  const hostname = normalizeCookieHost(host);
  const [pair = "", ...attributes] = text.split(";");
  const separatorIndex = pair.indexOf("=");
  const name = (separatorIndex < 0 ? pair : pair.slice(0, separatorIndex)).trim();
  const widenedDomains = [];
  const kept = attributes.filter((part) => {
    const domain = cookieDomainAttribute(part);
    if (domain === null || !hostname || !domainWidensBeyondHost(domain, hostname)) {
      return true;
    }
    widenedDomains.push(domain);
    return false;
  });
  return {
    header: widenedDomains.length > 0 ? [pair, ...kept].join(";") : text,
    name,
    widenedDomains
  };
}

export {
  normalizeCookieHost,
  withoutWideningCookieDomain
};
