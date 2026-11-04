import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function sessionUsesGithub(session = {}) {
  const metadata = normalizeObject(session.metadata);
  const remoteUrl = normalizeText(
    metadata.source_remote_url ||
    metadata.github_repository ||
    session.sourceRemoteUrl ||
    session.githubRepository
  );
  if (!remoteUrl) {
    return false;
  }
  if (normalizeText(metadata.github_repository || session.githubRepository)) {
    return true;
  }
  try {
    const url = new URL(remoteUrl);
    return url.hostname.toLowerCase() === "github.com";
  } catch {
    return /^(?:git@|ssh:\/\/git@)github\.com(?::|\/)/iu.test(remoteUrl);
  }
}

function sessionGithubCommandActor(session = {}) {
  const metadata = normalizeObject(session.metadata);
  const scope = normalizeText(metadata.session_git_command_actor_scope);
  const userKey = normalizeText(metadata.session_git_command_actor_user_key);
  const account = scope === "local" ? "local GitHub" : userKey;
  const available = sessionUsesGithub(session);
  if (!account) {
    return {
      active: false,
      available,
      displayLabel: "not selected",
      label: "GitHub: not selected",
      title: "No GitHub command actor is selected for this session yet."
    };
  }
  return {
    active: true,
    available,
    displayLabel: account,
    label: `GitHub: ${account}`,
    title: `GitHub commands for this session run as ${account}.`
  };
}

export {
  sessionGithubCommandActor,
  sessionUsesGithub
};
