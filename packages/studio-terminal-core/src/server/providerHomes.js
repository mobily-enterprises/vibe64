import path from "node:path";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  resolveVibe64ProviderHomesRoot
} from "@local/vibe64-core/server/studioRoots";

const APP_PROVIDER_SCOPE = "app";
const USER_PROVIDER_SCOPE = "user";
const GITHUB_ACCOUNT_MODE_LOCAL = "local";
const GITHUB_ACCOUNT_MODE_USER = "user";

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
  const safeProviderHomesRoot = String(providerHomesRoot || "").trim();
  const safeUserKey = String(userKey || "").trim();
  const safeProviderId = String(providerId || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return safeProviderHomesRoot && safeProviderId && safeUserKey
    ? path.join(safeProviderHomesRoot, safeProviderId, safeUserKey)
    : "";
}

function githubProviderUserKey(user = {}) {
  return providerUserKey(user);
}

function githubProviderHome(providerHomesRoot, user = {}) {
  return providerHome("github", providerHomesRoot, user);
}

function codexProviderHome(providerHomesRoot = "") {
  const safeProviderHomesRoot = String(providerHomesRoot || "").trim();
  return safeProviderHomesRoot ? path.join(safeProviderHomesRoot, "codex") : "";
}

function normalizeGithubAccountMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === GITHUB_ACCOUNT_MODE_LOCAL || normalized === APP_PROVIDER_SCOPE) {
    return GITHUB_ACCOUNT_MODE_LOCAL;
  }
  if (normalized === GITHUB_ACCOUNT_MODE_USER || normalized === USER_PROVIDER_SCOPE) {
    return GITHUB_ACCOUNT_MODE_USER;
  }
  return GITHUB_ACCOUNT_MODE_USER;
}

function providerHomesRootRequiredError(providerLabel = "provider") {
  return {
    code: "vibe64_provider_homes_root_required",
    error: `A Vibe64 provider homes root is required for ${providerLabel} operations.`,
    errors: [
      {
        code: "vibe64_provider_homes_root_required",
        message: `A Vibe64 provider homes root is required for ${providerLabel} operations.`
      }
    ],
    ok: false
  };
}

function githubLocalProviderContext({
  providerHomesRoot = ""
} = {}) {
  const toolHomeSource = providerHomeForUserKey("github", providerHomesRoot, GITHUB_ACCOUNT_MODE_LOCAL);
  if (!toolHomeSource) {
    return providerHomesRootRequiredError("GitHub");
  }
  return {
    email: "",
    ok: true,
    providerScope: APP_PROVIDER_SCOPE,
    toolHomeSource,
    userKey: GITHUB_ACCOUNT_MODE_LOCAL
  };
}

function codexProviderContext({
  providerHomesRoot = ""
} = {}) {
  const toolHomeSource = codexProviderHome(providerHomesRoot);
  if (!toolHomeSource) {
    return providerHomesRootRequiredError("Codex");
  }
  return {
    email: "",
    ok: true,
    providerScope: APP_PROVIDER_SCOPE,
    toolHomeSource,
    userKey: APP_PROVIDER_SCOPE
  };
}

function githubProviderContext(input = {}, {
  accountMode = GITHUB_ACCOUNT_MODE_USER,
  providerHomesRoot = ""
} = {}) {
  const resolvedAccountMode = normalizeGithubAccountMode(accountMode);
  if (resolvedAccountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return githubLocalProviderContext({
      providerHomesRoot
    });
  }

  const user = input?.vibe64User || null;
  const email = canonicalVibe64UserEmail(user);
  const userKey = githubProviderUserKey(user);
  const toolHomeSource = githubProviderHome(providerHomesRoot, user);
  if (!email || !userKey || !toolHomeSource) {
    if (!toolHomeSource && email && userKey) {
      return providerHomesRootRequiredError("GitHub");
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
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_PROVIDER_SCOPE,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  canonicalVibe64UserEmail,
  codexProviderContext,
  codexProviderHome,
  githubLocalProviderContext,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  normalizeGithubAccountMode,
  providerHome,
  providerHomeForUserKey,
  providerUserKey,
  resolveProviderHomesRoot
};
