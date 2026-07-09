import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";
import {
  shellQuote
} from "@local/vibe64-execution/server";

function buildGithubRepoCreateOrLinkScript(repoName) {
  return shellScript([
    "set -e",
    "set -x",
    "git_safe() { git -c safe.directory=\"$PWD\" \"$@\"; }",
    `repo_name=${shellQuote(repoName)}`,
    "owner=$(gh api user --jq .login)",
    "repo_slug=\"$owner/$repo_name\"",
    "link_origin() { repo_url=$(gh repo view \"$repo_slug\" --json url --jq '.url + \".git\"'); git_safe remote add origin \"$repo_url\"; git_safe remote get-url origin; }",
    "if git_safe remote get-url origin >/dev/null 2>&1; then echo \"origin already configured: $(git_safe remote get-url origin)\"; exit 0; fi",
    "if gh repo view \"$repo_slug\" --json url >/dev/null 2>&1; then link_origin; echo \"Linked existing GitHub repository: $repo_slug\"; exit 0; fi",
    "gh repo create \"$repo_name\" --private",
    "link_origin",
    "if git_safe rev-parse --verify HEAD >/dev/null 2>&1; then git_safe push -u origin HEAD; else echo \"No commits found; created GitHub repo and linked origin without pushing.\"; fi"
  ]);
}

export {
  buildGithubRepoCreateOrLinkScript
};
