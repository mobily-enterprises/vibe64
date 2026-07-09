function commandCanCreateGitCommits(command = "", args = []) {
  return String(command || "") === "git" && ["commit", "merge", "tag"].includes(String(args?.[0] || ""));
}

export {
  commandCanCreateGitCommits
};
