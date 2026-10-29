import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { stat } from "node:fs/promises";
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
const GIT_CONFIG_IDENTITY_ARGS = ["config", "--get-regexp", "^user\\.(name|email)$"];
// How long one read answers later commands with the same directory and env.
// Editing the global config file ends it at once (see globalGitConfigRevision);
// this bounds the files a revision can't see: includes, system and repository config.
const GIT_CONFIG_IDENTITY_TTL_MS = 30_000;
// The two lines that give Git the person's own name and email.
const GIT_IDENTITY_COMMANDS = [
  "git config --global user.name \"Your Name\"",
  "git config --global user.email \"you@example.com\""
].join("\n");

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

function absoluteDirectory(value = "") {
  const directory = normalizeText(value);
  return directory && path.isAbsolute(directory) ? directory : "";
}

function existingDirectorySync(value = "") {
  const directory = absoluteDirectory(value);
  try {
    return directory && statSync(directory).isDirectory() ? directory : "";
  } catch {
    return "";
  }
}

async function existingDirectory(value = "") {
  const directory = absoluteDirectory(value);
  return directory && await stat(directory).then((entry) => entry.isDirectory(), () => false) ? directory : "";
}

// Every scope is listed from lowest to highest priority; the last value wins.
function gitConfigIdentityValues(stdout = "") {
  const values = {};
  for (const line of String(stdout || "").split("\n")) {
    const match = /^user\.(name|email)(?: (.*))?$/iu.exec(line);
    if (match) values[match[1].toLowerCase()] = normalizeText(match[2]);
  }
  return values;
}

function gitConfigReadOptions(cwd, env) {
  return {
    ...(cwd ? { cwd } : {}),
    env,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_CONFIG_READ_TIMEOUT_MS
  };
}

// Exit 1 means no user.name or user.email is set. Any other failure yields null.
function readGitConfigIdentitySync(cwd, env) {
  const result = spawnSync("git", GIT_CONFIG_IDENTITY_ARGS, { ...gitConfigReadOptions(cwd, env), encoding: "utf8" });
  if (result.error || (result.status !== 0 && result.status !== 1)) return null;
  return gitConfigIdentityValues(result.stdout);
}

// The same read without holding the server's thread. `transient` marks a read
// that never finished (git missing, a spawn error, the timeout), which a memo
// must not keep.
function readGitConfigIdentity(cwd, env) {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    const child = spawn("git", GIT_CONFIG_IDENTITY_ARGS, gitConfigReadOptions(cwd, env));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", () => settle({ transient: true, values: null }));
    child.once("close", (status, signal) => settle(signal
      ? { transient: true, values: null }
      : { transient: false, values: status === 0 || status === 1 ? gitConfigIdentityValues(stdout) : null }));
  });
}

function gitConfigIdentity(values = null) {
  if (!values?.name || !values?.email) return null;
  return {
    authorEmail: values.email,
    authorName: values.name,
    committerEmail: values.email,
    committerName: values.name,
    source: "git-config"
  };
}

// Runs with the command's env, but finds git on the server's own PATH: an
// agent PATH can start with Vibe64's git shim, which this process serves.
function gitConfigReadEnv(env = {}) {
  return { ...env, PATH: process.env.PATH || env.PATH };
}

// The files `git config --global` writes. A change to any of them is seen on
// the next command, so Health and the next Save follow Save Git identity at once.
function globalGitConfigPaths(env = {}) {
  if (Object.hasOwn(env, "GIT_CONFIG_GLOBAL")) return [String(env.GIT_CONFIG_GLOBAL)];
  const home = absoluteDirectory(env.HOME);
  const configHome = normalizeText(env.XDG_CONFIG_HOME) || (home ? path.join(home, ".config") : "");
  return [
    configHome ? path.join(configHome, "git", "config") : "",
    home ? path.join(home, ".gitconfig") : ""
  ].filter(Boolean);
}

async function globalGitConfigRevision(env = {}) {
  const revisions = await Promise.all(globalGitConfigPaths(env).map((file) => stat(file).then(
    (entry) => `${entry.ino}:${entry.size}:${entry.mtimeMs}:${entry.ctimeMs}`,
    () => "missing"
  )));
  return revisions.join("|");
}

const gitConfigIdentityReads = new Map();

function gitConfigReadKey(repositoryDirectory, homeDirectory, env) {
  const entries = Object.entries(env).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(JSON.stringify([repositoryDirectory, homeDirectory, entries])).digest("hex");
}

// The repository's view (its own config wins there), else the HOME's view.
async function readPersonGitConfigValues(repositoryDirectory, homeDirectory, env) {
  const repository = repositoryDirectory ? await readGitConfigIdentity(repositoryDirectory, env) : null;
  if (repository?.values) return repository;
  const home = await readGitConfigIdentity(homeDirectory, env);
  return { transient: Boolean(repository?.transient || home.transient), values: home.values };
}

// One read answers every command with the same directories and env (the full
// env, so include and GIT_CONFIG_* overrides keep their effect) until the TTL
// ends or the global config file changes. Concurrent commands share one read.
async function memoizedPersonGitConfigValues(repositoryDirectory, homeDirectory, env) {
  const key = gitConfigReadKey(repositoryDirectory, homeDirectory, env);
  const revision = await globalGitConfigRevision(env);
  const now = Date.now();
  const cached = gitConfigIdentityReads.get(key);
  if (cached && cached.revision === revision && cached.expiresAt > now) return (await cached.read).values;
  for (const [entryKey, entry] of gitConfigIdentityReads) {
    if (entry.expiresAt <= now) gitConfigIdentityReads.delete(entryKey);
  }
  const entry = {
    expiresAt: now + GIT_CONFIG_IDENTITY_TTL_MS,
    read: readPersonGitConfigValues(repositoryDirectory, homeDirectory, env),
    revision
  };
  gitConfigIdentityReads.set(key, entry);
  const outcome = await entry.read;
  if (outcome.transient && gitConfigIdentityReads.get(key) === entry) gitConfigIdentityReads.delete(key);
  return outcome.values;
}

// The person's own Git configuration, read by git itself so global, XDG,
// include and repository-local rules all apply.
async function personGitConfigIdentity({ cwd = "", env = null } = {}) {
  if (!env || typeof env !== "object") return null;
  const [repositoryDirectory, homeDirectory] = await Promise.all([existingDirectory(cwd), existingDirectory(env.HOME)]);
  return gitConfigIdentity(await memoizedPersonGitConfigValues(repositoryDirectory, homeDirectory, gitConfigReadEnv(env)));
}

// The same identity read while the caller waits. Only a builder that must stay
// synchronous uses it (the Codex runtime context); commands use the read above.
function personGitConfigIdentitySync({ cwd = "", env = null } = {}) {
  if (!env || typeof env !== "object") return null;
  const readEnv = gitConfigReadEnv(env);
  const repositoryDirectory = existingDirectorySync(cwd);
  return gitConfigIdentity((repositoryDirectory && readGitConfigIdentitySync(repositoryDirectory, readEnv)) ||
    readGitConfigIdentitySync(existingDirectorySync(env.HOME), readEnv));
}

// The person's Git identity read as that person, supplied by a caller whose
// command runs under another Unix identity (such as a Save run by the
// workspace service for a signed-in person), where reading the command's own
// HOME would find someone else's settings.
function suppliedPersonGitIdentity(value = {}) {
  const record = recordValue(value);
  const name = normalizeText(record.name);
  const email = normalizeText(record.email);
  if (!name || !email) return null;
  return {
    authorEmail: email,
    authorName: name,
    committerEmail: email,
    committerName: name,
    source: "git-config"
  };
}

function isFallbackGitIdentityEmail(email = "") {
  return normalizeText(email).toLowerCase().endsWith(FALLBACK_EMAIL_DOMAIN);
}

// Order: explicit project/session identity, the person's Git config (as read
// for them by the caller, else by git with the command's own env), the
// connected GitHub account, then a clearly marked stand-in.
function explicitGitIdentity({
  env = process.env,
  personGitIdentity = null,
  project = {},
  session = {}
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
    suppliedPersonGitIdentity(personGitIdentity);
}

function accountOrFallbackGitIdentity({
  actor = {},
  env = process.env,
  project = {},
  session = {},
  userKey = ""
} = {}) {
  const metadata = recordValue(session.metadata);
  return githubGitIdentity(project.githubUser || session.githubUser || metadata.github_user) ||
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

async function resolveGitIdentity(options = {}) {
  return explicitGitIdentity(options) ||
    await personGitConfigIdentity(options.gitConfig || {}) ||
    accountOrFallbackGitIdentity(options);
}

function resolveGitIdentitySync(options = {}) {
  return explicitGitIdentity(options) ||
    personGitConfigIdentitySync(options.gitConfig || {}) ||
    accountOrFallbackGitIdentity(options);
}

function identityEnv(identity) {
  return {
    [GIT_AUTHOR_EMAIL_ENV]: identity.authorEmail,
    [GIT_AUTHOR_NAME_ENV]: identity.authorName,
    [GIT_COMMITTER_EMAIL_ENV]: identity.committerEmail,
    [GIT_COMMITTER_NAME_ENV]: identity.committerName
  };
}

async function gitIdentityEnv(options = {}) {
  return identityEnv(await resolveGitIdentity(options));
}

function gitIdentityEnvSync(options = {}) {
  return identityEnv(resolveGitIdentitySync(options));
}

// Nothing is blocked on a stand-in identity; the person is told how to set theirs.
async function gitIdentityReadiness(options = {}) {
  const identity = await resolveGitIdentity(options);
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
  GIT_IDENTITY_COMMANDS,
  GIT_AUTHOR_EMAIL_ENV,
  GIT_AUTHOR_NAME_ENV,
  GIT_COMMITTER_EMAIL_ENV,
  GIT_COMMITTER_NAME_ENV,
  fallbackGitIdentity,
  gitIdentityEnv,
  gitIdentityEnvSync,
  gitIdentityReadiness,
  isFallbackGitIdentityEmail,
  personGitConfigIdentity,
  personGitConfigIdentitySync,
  resolveGitIdentity,
  sanitizeEmailLabel
};
