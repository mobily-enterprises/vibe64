import {
  normalizeText
} from "../core.js";

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

function worktreeMetadata({
  baseBranch = "",
  baseCommit = "",
  branch = "",
  worktreePath = ""
} = {}) {
  return {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    worktree_path: worktreePath
  };
}

function createWorktreeSuccessMetadataFromFacts({ facts = {}, session = {} } = {}) {
  if (normalizeText(session.metadata?.work_source) !== "existing_pr") {
    return commandMetadataResult();
  }

  const updateMode = normalizeText(facts.source_pr_update_mode);
  if (updateMode === "direct") {
    return commandMetadataResult({
      metadata: {
        pr_source: "existing",
        pr_url: normalizeText(facts.pr_url) || normalizeText(session.metadata?.source_pr_url),
        source_pr_update_mode: "direct"
      }
    });
  }

  if (updateMode === "replacement") {
    return commandMetadataResult({
      deleteMetadata: ["pr_url"],
      metadata: {
        source_pr_update_mode: "replacement"
      }
    });
  }

  return commandMetadataResult();
}

function commitChangesSuccessMetadataFromFacts({ facts = {} } = {}) {
  return commandMetadataResult({
    metadata: metadataFromFacts(facts, [
      "accepted_commit",
      "branch_pushed"
    ])
  });
}

function createIssueSuccessMetadataFromFacts({ facts = {} } = {}) {
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
      issue_source: "created",
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
      pr_source: normalizeText(metadata.pr_source) || (normalizeText(session.metadata?.source_pr_url) ? "replacement" : "created")
    }
  });
}

export {
  commitChangesSuccessMetadataFromFacts,
  createIssueSuccessMetadataFromFacts,
  createPrSuccessMetadataFromFacts,
  createWorktreeSuccessMetadataFromFacts,
  worktreeMetadata
};
