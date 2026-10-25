// Release creates only tags, on the saved and pushed baseline. Under the project
// source lock it checks that the baseline is the commit the person reviewed, that
// it is pushed and that a working tree is clean, then creates every tag in one Git
// ref transaction that also verifies the baseline did not move.
import { runVibe64Command } from "@local/vibe64-execution/server";
import { runProjectSourceExclusive } from "@local/vibe64-project/server/projectSourceMutationLock";
import path from "node:path";

import { publishError } from "./errors.js";
import { COMMIT_ID, releaseGit } from "./git.js";
import { RELEASE_TAG } from "./release/version.js";

const REF = /^refs\/[A-Za-z0-9._/-]+$/u;

function refuse(code, message, details) {
  throw publishError(code, message, details);
}

async function tagSavedCommit({
  repositoryRoot,
  projectRuntimeRoot,
  baselineRef,
  upstreamRef,
  expectedCommit,
  tags
} = {}, {
  runCommand = runVibe64Command,
  runExclusive = runProjectSourceExclusive
} = {}) {
  const root = typeof repositoryRoot === "string" && path.isAbsolute(repositoryRoot) ? repositoryRoot : "";
  if (!root) refuse("VIBE64_PUBLISH_TAG_INVALID", "Tagging needs the absolute repository path.");
  if (!REF.test(baselineRef || "") || !REF.test(upstreamRef || "")) {
    refuse("VIBE64_PUBLISH_TAG_INVALID", "Tagging needs the baseline and upstream refs.");
  }
  if (!COMMIT_ID.test(expectedCommit || "")) refuse("VIBE64_PUBLISH_TAG_INVALID", "Tagging needs the full saved commit id.");
  if (!Array.isArray(tags) || !tags.length || tags.some((tag) => !RELEASE_TAG.test(tag || "")) || new Set(tags).size !== tags.length) {
    refuse("VIBE64_PUBLISH_TAG_INVALID", "Release tags look like v1.5.0 or package@1.5.0.");
  }

  const git = (args, options = {}) => releaseGit(root, args, { code: "VIBE64_PUBLISH_TAG_FAILED", maxBuffer: 2 * 1024 * 1024, runCommand, ...options });

  return runExclusive(projectRuntimeRoot, async () => {
    const baseline = await git(["rev-parse", "--verify", "--end-of-options", `${baselineRef}^{commit}`], { optional: true });
    if (baseline !== expectedCommit) {
      refuse("VIBE64_PUBLISH_BASELINE_MOVED", "The saved baseline changed since this release was planned. Review the new plan.", {
        expected: expectedCommit,
        actual: baseline || null
      });
    }
    if (await git(["rev-parse", "--is-bare-repository"]) !== "true") {
      const status = await git(["status", "--porcelain=v1", "--untracked-files=normal"]);
      if (status) refuse("VIBE64_PUBLISH_UNSAVED_WORK", "The project has unsaved changes. Save them before releasing.");
    }
    const upstream = await git(["rev-parse", "--verify", "--end-of-options", `${upstreamRef}^{commit}`], { optional: true });
    if (!upstream || await git(["merge-base", "--is-ancestor", expectedCommit, upstream], { optional: true }) === null) {
      refuse("VIBE64_PUBLISH_UNPUSHED", "The saved baseline is not pushed yet. Push it before releasing.");
    }

    const created = [];
    const existing = [];
    for (const tag of tags) {
      await git(["check-ref-format", `refs/tags/${tag}`]);
      const current = await git(["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/tags/${tag}^{commit}`], { optional: true });
      if (!current) created.push(tag);
      else if (current === expectedCommit) existing.push(tag);
      else refuse("VIBE64_PUBLISH_TAG_CONFLICT", `Tag ${tag} already points at another commit. Choose a new version.`, { tag, commit: current });
    }
    if (created.length) {
      // One transaction: the baseline must still be the expected commit and no tag may exist.
      await git(["update-ref", "--stdin"], {
        stdin: [
          "start",
          `verify ${baselineRef} ${expectedCommit}`,
          ...created.map((tag) => `create refs/tags/${tag} ${expectedCommit}`),
          "commit",
          ""
        ].join("\n")
      });
    }
    return { commit: expectedCommit, created, existing };
  });
}

export { tagSavedCommit };
