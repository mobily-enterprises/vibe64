import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  checkpointRefs,
  createGitTurnCheckpoint,
  writeGitWorktreeTree
} from "../../packages/vibe64-execution/src/server/gitTurnCheckpoint.js";
import {
  runVibe64Command
} from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

const execFileAsync = promisify(execFile);

test("turn checkpoints capture the complete saveable tree without changing the branch, index, or worktree", async () => {
  const root = await createRepository();
  try {
    const headBefore = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
    await writeFile(path.join(root, "untracked.txt"), "new\n", "utf8");
    const statusBefore = await git(root, ["status", "--porcelain=v1"]);
    const result = await createGitTurnCheckpoint({
      outerTurnId: "client-message-1",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    });

    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(await git(root, ["rev-parse", "HEAD"]), headBefore);
    assert.equal(await git(root, ["status", "--porcelain=v1"]), statusBefore);
    assert.equal(await git(root, ["show", `${result.commit}:tracked.txt`]), "changed");
    assert.equal(await git(root, ["show", `${result.commit}:untracked.txt`]), "new");
    assert.equal(await git(root, ["rev-parse", result.latestRef]), result.commit);
    assert.equal((await readFile(path.join(root, "tracked.txt"), "utf8")), "changed\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("turn checkpoint retries are object-identical and a later turn advances latest", async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, "tracked.txt"), "turn one\n", "utf8");
    const input = {
      outerTurnId: "client-message-1",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    };
    const first = await createGitTurnCheckpoint(input);
    const retry = await createGitTurnCheckpoint(input);
    assert.equal(retry.created, false);
    assert.equal(retry.commit, first.commit);

    await writeFile(path.join(root, "tracked.txt"), "turn two\n", "utf8");
    const second = await createGitTurnCheckpoint({
      ...input,
      outerTurnId: "provider-successor-independent-outer-turn",
      timestamp: "2026-08-18T09:05:00.000Z"
    });
    assert.notEqual(second.commit, first.commit);
    assert.equal(second.baseCommit, first.commit);
    assert.equal(await git(root, ["rev-parse", second.latestRef]), second.commit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("checkpoint publication retries a competing latest ref without losing either turn or changing source", async () => {
  const root = await createRepository();
  try {
    const input = { outerTurnId: "repair", outcome: "completed", sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z", worktreePath: root };
    const previous = await createGitTurnCheckpoint({ ...input, outerTurnId: "previous" });
    await writeFile(path.join(root, "tracked.txt"), "repaired work\n", "utf8");
    const head = await git(root, ["rev-parse", "HEAD"]);
    const status = await git(root, ["status", "--porcelain=v1"]);
    let competingCommit;
    let publications = 0;
    const checkpoint = await createGitTurnCheckpoint({ ...input, runCommand: async (request) => {
      if (request.args[0] === "update-ref" && request.args[1] === "--stdin") {
        publications += 1;
        if (publications === 1) {
          competingCommit = await git(root, ["commit-tree", `${head}^{tree}`, "-p", previous.commit, "-m", "Another completed turn"]);
          const competingRefs = checkpointRefs({ ...input, outerTurnId: "competing" });
          await git(root, ["update-ref", competingRefs.turnRef, competingCommit]);
          await git(root, ["update-ref", competingRefs.latestRef, competingCommit, previous.commit]);
        }
      }
      return runVibe64Command(request);
    } });
    assert.equal(publications, 2);
    assert.equal(checkpoint.baseCommit, competingCommit);
    assert.equal(await git(root, ["rev-parse", checkpoint.latestRef]), checkpoint.commit);
    assert.equal(await git(root, ["rev-parse", checkpoint.turnRef]), checkpoint.commit);
    assert.equal(await git(root, ["show", `${checkpoint.commit}:tracked.txt`]), "repaired work");
    assert.equal(await git(root, ["rev-parse", `${checkpoint.commit}^^`]), previous.commit);
    assert.equal(await git(root, ["rev-parse", "HEAD"]), head);
    assert.equal(await git(root, ["status", "--porcelain=v1"]), status);
    assert.equal((await createGitTurnCheckpoint(input)).commit, checkpoint.commit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("checkpoint publication leaves no partial turn ref and does not retry an unrelated Git failure", async () => {
  const root = await createRepository();
  try {
    const input = { outerTurnId: "repair", sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z", worktreePath: root };
    let publications = 0;
    await assert.rejects(createGitTurnCheckpoint({ ...input, runCommand: async (request) => {
      if (request.args[0] === "update-ref") {
        publications += 1;
        return { ok: false, stderr: "Permission denied" };
      }
      return runVibe64Command(request);
    } }), /Permission denied/);
    assert.equal(publications, 1);
    assert.equal(await git(root, ["for-each-ref", "--format=%(refname)", "refs/vibe64/checkpoints"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("later checkpoints drop files that became ignored without removing them from the worktree", async () => {
  const root = await createRepository();
  try {
    const localPath = path.join(root, "local.bin");
    await writeFile(localPath, "local only\n", "utf8");
    const first = await createGitTurnCheckpoint({
      outerTurnId: "client-message-1",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    });
    assert.equal(await git(root, ["show", `${first.commit}:local.bin`]), "local only");

    await writeFile(path.join(root, ".gitignore"), "/local.bin\n", "utf8");
    const second = await createGitTurnCheckpoint({
      outerTurnId: "client-message-2",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:05:00.000Z",
      worktreePath: root
    });

    assert.equal(second.baseCommit, first.commit);
    await assert.rejects(git(root, ["cat-file", "-e", `${second.commit}:local.bin`]));
    assert.equal(await readFile(localPath, "utf8"), "local only\n");
    assert.equal(await git(root, ["show", `${second.commit}:.gitignore`]), "/local.bin");
    assert.equal(second.tree, await writeGitWorktreeTree({
      baseCommit: "HEAD",
      worktreePath: root
    }));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a worktree tree can overlay only selected resolution paths onto a prepared tree", async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, "canonical-only.txt"), "canonical\n", "utf8");
    await git(root, ["add", "canonical-only.txt"]);
    const preparedTree = await git(root, ["write-tree"]);
    await git(root, ["reset", "--", "canonical-only.txt"]);
    await writeFile(path.join(root, "tracked.txt"), "resolved\n", "utf8");
    await writeFile(path.join(root, "canonical-only.txt"), "old worktree\n", "utf8");

    const result = await writeGitWorktreeTree({
      baseCommit: preparedTree,
      paths: ["tracked.txt"],
      worktreePath: root
    });

    assert.equal(await git(root, ["show", `${result}:tracked.txt`]), "resolved");
    assert.equal(await git(root, ["show", `${result}:canonical-only.txt`]), "canonical");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("turn checkpoint refs use safe digests and invalid identities fail closed", async () => {
  const refs = checkpointRefs({
    outerTurnId: "message/with spaces",
    sessionId: "session:with:punctuation"
  });
  assert.match(refs.turnRef, /^refs\/vibe64\/checkpoints\/[a-f0-9]{32}\/[a-f0-9]{32}$/u);
  await assert.rejects(createGitTurnCheckpoint({
    outerTurnId: "bad\nturn",
    outcome: "completed",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:00.000Z",
    worktreePath: "/tmp"
  }), { code: "vibe64_checkpoint_outerturnid_invalid" });
});

test("whole-worktree checkpoint staging is serialized per worktree", async () => {
  const root = await createRepository();
  let activeAdds = 0;
  let maximumConcurrentAdds = 0;
  const runCommand = async (request) => {
    if (request.args?.[0] === "add") {
      activeAdds += 1;
      maximumConcurrentAdds = Math.max(maximumConcurrentAdds, activeAdds);
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        return await runVibe64Command(request);
      } finally {
        activeAdds -= 1;
      }
    }
    return runVibe64Command(request);
  };
  try {
    await writeFile(path.join(root, "tracked.txt"), "serialized\n", "utf8");

    const trees = await Promise.all([
      writeGitWorktreeTree({ runCommand, worktreePath: root }),
      writeGitWorktreeTree({ runCommand, worktreePath: root })
    ]);

    assert.equal(maximumConcurrentAdds, 1);
    assert.equal(trees[0], trees[1]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("checkpoint disk budget ignores ignored files and names oversized unignored candidates", async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, ".gitignore"), "/ignored.bin\n", "utf8");
    await writeFile(path.join(root, "ignored.bin"), "i".repeat(1024), "utf8");
    await writeGitWorktreeTree({
      temporaryDiskBudgetBytes: 128,
      temporaryDiskReserveBytes: 0,
      worktreePath: root
    });

    await writeFile(path.join(root, "unignored.bin"), "u".repeat(1024), "utf8");
    await assert.rejects(writeGitWorktreeTree({
      temporaryDiskBudgetBytes: 128,
      temporaryDiskReserveBytes: 0,
      worktreePath: root
    }), (error) => {
      assert.equal(error.code, "vibe64_checkpoint_disk_budget_exceeded");
      assert.match(error.message, /unignored\.bin/u);
      assert.doesNotMatch(error.message, /(?:^|[ ,])ignored\.bin \(/u);
      assert.match(error.message, /\.gitignore/u);
      return true;
    });
    const checkpointEntries = await readdir(path.join(root, ".git", "vibe64-checkpoints"));
    assert.equal(checkpointEntries.some((name) => name.startsWith(".tree-")), false);
    assert.equal(await readFile(path.join(root, "unignored.bin"), "utf8"), "u".repeat(1024));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-turn-checkpoint-"));
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Vibe64 Test"]);
  await git(root, ["config", "user.email", "vibe64@example.test"]);
  await writeFile(path.join(root, "tracked.txt"), "base\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "base"]);
  return root;
}

async function git(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return String(result.stdout || "").trim();
}
