// The public origin a Preview is served at, from the Studio host and the workspace's public domain.

import { stableHash } from "@local/vibe64-execution/server";
import { isLoopbackAddress, normalizeHostName } from "@local/vibe64-core/server/localStudioRequest";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import { normalizePreviewEditorOrigin } from "./launchPreviewProxy.js";

const PREVIEW_PUBLIC_HOST_PREFIX = "v64preview";
const VIBE64_WORKSPACE_ENV = "VIBE64_WORKSPACE";

const DEFAULT_PUBLIC_PROTOCOL = "https";

/**
 * The editor that asked for the Preview is the page that frames it. The
 * browser names its own origin; routing headers can be rewritten on the way
 * (a dev container's Host, for one), so they are only the fallback for callers
 * that send none. A configured public protocol wins for public hosts there, as
 * it does for the Preview's own origin.
 */
function previewEditorOrigin({
  editorOrigin = "",
  env = process.env,
  publicHost = "",
  publicProtocol = ""
} = {}) {
  const browserOrigin = normalizePreviewEditorOrigin(editorOrigin);
  if (browserOrigin) {
    return browserOrigin;
  }
  const host = String(publicHost || "").trim();
  const configuredProtocol = isLoopbackAddress(normalizeHostName(host))
    ? ""
    : env?.[VIBE64_PUBLIC_PROTOCOL_ENV];
  const protocol = String(configuredProtocol || publicProtocol || "").trim().toLowerCase().replace(/:$/u, "");
  if (!host || /[\s/\\@?#]/u.test(host) || !["http", "https"].includes(protocol)) {
    return "";
  }
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return "";
  }
}

function previewPublicOriginForLaunch({
  env = process.env,
  previewPublicDomain = "",
  publicHost = "",
  publicProtocol = "",
  publicUserDomain = "",
  sessionId = ""
} = {}) {
  const hostname = normalizeHostName(String(publicHost || "").trim());
  if (hostname && isLoopbackAddress(hostname)) {
    return "";
  }
  const configuredUserDomain = normalizePublicHostDomain(publicUserDomain || env?.[VIBE64_PUBLIC_USER_DOMAIN_ENV] || "");
  const configuredWorkspace = String(env?.[VIBE64_WORKSPACE_ENV] || "").trim().toLowerCase();
  const studioHostMatch = hostname
    ? studioHostMatchForPreview(hostname, {
        publicUserDomain: configuredUserDomain
      })
    : configuredUserDomain && validPreviewWorkspace(configuredWorkspace)
      ? {
          baseDomain: configuredUserDomain,
          workspace: configuredWorkspace
        }
      : null;
  if (!studioHostMatch) {
    return "";
  }
  const workspace = studioHostMatch.workspace;
  const protocol = normalizePublicProtocol(
    env?.[VIBE64_PUBLIC_PROTOCOL_ENV] ||
      publicProtocol ||
      DEFAULT_PUBLIC_PROTOCOL
  );
  const configuredPreviewDomain = String(
    previewPublicDomain || env?.[VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV] || ""
  ).trim();
  let baseDomain = normalizePublicDomain(
    configuredPreviewDomain || studioHostMatch.baseDomain
  );
  if (!configuredPreviewDomain) {
    const requestPort = publicDomainPort(
      normalizePublicDomain(publicHost || configuredUserDomain),
      protocol
    );
    if (requestPort) {
      baseDomain = `${baseDomain}:${requestPort}`;
    }
  }
  if (!baseDomain) {
    return "";
  }
  const hashInput = [
    currentProjectScopeKey(),
    sessionId
  ];
  // Independently hosted editors may share a preview domain and cloned project
  // identities. Their host-supplied namespace keeps those routes independent.
  const namespace = String(env?.[VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV] || "").trim();
  if (namespace) hashInput.push(`namespace:${namespace}`);
  const publicPort = publicDomainPort(baseDomain, protocol);
  if (publicPort) {
    hashInput.push(`public-port:${publicPort}`);
  }
  const hash = stableHash(hashInput.join("\n")).replace(/[^a-z0-9]/giu, "").toLowerCase().slice(0, 12);
  if (!hash) {
    return "";
  }
  // The Preview nests under its editor's workspace name, keeping the editor
  // and its Preview iframe one site even when the domain is a public suffix.
  return `${protocol}://${PREVIEW_PUBLIC_HOST_PREFIX}-${hash}.${workspace}.${baseDomain}`;
}

function studioHostMatchForPreview(hostname = "", {
  publicUserDomain = ""
} = {}) {
  const normalizedHostname = normalizePublicHostDomain(hostname);
  const normalizedUserDomain = normalizePublicHostDomain(publicUserDomain);
  if (normalizedUserDomain) {
    const suffix = `.${normalizedUserDomain}`;
    if (!normalizedHostname.endsWith(suffix)) {
      return null;
    }
    const workspace = normalizedHostname.slice(0, -suffix.length);
    return validPreviewWorkspace(workspace)
      ? {
          baseDomain: normalizedUserDomain,
          workspace
        }
      : null;
  }
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.([a-z0-9][a-z0-9.-]*[a-z0-9])$/u.exec(normalizedHostname);
  return match
    ? {
        baseDomain: match[2],
        workspace: match[1]
      }
    : null;
}

function validPreviewWorkspace(value = "") {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(String(value || "").trim());
}

function normalizePublicProtocol(value = "") {
  return String(value || "").trim().toLowerCase().replace(/:$/u, "") === "http"
    ? "http"
    : "https";
}

function normalizePublicDomain(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  try {
    return new URL(text.includes("://") ? text : `http://${text}`).host.replace(/\.+$/u, "");
  } catch {
    return text.replace(/^\/*/u, "").replace(/\/*$/u, "").replace(/\.+$/u, "");
  }
}

function publicDomainPort(domain = "", protocol = "https") {
  try {
    return new URL(`${protocol}://${domain}`).port;
  } catch {
    return "";
  }
}

function normalizePublicHostDomain(value = "") {
  const domain = normalizePublicDomain(value);
  if (!domain || domain.startsWith("[")) {
    return "";
  }
  return domain.replace(/:\d+$/u, "");
}

export {
  previewEditorOrigin,
  previewPublicOriginForLaunch
};
