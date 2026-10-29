import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  checkpointRefs,
  createGitTurnCheckpoint,
  createGitTurnCheckpointAsOneJob,
  writeGitWorktreeTree
} from "../../packages/vibe64-execution/src/server/gitTurnCheckpoint.js";
import {
  runVibe64Command
} from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { RUNTIME_ENTRIES } from "../../tooling/release/runtime-package.mjs";

const execFileAsync = promisify(execFile);

// The daemon checkpoints a turn as one job; Save and Update run the same
// sequence directly inside their own job. Both must give the same result.
async function checkpointAsOneJob(input = {}) {
  const requests = [];
  try {
    return await createGitTurnCheckpointAsOneJob({ ...input, runCommand: (request) => {
      requests.push(request);
      return runVibe64Command(request);
    } });
  } finally {
    assert.equal(requests.length, 1, "a turn checkpoint ran more than one job");
  }
}

const CHECKPOINT_ENTRY_POINTS = [
  ["in this process", createGitTurnCheckpoint],
  ["as one job", checkpointAsOneJob]
];

for (const [entry, create] of CHECKPOINT_ENTRY_POINTS) {
  test(`turn checkpoints capture the complete saveable tree without changing the branch, index, or worktree (${entry})`, async () => {
    const root = await createRepository();
    try {
      const headBefore = await git(root, ["rev-parse", "HEAD"]);
      await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
      await writeFile(path.join(root, "untracked.txt"), "new\n", "utf8");
      const statusBefore = await git(root, ["status", "--porcelain=v1"]);
      const result = await create({
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
}

for (const [entry, create] of CHECKPOINT_ENTRY_POINTS) {
  test(`turn checkpoint retries are object-identical and a later turn advances latest (${entry})`, async () => {
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
      const first = await create(input);
      const retry = await create(input);
      assert.equal(retry.created, false);
      assert.equal(retry.commit, first.commit);

      await writeFile(path.join(root, "tracked.txt"), "turn two\n", "utf8");
      const second = await create({
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
}

for (const [entry, create] of CHECKPOINT_ENTRY_POINTS) {
  test(`terminal outcome changes reuse the original checkpoint and retain its recorded outcome (${entry})`, async () => {
    const root = await createRepository();
    try {
      const input = { sessionId: "session-1", outerTurnId: "failed-claude-turn", outcome: "failed",
        timestamp: "2026-10-10T02:23:47.000Z", worktreePath: root };
      await writeFile(path.join(root, "tracked.txt"), "work before credit exhaustion\n");
      const first = await create(input);
      await writeFile(path.join(root, "tracked.txt"), "later work must not replace the snapshot\n");
      const later = await create({ ...input, outerTurnId: "later-turn", outcome: "completed" });
      const status = await git(root, ["status", "--porcelain=v1"]);
      const head = await git(root, ["rev-parse", "HEAD"]);
      for (const outcome of ["interrupted", "cancelled", "completed", "failed"]) {
        const retry = await create({ ...input, outcome, timestamp: "2026-10-10T02:23:49.000Z" });
        assert.equal(retry.commit, first.commit);
        assert.equal(retry.tree, first.tree);
        assert.equal(retry.created, false);
        assert.equal(retry.outcome, "failed");
        assert.equal(await git(root, ["rev-parse", retry.latestRef]), later.commit);
        assert.equal(await git(root, ["status", "--porcelain=v1"]), status);
        assert.equal(await git(root, ["rev-parse", "HEAD"]), head);
        assert.equal(await git(root, ["show", `${retry.commit}:tracked.txt`]), "work before credit exhaustion");
      }
    } finally { await rm(root, { force: true, recursive: true }); }
  });
}

for (const [entry, create] of CHECKPOINT_ENTRY_POINTS) {
  test(`checkpoint retries still reject a different session, turn or malformed recorded outcome (${entry})`, async () => {
    const root = await createRepository();
    try {
      const input = { sessionId: "session-1", outerTurnId: "turn-1", outcome: "failed",
        timestamp: "2026-10-10T02:23:47.000Z", worktreePath: root };
      const first = await create(input);
      const message = await git(root, ["show", "-s", "--format=%B", first.commit]);
      for (const corrupt of [message.replaceAll("session-1", "session-2"), message.replaceAll("turn-1", "turn-2"),
        message.replace("Vibe64-Turn-Outcome: failed", "Vibe64-Turn-Outcome: unknown")]) {
        const impostor = await git(root, ["commit-tree", first.tree, "-p", first.baseCommit, "-m", corrupt]);
        await git(root, ["update-ref", first.turnRef, impostor]);
        await assert.rejects(create({ ...input, outcome: "interrupted" }),
          { code: "vibe64_checkpoint_identity_mismatch" });
        assert.equal(await git(root, ["rev-parse", first.turnRef]), impostor);
        assert.equal(await git(root, ["rev-parse", first.latestRef]), first.commit);
      }
    } finally { await rm(root, { force: true, recursive: true }); }
  });
}

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

test("selected conflict paths are literal filenames, never Git pathspecs", async () => {
  const root = await createRepository();
  try {
    const selected = ["file[1].txt", ":(glob)*"];
    for (const name of [...selected, "file1.txt"]) await writeFile(path.join(root, name), "original\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Literal path fixtures"]);
    for (const name of selected) await writeFile(path.join(root, name), "resolved\n");
    await writeFile(path.join(root, "file1.txt"), "unrelated staged work\n");
    await git(root, ["add", "file1.txt"]);
    const index = await git(root, ["write-tree"]);
    const status = await git(root, ["status", "--porcelain"]);
    const tree = await writeGitWorktreeTree({ paths: selected, worktreePath: root });
    for (const name of selected) assert.equal(await git(root, ["show", tree + ":" + name]), "resolved");
    assert.equal(await git(root, ["show", tree + ":file1.txt"]), "original");
    assert.equal(await git(root, ["write-tree"]), index);
    assert.equal(await git(root, ["status", "--porcelain"]), status);
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

test("a one-job checkpoint commits under the identity the daemon resolved for that job", async () => {
  const root = await createRepository();
  try {
    const result = await checkpointAsOneJob({
      outerTurnId: "identity-turn",
      project: { gitIdentity: { email: "bot@example.test", name: "Project Bot" } },
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    });
    // Seconds since the epoch: Git versions spell UTC as "+00:00" or "Z".
    assert.equal(await git(root, ["show", "-s", "--format=%an <%ae>|%cn <%ce>|%at", result.commit]),
      `Project Bot <bot@example.test>|Project Bot <bot@example.test>|${Date.parse("2026-08-18T09:00:00.000Z") / 1000}`);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a one-job checkpoint keeps the disk budget refusal and leaves no temporary index", async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, "unignored.bin"), "u".repeat(1024), "utf8");
    await assert.rejects(checkpointAsOneJob({
      outerTurnId: "too-big",
      sessionId: "session-1",
      temporaryDiskBudgetBytes: 128,
      temporaryDiskReserveBytes: 0,
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    }), (error) => {
      assert.equal(error.code, "vibe64_checkpoint_disk_budget_exceeded");
      assert.match(error.message, /unignored\.bin \(1024 bytes\)/u);
      return true;
    });
    assert.deepEqual((await readdir(path.join(root, ".git", "vibe64-checkpoints"))).filter((name) => name.startsWith(".tree-")), []);
    assert.equal(await git(root, ["for-each-ref", "--format=%(refname)", "refs/vibe64/checkpoints"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a job the host refused, killed or could not drain fails the checkpoint with the host's own words", async () => {
  const input = { outerTurnId: "turn-1", sessionId: "session-1", timestamp: "2026-08-18T09:00:00.000Z", worktreePath: "/tmp" };
  const finished = JSON.stringify({ ok: true, value: { ok: true, commit: "a".repeat(40) } });
  const hostFailures = [
    { code: "vibe64_capacity_rejected", error: "Vibe64 is too busy to start this work now." },
    { code: "vibe64_execution_oom_killed", stderr: "An out-of-memory kill stopped the managed command.", stdout: finished },
    { code: "vibe64_execution_cleanup_required", stderr: "The execution failed and its resource scope could not be proven empty." },
    { code: "vibe64_execution_drain_failed", error: "The managed execution could not be stopped and drained.", stdout: finished },
    { code: "vibe64_command_capture_timed_out", error: "Command timed out after 120000 milliseconds" }
  ];
  for (const failure of hostFailures) {
    await assert.rejects(createGitTurnCheckpointAsOneJob({ ...input, runCommand: async () => ({ ok: false, ...failure }) }), {
      code: failure.code,
      message: failure.stderr || failure.error
    });
  }
});

test("a checkpoint job killed mid-run leaves no temporary index after the next checkpoint", async (t) => {
  const root = await createRepository();
  const bin = await mkdtemp(path.join(os.tmpdir(), "vibe64-checkpoint-git-"));
  t.after(() => Promise.all([root, bin].map((directory) => rm(directory, { force: true, recursive: true }))));
  const staging = path.join(bin, "staging");
  // A git that holds `add` until the test kills it, recording its pid first.
  await writeFile(path.join(bin, "git"), [
    "#!/bin/sh",
    `if [ "$1" = add ] && [ ! -e '${staging}' ]; then echo $$ > '${staging}'; exec sleep 60; fi`,
    `exec '${(await execFileAsync("sh", ["-c", "command -v git"])).stdout.trim()}' "$@"`,
    ""
  ].join("\n"), { mode: 0o755 });
  const input = { outerTurnId: "killed-turn", sessionId: "session-1", timestamp: "2026-08-18T09:00:00.000Z", worktreePath: root };
  await writeFile(path.join(root, "tracked.txt"), "work in progress\n", "utf8");
  // Run the job's command as the gateway would, then SIGKILL it once it stages.
  await assert.rejects(createGitTurnCheckpointAsOneJob({ ...input, runCommand: (request) => new Promise((resolve) => {
    const child = spawn(process.execPath, request.args, {
      cwd: request.cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: ["pipe", "pipe", "ignore"]
    });
    child.stdin.end(request.input);
    const poll = setInterval(async () => {
      const pid = Number((await readFile(staging, "utf8").catch(() => "")).trim());
      if (!pid) return;
      clearInterval(poll);
      child.kill("SIGKILL");
      process.kill(pid, "SIGKILL");
    }, 20);
    child.once("close", () => {
      clearInterval(poll);
      resolve({ code: "vibe64_command_capture_failed", error: "Command was killed with SIGKILL", ok: false });
    });
  }) }), { code: "vibe64_command_capture_failed" });
  const checkpointRoot = path.join(root, ".git", "vibe64-checkpoints");
  const leftovers = (await readdir(checkpointRoot)).filter((name) => name.startsWith(".tree-"));
  assert.equal(leftovers.length, 1, "the killed run kept its temporary index");

  // Some time later the next checkpoint runs; a tree write in progress elsewhere is kept.
  const killedAt = new Date(Date.now() - 16 * 60_000);
  await utimes(path.join(checkpointRoot, leftovers[0]), killedAt, killedAt);
  await mkdir(path.join(checkpointRoot, ".tree-live"));
  const next = await checkpointAsOneJob(input);
  assert.equal(next.created, true);
  assert.equal(await git(root, ["show", `${next.commit}:tracked.txt`]), "work in progress");
  assert.deepEqual((await readdir(checkpointRoot)).filter((name) => name.startsWith(".tree-")), [".tree-live"]);
});

test("the checkpoint job's command ships in the release runtime", () => {
  assert.ok(RUNTIME_ENTRIES.includes("node_modules/@local/vibe64-execution/src/server/gitTurnCheckpointCommand.js"));
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
