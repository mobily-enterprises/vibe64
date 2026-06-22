import path from "node:path";

import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  resolveVibe64ProviderHomesRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  logOperationalEvent
} from "@local/vibe64-core/server/logging";

const APP_PROVIDER_SCOPE = "app";
const USER_PROVIDER_SCOPE = "user";
const GITHUB_ACCOUNT_MODE_LOCAL = "local";
const GITHUB_ACCOUNT_MODE_USER = "user";
const VIBE64_GITHUB_ACCOUNT_MODE_ENV = "VIBE64_GITHUB_ACCOUNT_MODE";

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

function terminalHomeForUserKey(providerHomesRoot = "", userKey = "") {
  const safeProviderHomesRoot = String(providerHomesRoot || "").trim();
  const safeUserKey = String(userKey || "").trim();
  return safeProviderHomesRoot && safeUserKey
    ? path.join(safeProviderHomesRoot, "terminal-homes", "github", safeUserKey)
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

function normalizeGithubAccountMode(value = "", fallback = GITHUB_ACCOUNT_MODE_USER) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === GITHUB_ACCOUNT_MODE_LOCAL || normalized === APP_PROVIDER_SCOPE) {
    return GITHUB_ACCOUNT_MODE_LOCAL;
  }
  if (normalized === GITHUB_ACCOUNT_MODE_USER || normalized === USER_PROVIDER_SCOPE) {
    return GITHUB_ACCOUNT_MODE_USER;
  }
  return fallback === GITHUB_ACCOUNT_MODE_LOCAL ? GITHUB_ACCOUNT_MODE_LOCAL : GITHUB_ACCOUNT_MODE_USER;
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
    return {
      ...githubLocalProviderContext({
        providerHomesRoot
      }),
      accountMode: resolvedAccountMode
    };
  }

  const user = input?.vibe64User || null;
  const email = canonicalVibe64UserEmail(user);
  const userKey = githubProviderUserKey(user);
  const toolHomeSource = githubProviderHome(providerHomesRoot, user);
  if (!email || !userKey || !toolHomeSource) {
    if (!toolHomeSource && email && userKey) {
      return {
        ...providerHomesRootRequiredError("GitHub"),
        accountMode: resolvedAccountMode
      };
    }
    return {
      accountMode: resolvedAccountMode,
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
    accountMode: resolvedAccountMode,
    email,
    ok: true,
    providerScope: USER_PROVIDER_SCOPE,
    toolHomeSource,
    userKey
  };
}

function resolveGithubToolHomeForActor({
  accountMode = "",
  env = process.env,
  providerHomesRoot = "",
  vibe64User = null
} = {}) {
  const resolvedAccountMode = normalizeGithubAccountMode(
    accountMode || env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubProviderContext({
    vibe64User
  }, {
    accountMode: resolvedAccountMode,
    providerHomesRoot
  });
  if (context?.ok === false) {
    return {
      ...context,
      accountMode: resolvedAccountMode,
      ownerEmail: "",
      ownerUserKey: "",
      providerScope: "",
      toolHomeSource: ""
    };
  }
  return {
    accountMode: resolvedAccountMode,
    ok: true,
    ownerEmail: context.email || "",
    ownerUserKey: context.userKey || "",
    providerScope: context.providerScope || "",
    toolHomeSource: context.toolHomeSource || ""
  };
}

function composeGithubTerminalHome(result = {}, {
  providerHomesRoot = ""
} = {}) {
  if (result?.ok === false) {
    return result;
  }
  const ownerUserKey = String(result.ownerUserKey || result.userKey || "").trim();
  const githubToolHomeSource = String(result.githubToolHomeSource || result.toolHomeSource || "").trim();
  const toolHomeSource = terminalHomeForUserKey(providerHomesRoot, ownerUserKey);
  if (!toolHomeSource) {
    return {
      ...providerHomesRootRequiredError("terminal"),
      accountMode: result.accountMode || "",
      ok: false
    };
  }
  return {
    ...result,
    githubToolHomeSource,
    toolHomeSource
  };
}

function resolveGithubToolHomeForStoredActor({
  accountMode = "",
  env = process.env,
  ownerEmail = "",
  ownerUserKey = "",
  providerHomesRoot = ""
} = {}) {
  const resolvedAccountMode = normalizeGithubAccountMode(
    accountMode || env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  if (resolvedAccountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return resolveGithubToolHomeForActor({
      accountMode: resolvedAccountMode,
      env,
      providerHomesRoot
    });
  }

  const userKey = String(ownerUserKey || "").trim();
  const toolHomeSource = providerHomeForUserKey("github", providerHomesRoot, userKey);
  if (!userKey) {
    return {
      accountMode: resolvedAccountMode,
      code: "vibe64_user_required",
      error: "A GitHub provider home user key is required for GitHub operations.",
      ok: false
    };
  }
  if (!toolHomeSource) {
    return {
      ...providerHomesRootRequiredError("GitHub"),
      accountMode: resolvedAccountMode
    };
  }
  return {
    accountMode: resolvedAccountMode,
    ok: true,
    ownerEmail: String(ownerEmail || "").trim().toLowerCase(),
    ownerUserKey: userKey,
    providerScope: USER_PROVIDER_SCOPE,
    toolHomeSource
  };
}

function logGithubProviderHomeResolution(logger, result = {}, {
  operation = "",
  terminalKind = ""
} = {}) {
  const ok = result?.ok !== false;
  return logOperationalEvent(logger, ok ? "info" : "warn", {
    accountMode: String(result?.accountMode || ""),
    code: result?.code || "",
    component: "vibe64.github_provider_home",
    event: ok
      ? "vibe64.github_provider_home.resolved"
      : "vibe64.github_provider_home.failed",
    ok,
    operation: String(operation || ""),
    ownerEmail: result?.ownerEmail || result?.email || "",
    ownerUserKey: result?.ownerUserKey || result?.userKey || "",
    providerScope: result?.providerScope || "",
    terminalKind
  }, ok ? "Vibe64 GitHub provider home resolved." : "Vibe64 GitHub provider home resolution failed.");
}

export {
  APP_PROVIDER_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_PROVIDER_SCOPE,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  canonicalVibe64UserEmail,
  codexProviderContext,
  codexProviderHome,
  githubLocalProviderContext,
  githubProviderContext,
  githubProviderHome,
  githubProviderUserKey,
  composeGithubTerminalHome,
  logGithubProviderHomeResolution,
  normalizeGithubAccountMode,
  providerHome,
  providerHomeForUserKey,
  providerUserKey,
  resolveGithubToolHomeForActor,
  resolveGithubToolHomeForStoredActor,
  resolveProviderHomesRoot,
  terminalHomeForUserKey
};
