import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  createPrOnGhTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/issuePr";
import {
  mergePrTerminalSpec
} from "@local/vibe64-adapters/server/workflowCommandTerminal/mergeSync";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function createGitRepository(root) {
  await execFileAsync("git", ["init"], {
    cwd: root
  });
}

test("create PR command treats an existing branch pull request as success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await createPrOnGhTerminalSpec({
      session: {
        artifactsRoot: path.join(targetRoot, ".vibe64", "artifacts"),
        metadata: {
          base_branch: "main",
          branch: "vibe64/test-session",
          worktree_path: targetRoot
        },
        metadataRoot: path.join(targetRoot, ".vibe64", "metadata"),
        sessionId: "test-session",
        targetRoot
      }
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.commandPreview, "gh pr create");

    const script = spec.args.at(-1);
    const lookupIndex = script.indexOf("find_existing_pull_request_url()");
    const createIndex = script.indexOf("gh pr create");
    assert.ok(lookupIndex > -1);
    assert.ok(createIndex > -1);
    assert.ok(lookupIndex < createIndex);
    assert.match(script, /gh pr list --head "\$EXPECTED_BRANCH" --base "\$BASE_BRANCH" --state open/u);
    assert.match(script, /GitHub pull request already exists/u);
    assert.match(script, /\.vibe64\/artifacts\/tmp\/create_pull_request\.title\.txt/u);
    assert.match(script, /\.vibe64\/artifacts\/tmp\/create_pull_request\.body\.md/u);
    assert.match(script, /vibe64_require_tmp_artifact title\.txt 'pull request title artifact'/u);
    assert.match(script, /vibe64_require_tmp_artifact body\.md 'pull request body artifact'/u);
    assert.match(script, /rm -f "\$\(vibe64_tmp_artifact_path title\.txt\)"/u);
    assert.match(script, /rm -f "\$\(vibe64_tmp_artifact_path body\.md\)"/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' pr_url/u);
    assert.match(script, /fact:set\\t%s\\t%s\\n' pr_title/u);
    assert.match(script, /if ! PR_URL="\$\(gh pr create/u);
  });
});

test("merge PR command does not write missing hook objects into the shell script", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      session: {
        metadata: {
          pr_url: "https://github.com/example/project/pull/12",
          worktree_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    assert.doesNotMatch(script, /\[object Object\]/u);
    assert.match(script, /gh pr merge https:\/\/github\.com\/example\/project\/pull\/12 --merge/u);
  });
});

test("merge PR command accepts structured before-merge hook scripts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createGitRepository(targetRoot);

    const spec = await mergePrTerminalSpec({
      hooks: {
        beforeMerge: async () => ({
          command: "npm run verify",
          intro: "Checking before merge."
        })
      },
      session: {
        metadata: {
          pr_url: "https://github.com/example/project/pull/12",
          worktree_path: targetRoot
        },
        targetRoot
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    const script = spec.args.at(-1);
    assert.match(script, /printf '\[studio\] Checking before merge\.\\n'/u);
    assert.match(script, /npm run verify/u);
    assert.match(script, /gh pr merge https:\/\/github\.com\/example\/project\/pull\/12 --merge/u);
  });
});
