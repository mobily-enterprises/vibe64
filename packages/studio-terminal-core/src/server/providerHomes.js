import path from "node:path";

import {
  resolveVibe64SystemRoot
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
  if (String(explicitRoot || "").trim()) {
    return path.resolve(String(explicitRoot || ""));
  }
  return path.join(resolveVibe64SystemRoot({
    env,
    explicitRoot: systemRoot,
    projectsRoot,
    runtimeProfile
  }), "provider-homes");
}

function canonicalVibe64UserEmail(user = {}) {
  return String(user?.email || "").trim().toLowerCase();
}

function providerUserKey(user = {}) {
  const email = canonicalVibe64UserEmail(user);
  return email && !email.includes("/") && !email.includes("\\") ? email : "";
}

function providerHome(providerId = "", providerHomesRoot = "", user = {}) {
  const userKey = providerUserKey(user);
  const safeProviderId = String(providerId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return safeProviderId && userKey ? path.join(providerHomesRoot, safeProviderId, userKey) : "";
}

function githubProviderUserKey(user = {}) {
  return providerUserKey(user);
}

function githubProviderHome(providerHomesRoot, user = {}) {
  return providerHome("github", providerHomesRoot, user);
}

function githubProviderContext(input = {}, {
  providerHomesRoot = ""
} = {}) {
  const user = input?.vibe64User || null;
  const email = canonicalVibe64UserEmail(user);
  const userKey = githubProviderUserKey(user);
  const toolHomeSource = githubProviderHome(providerHomesRoot, user);
  if (!email || !userKey || !toolHomeSource) {
    return {
      code: "vibe64_user_required",
      error: "A logged-in Vibe64 user is required for GitHub account operations.",
      errors: [
        {
          code: "vibe64_user_required",
          message: "A logged-in Vibe64 user is required for GitHub account operations."
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
  canonicalVibe64UserEmail,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  providerHome,
  providerUserKey,
  resolveProviderHomesRoot
};
