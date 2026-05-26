import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";
import {
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

function buildGithubRepoCreateOrLinkScript(repoName) {
  return shellScript([
    "set -e",
    "set -x",
    "git config --global --add safe.directory /workspace || true",
    `repo_name=${shellQuote(repoName)}`,
    "owner=$(gh api user --jq .login)",
    "repo_slug=\"$owner/$repo_name\"",
    "if git remote get-url origin >/dev/null 2>&1; then echo \"origin already configured: $(git remote get-url origin)\"; exit 0; fi",
    "if repo_url=$(gh repo view \"$repo_slug\" --json url --jq '.url + \".git\"' 2>/dev/null); then git remote add origin \"$repo_url\"; git remote get-url origin; echo \"Linked existing GitHub repository: $repo_slug\"; exit 0; fi",
    "if git rev-parse --verify HEAD >/dev/null 2>&1; then gh repo create \"$repo_name\" --source=. --remote=origin --private --push; else gh repo create \"$repo_name\" --source=. --remote=origin --private; git remote get-url origin; echo \"No commits found; created GitHub repo and linked origin without pushing.\"; fi"
  ]);
}

export {
  buildGithubRepoCreateOrLinkScript
};
