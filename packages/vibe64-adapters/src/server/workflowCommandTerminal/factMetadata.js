import {
  normalizeText
} from "@local/vibe64-core/server/core";

function commandMetadataResult({
  deleteMetadata = [],
  metadata = {}
} = {}) {
  return {
    deleteMetadata,
    metadata
  };
}

function metadataFromFacts(facts = {}, names = []) {
  return Object.fromEntries(names
    .map((name) => [name, normalizeText(facts[name])])
    .filter(([, value]) => Boolean(value)));
}

function sourceMetadata({
  baseBranch = "",
  baseCommit = "",
  branch = "",
  cachePath = "",
  defaultBranch = "",
  remoteUrl = "",
  sourcePath = "",
  sourcePathAuthority = ""
} = {}) {
  const metadata = {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    source_cache_path: cachePath,
    source_default_branch: defaultBranch || baseBranch,
    source_kind: "session_clone",
    source_path: sourcePath,
    source_remote_url: remoteUrl
  };
  if (sourcePathAuthority) {
    metadata.source_path_authority = sourcePathAuthority;
  }
  return metadata;
}

function sessionUsesSourcePullRequest(session = {}) {
  const metadata = session.metadata || {};
  return normalizeText(metadata.source_pr_update_mode) === "stacked" ||
    normalizeText(metadata.pr_source) === "existing" ||
    Boolean(normalizeText(metadata.source_pr_url));
}

function createWorktreeSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const baseMetadata = metadataFromFacts(facts, [
    "base_branch",
    "base_commit",
    "source_cache_path",
    "source_default_branch",
    "source_kind",
    "source_path",
    "source_path_authority",
    "source_remote_url"
  ]);
  if (!sessionUsesSourcePullRequest(session)) {
    return commandMetadataResult({
      metadata: baseMetadata
    });
  }

  const updateMode = normalizeText(facts.source_pr_update_mode) ||
    normalizeText(session.metadata?.source_pr_update_mode);
  if (updateMode !== "stacked" && !normalizeText(session.metadata?.source_pr_url)) {
    return commandMetadataResult({
      metadata: baseMetadata
    });
  }

  const sessionPrUrl = normalizeText(session.metadata?.pr_url);
  const sourcePrUrl = normalizeText(session.metadata?.source_pr_url);
  const deletePrMetadata = sessionPrUrl && sessionPrUrl === sourcePrUrl
    ? ["pr_url", "pr_source", "pr_number", "pr_title"]
    : [];
  return commandMetadataResult({
    deleteMetadata: deletePrMetadata,
    metadata: {
      ...baseMetadata,
      source_pr_update_mode: "stacked"
    }
  });
}

function commitChangesSuccessMetadataFromFacts({ facts = {} } = {}) {
  return commandMetadataResult({
    metadata: metadataFromFacts(facts, [
      "accepted_commit",
      "branch_pushed",
      "branch_push_remote",
      "canonical_git_saved",
      "local_commit_only",
      "main_checkout_synced",
      "pr_head_owner",
      "pr_head_repository"
    ])
  });
}

function createIssueSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const metadata = metadataFromFacts(facts, [
    "issue_number",
    "issue_title",
    "issue_url"
  ]);
  if (!metadata.issue_url) {
    return commandMetadataResult();
  }
  return commandMetadataResult({
    metadata: {
      github_issue_mode: "create",
      issue_source: "created",
      work_anchor_number: normalizeText(metadata.issue_number),
      work_anchor_title: normalizeText(session.metadata?.work_title) || normalizeText(metadata.issue_title),
      work_anchor_type: "issue",
      work_anchor_url: normalizeText(metadata.issue_url),
      ...metadata
    }
  });
}

function createPrSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  const metadata = metadataFromFacts(facts, [
    "pr_number",
    "pr_source",
    "pr_title",
    "pr_url"
  ]);
  if (!metadata.pr_url) {
    return commandMetadataResult();
  }
  return commandMetadataResult({
    metadata: {
      ...metadata,
      pr_source: normalizeText(metadata.pr_source) || (normalizeText(session.metadata?.source_pr_url) ? "stacked" : "created")
    }
  });
}

export {
  commitChangesSuccessMetadataFromFacts,
  createIssueSuccessMetadataFromFacts,
  createPrSuccessMetadataFromFacts,
  createWorktreeSuccessMetadataFromFacts,
  sourceMetadata
};
