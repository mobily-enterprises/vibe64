import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

import {
  firstText,
  normalizeText,
  recordValue
} from "../normalize.js";

const GIT_AUTHOR_NAME_ENV = "GIT_AUTHOR_NAME";
const GIT_AUTHOR_EMAIL_ENV = "GIT_AUTHOR_EMAIL";
const GIT_COMMITTER_NAME_ENV = "GIT_COMMITTER_NAME";
const GIT_COMMITTER_EMAIL_ENV = "GIT_COMMITTER_EMAIL";
const FALLBACK_EMAIL_DOMAIN = ".users.vibe64.invalid";
const GIT_CONFIG_READ_TIMEOUT_MS = 2_000;

function sanitizeEmailLabel(value = "", fallback = "vibe64") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 63) || fallback;
}

function configuredGitIdentity(...records) {
  for (const value of records) {
    const record = recordValue(value);
    const user = recordValue(record.user);
    const name = firstText(
      record.name,
      record.userName,
      record.user_name,
      record.gitUserName,
      record.git_user_name,
      user.name,
      user.userName,
      user.user_name
    );
    const email = firstText(
      record.email,
      record.userEmail,
      record.user_email,
      record.gitUserEmail,
      record.git_user_email,
      user.email,
      user.userEmail,
      user.user_email
    );
    if (name && email) {
      return {
        authorEmail: email,
        authorName: name,
        committerEmail: email,
        committerName: name,
        source: "configured"
      };
    }
  }
  return null;
}

function githubGitIdentity(github = {}) {
  const record = recordValue(github);
  const name = firstText(record.name, record.displayName, record.login, record.username);
  const email = firstText(record.email, record.publicEmail, record.verifiedEmail);
  if (!name || !email) {
    return null;
  }
  return {
    authorEmail: email,
    authorName: name,
    committerEmail: email,
    committerName: name,
    source: "github"
  };
}

function fallbackGitIdentity({
  workspace = "",
  userKey = ""
} = {}) {
  const safeUser = sanitizeEmailLabel(userKey, "user");
  const safeWorkspace = sanitizeEmailLabel(workspace, "local");
  return {
    authorEmail: `${safeUser}@${safeWorkspace}${FALLBACK_EMAIL_DOMAIN}`,
    authorName: `${safeUser} via Vibe64`,
    committerEmail: `vibe64@${safeWorkspace}${FALLBACK_EMAIL_DOMAIN}`,
    committerName: "Vibe64",
    source: "fallback"
  };
}

function existingDirectory(value = "") {
  const directory = normalizeText(value);
  if (!directory || !path.isAbsolute(directory)) return "";
  try {
    return statSync(directory).isDirectory() ? directory : "";
  } catch {
    return "";
  }
}

function readGitConfigIdentity(cwd, env) {
  const result = spawnSync("git", ["config", "--get-regexp", "^user\\.(name|email)$"], {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_CONFIG_READ_TIMEOUT_MS
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) return null;
  // Every scope is listed from lowest to highest priority; the last value wins.
  const values = {};
  for (const line of String(result.stdout || "").split("\n")) {
    const match = /^user\.(name|email)(?: (.*))?$/iu.exec(line);
    if (match) values[match[1].toLowerCase()] = normalizeText(match[2]);
  }
  return values;
}

// The person's own Git configuration, read by git itself so global, XDG,
// include and repository-local rules all apply. Runs with the command's env.
function personGitConfigIdentity({ cwd = "", env = null } = {}) {
  if (!env || typeof env !== "object") return null;
  const repositoryDirectory = existingDirectory(cwd);
  const values = (repositoryDirectory && readGitConfigIdentity(repositoryDirectory, env)) ||
    readGitConfigIdentity(existingDirectory(env.HOME), env) || {};
  if (!values.name || !values.email) return null;
  return {
    authorEmail: values.email,
    authorName: values.name,
    committerEmail: values.email,
    committerName: values.name,
    source: "git-config"
  };
}

function isFallbackGitIdentityEmail(email = "") {
  return normalizeText(email).toLowerCase().endsWith(FALLBACK_EMAIL_DOMAIN);
}

// Order: explicit project/session identity, the person's Git config, the
// connected GitHub account, then a clearly marked stand-in.
function resolveGitIdentity({
  actor = {},
  env = process.env,
  gitConfig = null,
  project = {},
  session = {},
  userKey = ""
} = {}) {
  const metadata = recordValue(session.metadata);
  return configuredGitIdentity(
    project.gitIdentity,
    project.config?.git,
    session.gitIdentity,
    metadata.git_identity,
    {
      name: env.VIBE64_GIT_USER_NAME,
      email: env.VIBE64_GIT_USER_EMAIL
    }
  ) ||
    personGitConfigIdentity(gitConfig || {}) ||
    githubGitIdentity(project.githubUser || session.githubUser || metadata.github_user) ||
    fallbackGitIdentity({
      workspace: firstText(project.workspace, env.VIBE64_WORKSPACE, env.VIBE64_RUNTIME_NAMESPACE),
      userKey: firstText(
        userKey,
        actor.user?.username,
        env.VIBE64_GIT_USER_KEY,
        env.VIBE64_USER_KEY,
        env.VIBE64_USER,
        env.USER,
        env.LOGNAME
      )
    });
}

function identityEnv(identity) {
  return {
    [GIT_AUTHOR_EMAIL_ENV]: identity.authorEmail,
    [GIT_AUTHOR_NAME_ENV]: identity.authorName,
    [GIT_COMMITTER_EMAIL_ENV]: identity.committerEmail,
    [GIT_COMMITTER_NAME_ENV]: identity.committerName
  };
}

function gitIdentityEnv(options = {}) {
  return identityEnv(resolveGitIdentity(options));
}

// Nothing is blocked on a stand-in identity; the person is told how to set theirs.
function gitIdentityReadiness(options = {}) {
  const identity = resolveGitIdentity(options);
  const fallback = identity.source === "fallback";
  return {
    email: identity.authorEmail,
    env: identityEnv(identity),
    explanation: fallback
      ? "Commits use a stand-in name because Git doesn't know your name and email yet."
      : "Commits use your name and email.",
    identity,
    name: identity.authorName,
    observed: `${identity.authorName} <${identity.authorEmail}>`,
    ok: true,
    source: identity.source,
    status: fallback ? "warn" : "pass"
  };
}

export {
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  fallbackGitIdentity,
  gitIdentityEnv,
  gitIdentityReadiness,
  isFallbackGitIdentityEmail,
  personGitConfigIdentity,
  resolveGitIdentity,
  sanitizeEmailLabel
};
