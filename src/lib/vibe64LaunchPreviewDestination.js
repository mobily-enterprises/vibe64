// Where a launched output's Preview can be shown: the address the browser
// opens and the address the editor embeds, given the editor's own address.

function localPreviewBrowserHref() {
  if (typeof window === "undefined") {
    return "";
  }
  return String(window.location?.href || "");
}

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function resolveLaunchPreviewDestination(actions = [], {
  requirePreviewProxy = false,
  studioHref = localPreviewBrowserHref()
} = {}) {
  const action = Array.isArray(actions)
    ? actions.find((candidate) => browserCanOpenTarget(candidate)) || null
    : null;
  const targetHref = String(action?.href || "").trim();
  const previewHref = String(action?.previewHref || "").trim();
  const displayHref = previewHref && remoteStudioCannotEmbedLoopbackTarget(targetHref, studioHref)
    ? sameSiteLoopbackPreviewUrl(previewHref, studioHref)
    : sameSiteLoopbackPreviewUrl(targetHref, studioHref);
  const embedCandidate = previewHref || (requirePreviewProxy ? "" : targetHref);

  if (!embedCandidate) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: requirePreviewProxy && action
        ? "Waiting for the preview proxy URL."
        : ""
    };
  }
  if (remoteStudioCannotEmbedLoopbackTarget(embedCandidate, studioHref)) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: "This preview URL is only reachable from the server. Restart the preview to create a proxied preview URL."
    };
  }
  if (browserWouldBlockEmbeddedPreview(embedCandidate, studioHref)) {
    return {
      action,
      displayHref,
      embedHref: "",
      unavailableReason: "HTTP previews cannot be embedded from HTTPS Studio. Open the preview in a browser tab, or open Studio over HTTP for embedded preview."
    };
  }
  return {
    action,
    displayHref,
    embedHref: sameSiteLoopbackPreviewUrl(embedCandidate, studioHref),
    unavailableReason: ""
  };
}

function sameSiteLoopbackPreviewUrl(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return previewText;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    if (
      previewUrl.protocol !== studioUrl.protocol ||
      !isLoopbackBrowserHost(previewUrl.hostname) ||
      !isLoopbackBrowserHost(studioUrl.hostname) ||
      previewUrl.hostname === studioUrl.hostname
    ) {
      return previewText;
    }
    previewUrl.hostname = studioUrl.hostname;
    return previewUrl.toString();
  } catch {
    return previewText;
  }
}

function remoteStudioCannotEmbedLoopbackTarget(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return false;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    return isLoopbackBrowserHost(previewUrl.hostname) && !isLoopbackBrowserHost(studioUrl.hostname);
  } catch {
    return false;
  }
}

function browserWouldBlockEmbeddedPreview(previewHref = "", studioHref = "") {
  const previewText = String(previewHref || "").trim();
  const studioText = String(studioHref || "").trim();
  if (!previewText || !studioText) {
    return false;
  }
  try {
    const previewUrl = new URL(previewText);
    const studioUrl = new URL(studioText);
    return studioUrl.protocol === "https:" &&
      previewUrl.protocol === "http:" &&
      !isLoopbackBrowserHost(previewUrl.hostname);
  } catch {
    return false;
  }
}

function isLoopbackBrowserHost(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

export {
  browserCanOpenTarget,
  localPreviewBrowserHref,
  resolveLaunchPreviewDestination,
  sameSiteLoopbackPreviewUrl
};
