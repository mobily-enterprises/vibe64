import path from "node:path";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  resolveVibe64ProviderHomesRoot
} from "@local/vibe64-core/server/studioRoots";

const APP_PROVIDER_SCOPE = "app";
const USER_PROVIDER_SCOPE = "user";

function resolveProviderHomesRoot({
  env = process.env,
  explicitRoot = "",
  projectsRoot = "",
  runtimeProfile = null,
  systemRoot = ""
} = {}) {
  return resolveVibe64ProviderHomesRoot({
    env,
    explicitRoot,
    projectsRoot,
    runtimeProfile,
    systemRoot
  });
}

function canonicalVibe64UserEmail(user = {}) {
  return String(user?.email || "").trim().toLowerCase();
}

function providerUserKey(user = {}) {
  const email = canonicalVibe64UserEmail(user);
  return email && !email.includes("/") && !email.includes("\\") ? email : "";
}

function providerHome(providerId = "", providerHomesRoot = "", user = {}) {
  return providerHomeForUserKey(providerId, providerHomesRoot, providerUserKey(user));
}

function providerHomeForUserKey(providerId = "", providerHomesRoot = "", userKey = "") {
  const safeUserKey = String(userKey || "").trim();
  const safeProviderId = String(providerId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return safeProviderId && safeUserKey ? path.join(providerHomesRoot, safeProviderId, safeUserKey) : "";
}

function githubProviderUserKey(user = {}) {
  return providerUserKey(user);
}

function githubProviderHome(providerHomesRoot, user = {}) {
  return providerHome("github", providerHomesRoot, user);
}

function githubProviderContext(input = {}, {
  allowLocalFallback = false,
  providerHomesRoot = ""
} = {}) {
  const user = input?.vibe64User || null;
  const email = canonicalVibe64UserEmail(user);
  const userKey = githubProviderUserKey(user);
  const toolHomeSource = githubProviderHome(providerHomesRoot, user);
  if (!email || !userKey || !toolHomeSource) {
    if (allowLocalFallback) {
      return {
        email: "",
        ok: true,
        providerScope: APP_PROVIDER_SCOPE,
        toolHomeSource: providerHomeForUserKey("github", providerHomesRoot, "local"),
        userKey: "local"
      };
    }
    return {
      code: "vibe64_user_required",
      error: "A GitHub provider home user key is required for GitHub operations.",
      errors: [
        {
          code: "vibe64_user_required",
          message: "A GitHub provider home user key is required for GitHub operations."
        }
      ],
      ok: false
    };
  }
  return {
    email,
    ok: true,
    providerScope: USER_PROVIDER_SCOPE,
    toolHomeSource,
    userKey
  };
}

export {
  APP_PROVIDER_SCOPE,
  USER_PROVIDER_SCOPE,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  canonicalVibe64UserEmail,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  providerHome,
  providerHomeForUserKey,
  providerUserKey,
  resolveProviderHomesRoot
};
