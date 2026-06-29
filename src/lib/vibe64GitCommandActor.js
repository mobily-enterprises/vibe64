function normalizedGitActorText(value = "") {
  return String(value || "").trim();
}

function sessionGithubCommandActor(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const email = normalizedGitActorText(metadata.session_git_command_actor_email);
  const scope = normalizedGitActorText(metadata.session_git_command_actor_scope);
  const userKey = normalizedGitActorText(metadata.session_git_command_actor_user_key);
  const account = email || (scope === "local" ? "local GitHub" : userKey);
  if (!account) {
    return {
      active: false,
      displayLabel: "not selected",
      label: "GitHub: not selected",
      title: "No GitHub command actor is selected for this session yet."
    };
  }
  return {
    active: true,
    displayLabel: account,
    label: `GitHub: ${account}`,
    title: `GitHub commands for this session run as ${account}.`
  };
}

export {
  sessionGithubCommandActor
};
