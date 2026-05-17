function isGithubRemoteUrl(url) {
  return /^(https:\/\/github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?|git@github\.com:[^/\s]+\/[^/\s]+(?:\.git)?)$/u.test(String(url || ""));
}

function repoSlugFromRemoteUrl(url) {
  const value = String(url || "").trim();
  const httpsMatch = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(value);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/u.exec(value);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return "";
}

export {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
};
