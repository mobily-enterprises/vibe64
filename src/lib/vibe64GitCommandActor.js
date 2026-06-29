function normalizedGitActorText(value = "") {
  return String(value || "").trim();
}

function sessionGithubCommandActor(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const active = normalizedGitActorText(metadata.codex_last_prompt_git_actor_active) === "yes";
  const email = normalizedGitActorText(metadata.codex_last_prompt_git_actor_email);
  const scope = normalizedGitActorText(metadata.codex_last_prompt_git_actor_scope);
  const userKey = normalizedGitActorText(metadata.codex_last_prompt_git_actor_user_key);
  const account = email || (scope === "local" ? "local GitHub" : userKey);
  if (!active) {
    return {
      active: false,
      label: "GitHub: not selected",
      title: "No GitHub command actor is selected for this session yet."
    };
  }
  if (!account) {
    return {
      active: false,
      label: "GitHub: incomplete",
      title: "The session has an active GitHub command actor, but its identity is incomplete."
    };
  }
  return {
    active: true,
    label: `GitHub: ${account}`,
    title: `GitHub commands for this session are currently recorded as ${account}.`
  };
}

export {
  sessionGithubCommandActor
};
