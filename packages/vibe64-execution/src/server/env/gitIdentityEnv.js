import {
  firstText,
  normalizeText,
  recordValue
} from "../normalize.js";

const GIT_AUTHOR_NAME_ENV = "GIT_AUTHOR_NAME";
const GIT_AUTHOR_EMAIL_ENV = "GIT_AUTHOR_EMAIL";
const GIT_COMMITTER_NAME_ENV = "GIT_COMMITTER_NAME";
const GIT_COMMITTER_EMAIL_ENV = "GIT_COMMITTER_EMAIL";

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
  tenant = "",
  userKey = ""
} = {}) {
  const safeUser = sanitizeEmailLabel(userKey, "user");
  const safeTenant = sanitizeEmailLabel(tenant, "local");
  return {
    authorEmail: `${safeUser}@${safeTenant}.users.vibe64.invalid`,
    authorName: `${safeUser} via Vibe64`,
    committerEmail: `vibe64@${safeTenant}.users.vibe64.invalid`,
    committerName: "Vibe64",
    source: "fallback"
  };
}

function resolveGitIdentity({
  actor = {},
  env = process.env,
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
    githubGitIdentity(project.githubUser || session.githubUser || metadata.github_user) ||
    fallbackGitIdentity({
      tenant: firstText(project.tenant, project.workspace, env.VIBE64_WORKSPACE, env.VIBE64_RUNTIME_NAMESPACE),
      userKey: firstText(
        userKey,
        actor.user?.username,
        metadata.workflow_driver_username,
        env.VIBE64_GIT_USER_KEY,
        env.VIBE64_USER_KEY,
        env.VIBE64_USER,
        env.USER,
        env.LOGNAME
      )
    });
}

function gitIdentityEnv(options = {}) {
  const identity = resolveGitIdentity(options);
  return {
    [GIT_AUTHOR_EMAIL_ENV]: identity.authorEmail,
    [GIT_AUTHOR_NAME_ENV]: identity.authorName,
    [GIT_COMMITTER_EMAIL_ENV]: identity.committerEmail,
    [GIT_COMMITTER_NAME_ENV]: identity.committerName
  };
}

function gitIdentityReadiness(options = {}) {
  const identity = resolveGitIdentity(options);
  const fallback = identity.source === "fallback";
  return {
    email: identity.authorEmail,
    env: gitIdentityEnv(options),
    explanation: fallback
      ? "Using Vibe64 fallback Git identity because no explicit Git identity is configured."
      : "Git commit identity is available.",
    identity,
    name: identity.authorName,
    observed: `${identity.authorName} <${identity.authorEmail}>${fallback ? " (Vibe64 fallback)" : ""}`,
    ok: true,
    source: identity.source
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
  resolveGitIdentity,
  sanitizeEmailLabel
};
