const REPOSITORY_UPDATE_RELATIONSHIPS = new Set([
  "ahead",
  "behind",
  "current",
  "diverged"
]);

function text(value = "") {
  return String(value || "").trim();
}

function nonnegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function boundedText(value, maximum) {
  return text(value).slice(0, maximum);
}

function normalizeIncomingVersion(value = {}) {
  const commit = text(value.commit);
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    return null;
  }
  return {
    author: boundedText(value.author, 200),
    committedAt: boundedText(value.committedAt, 100),
    commit,
    isMerge: value.isMerge === true,
    message: boundedText(value.message, 1000),
    shortCommit: commit.slice(0, 8)
  };
}

function repositoryUpdateRelationship(aheadValue = 0, behindValue = 0) {
  const ahead = nonnegativeInteger(aheadValue);
  const behind = nonnegativeInteger(behindValue);
  if (ahead > 0 && behind > 0) {
    return "diverged";
  }
  if (behind > 0) {
    return "behind";
  }
  if (ahead > 0) {
    return "ahead";
  }
  return "current";
}

function repositoryUpdateStrategy(relationship = "") {
  return relationship === "behind" || relationship === "diverged"
    ? "rebase"
    : "none";
}

function normalizeRepositoryUpdateCheck(value = {}, checkedAt = new Date().toISOString()) {
  const ahead = nonnegativeInteger(value.ahead);
  const behind = nonnegativeInteger(value.behind);
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const incomingVersions = Array.isArray(value.incomingVersions)
    ? value.incomingVersions.map(normalizeIncomingVersion).filter(Boolean).slice(0, 5)
    : [];
  return {
    ahead,
    behind,
    canonicalCommit: text(value.canonicalCommit),
    checkedAt: text(checkedAt),
    incomingVersions,
    incomingVersionsTruncated:
      value.incomingVersionsTruncated === true || behind > incomingVersions.length,
    relationship,
    sessionHead: text(value.sessionHead),
    ...(value.historyReview ? { historyReview: value.historyReview } : {}),
    updateAvailable: Boolean(value.historyReview) || behind > 0,
    updateStrategy: repositoryUpdateStrategy(relationship)
  };
}

export {
  REPOSITORY_UPDATE_RELATIONSHIPS,
  normalizeRepositoryUpdateCheck,
  repositoryUpdateRelationship,
  repositoryUpdateStrategy
};
