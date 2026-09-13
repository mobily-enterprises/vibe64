// The host supplies the assigned application origin. Never derive it from the
// editor location, project slug, preview port or a custom-domain preference.
export function integrationCallbackUrl(applicationPublicUrl, callbackPath) {
  try {
    const origin = new URL(applicationPublicUrl);
    const local = origin.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if ((origin.protocol !== "https:" && !local) || origin.username || origin.password ||
        origin.search || origin.hash || origin.pathname !== "/" ||
        typeof callbackPath !== "string" || !/^\/[A-Za-z0-9/_-]+$/u.test(callbackPath) || callbackPath.startsWith("//")) return "";
    return new URL(callbackPath, origin).href;
  } catch { return ""; }
}
