function githubGitAuthScript() {
  return [
    "vibe64_git_remote_url_is_github() {",
    "  case \"$1\" in",
    "    https://github.com/*|http://github.com/*|git@github.com:*|ssh://git@github.com/*)",
    "      return 0;",
    "      ;;",
    "    *)",
    "      return 1;",
    "      ;;",
    "  esac;",
    "};",
    "vibe64_enable_github_git_auth_for_url() {",
    "  VIBE64_GIT_AUTH_REMOTE_URL=\"$1\";",
    "  if ! vibe64_git_remote_url_is_github \"$VIBE64_GIT_AUTH_REMOTE_URL\"; then",
    "    return 0;",
    "  fi;",
    "  if [ -n \"${GIT_ASKPASS:-}\" ] && [ -n \"${VIBE64_GIT_AUTH_TOKEN:-}\" ]; then",
    "    return 0;",
    "  fi;",
    "  if ! command -v gh >/dev/null 2>&1; then",
    "    printf '[studio] GitHub CLI is required for private GitHub repository access.\\n' >&2;",
    "    return 1;",
    "  fi;",
    "  VIBE64_GIT_AUTH_TOKEN=\"$(gh auth token 2>/dev/null || true)\";",
    "  if [ -z \"$VIBE64_GIT_AUTH_TOKEN\" ]; then",
    "    printf '[studio] GitHub authentication is not ready for private repository access. Reconnect GitHub, then retry.\\n' >&2;",
    "    return 1;",
    "  fi;",
    "  export VIBE64_GIT_AUTH_TOKEN;",
    "  VIBE64_GIT_ASKPASS=\"${TMPDIR:-/tmp}/vibe64-git-askpass-$$\";",
    "  printf '%s\\n' '#!/bin/sh' 'case \"$1\" in' '*Username*) printf \"%s\\\\n\" \"x-access-token\" ;;' '*) printf \"%s\\\\n\" \"$VIBE64_GIT_AUTH_TOKEN\" ;;' 'esac' > \"$VIBE64_GIT_ASKPASS\";",
    "  chmod 700 \"$VIBE64_GIT_ASKPASS\";",
    "  export GIT_ASKPASS=\"$VIBE64_GIT_ASKPASS\";",
    "  export GIT_TERMINAL_PROMPT=0;",
    "};",
    "vibe64_enable_github_git_auth_for_remote() {",
    "  VIBE64_GIT_AUTH_REMOTE_NAME=\"$1\";",
    "  VIBE64_GIT_AUTH_REMOTE_URL=\"$(git remote get-url \"$VIBE64_GIT_AUTH_REMOTE_NAME\" 2>/dev/null || true)\";",
    "  vibe64_enable_github_git_auth_for_url \"$VIBE64_GIT_AUTH_REMOTE_URL\";",
    "}"
  ].join("\n");
}

export {
  githubGitAuthScript
};
