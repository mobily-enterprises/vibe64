import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  inspectRepositoryHistory,
  repositoryReadContext,
  repositoryVersionFileDiff,
  repositoryVersionFiles
} from "../../packages/vibe64-terminals/src/server/repositoryHistory.js";
import { commandResult } from "../../packages/vibe64-execution/src/server/result.js";

const execFileAsync = promisify(execFile);
const identity = {
  GIT_AUTHOR_EMAIL: "history@example.test",
  GIT_AUTHOR_NAME: "History Test",
  GIT_COMMITTER_EMAIL: "history@example.test",
  GIT_COMMITTER_NAME: "History Test"
};

async function git(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...identity }
  });
  return String(result.stdout || "").trim();
}

async function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: { ...process.env, ...identity, ...(request.env || {}) }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({ error: error.message, ok: false, stderr, stdout }));
    child.once("close", (code) => resolve({ ok: code === 0, exitCode: code, stderr, stdout }));
    child.stdin.end(request.input ?? undefined);
  });
}

function localProject(root) {
  return {
    repository: { defaultBranch: "main", mode: "local_source" },
    repositoryMode: "local_source",
    sourceRoot: root
  };
}

test("a session without a source never falls through to a project repository cache", () => {
  assert.throws(() => repositoryReadContext({
    githubMirrorPath: "/missing/github-mirror/repository.git",
    path: "/project",
    repository: { defaultBranch: "main", mode: "github" },
    repositoryMode: "github"
  }, {
    metadata: { base_branch: "main" },
    sessionId: "session-1"
  }), (error) => error.code === "vibe64_repository_history_session_source_missing");
});

test("hosted history uses repository storage and never the hosted namespace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-hosted-history-"));
  const hostedNamespace = path.join(root, "namespace");
  const repositoryStorageRoot = path.join(root, "runtime", "github-mirror");
  const repositoryPath = path.join(repositoryStorageRoot, "repository.git");
  try {
    await mkdir(path.join(hostedNamespace, ".git"), { recursive: true });
    await writeFile(path.join(hostedNamespace, ".git", "HOSTILE"), "untouched\n", "utf8");
    await mkdir(repositoryStorageRoot, { recursive: true });
    await git(repositoryStorageRoot, ["init", "--bare", repositoryPath]);

    const requests = [];
    const context = repositoryReadContext({
      githubMirrorPath: repositoryPath,
      path: hostedNamespace,
      projectRoot: hostedNamespace,
      repository: { defaultBranch: "main", mode: "github" },
      repositoryMode: "github"
    });
    assert.equal(context.cwd, repositoryStorageRoot);
    assert.equal(context.executionRoot, repositoryStorageRoot);

    await assert.rejects(inspectRepositoryHistory({
      project: {
        githubMirrorPath: repositoryPath,
        path: hostedNamespace,
        projectRoot: hostedNamespace,
        repository: { defaultBranch: "main", mode: "github" },
        repositoryMode: "github"
      },
      runCommand: async (request) => {
        requests.push(request);
        return { ok: false, stderr: "missing branch" };
      }
    }));
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.cwd !== hostedNamespace));
    assert.ok(requests.every((request) => !request.allowedRoots.includes(hostedNamespace)));
    assert.equal(await readFile(path.join(hostedNamespace, ".git", "HOSTILE"), "utf8"), "untouched\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("version history pins pagination and exposes bounded per-version files and diffs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-"));
  const managedSourceRoot = `${root}-managed-sources`;
  try {
    await git(root, ["init", "--initial-branch=main"]);
    await writeFile(path.join(root, "first.txt"), "first\n", "utf8");
    await git(root, ["add", "first.txt"]);
    await git(root, ["commit", "-m", "first version"]);
    const rootCommit = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "second.txt"), "second\n", "utf8");
    await git(root, ["add", "second.txt"]);
    await git(root, ["commit", "-m", "<script>not markup</script>"]);
    const secondCommit = await git(root, ["rev-parse", "HEAD"]);
    const sessionSourceRoot = path.join(managedSourceRoot, "sessions", "active", "session-1", "source");
    await mkdir(path.dirname(sessionSourceRoot), { recursive: true });
    await git(path.dirname(sessionSourceRoot), ["clone", root, sessionSourceRoot]);

    const firstPage = await inspectRepositoryHistory({
      limit: 1,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.equal(firstPage.versions.length, 1);
    assert.equal(firstPage.versions[0].commit, secondCommit);
    assert.equal(firstPage.versions[0].message, "<script>not markup</script>");
    assert.equal(firstPage.hasMore, true);

    await writeFile(path.join(root, "later.txt"), "later\n", "utf8");
    await git(root, ["add", "later.txt"]);
    await git(root, ["commit", "-m", "later version"]);

    const sessionHistory = await inspectRepositoryHistory({
      project: localProject(root),
      runCommand: commandRunner,
      session: {
        metadata: {
          base_branch: "main",
          base_commit: rootCommit,
          canonical_commit: secondCommit,
          repository_mode: "local_source",
          source_kind: "session_clone",
          source_path: sessionSourceRoot,
          source_path_authority: "managed_session_source"
        },
        projectContextRoot: root,
        sessionId: "session-1",
        sessionRoot: path.join(path.dirname(root), "runtime", "session-1"),
        sourcePath: sessionSourceRoot
      }
    });
    assert.equal(sessionHistory.historySnapshotCommit, secondCommit);
    assert.equal(sessionHistory.versions[0].commit, secondCommit);

    const secondPage = await inspectRepositoryHistory({
      cursor: firstPage.nextCursor,
      limit: 1,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.equal(secondPage.historySnapshotCommit, secondCommit);
    assert.equal(secondPage.versions[0].commit, rootCommit);
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.nextCursor, "");

    const files = await repositoryVersionFiles({
      commit: rootCommit,
      historySnapshotCommit: firstPage.historySnapshotCommit,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.deepEqual(files.files, [{
      added: 1,
      deleted: 0,
      path: "first.txt",
      status: "A"
    }]);

    const diff = await repositoryVersionFileDiff({
      commit: rootCommit,
      historySnapshotCommit: firstPage.historySnapshotCommit,
      path: "first.txt",
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.match(diff.diff, /\+first/u);

    const unrelated = await git(root, ["commit-tree", `${rootCommit}^{tree}`, "-m", "unrelated"]);
    for (const [label, inspect] of [["files", repositoryVersionFiles], ["diff", repositoryVersionFileDiff]]) {
      await t.test(`${label} rejects unreachable commits, revision names and unpinned snapshots`, async () => {
        const input = {
          commit: rootCommit,
          historySnapshotCommit: firstPage.historySnapshotCommit,
          path: "first.txt",
          project: localProject(root),
          runCommand: commandRunner
        };
        await assert.rejects(inspect({ ...input, commit: unrelated }), {
          code: "vibe64_repository_history_commit_unreachable"
        });
        await assert.rejects(inspect({ ...input, commit: "HEAD" }), {
          code: "vibe64_repository_history_commit_invalid"
        });
        await assert.rejects(inspect({ ...input, historySnapshotCommit: "refs/heads/main" }), {
          code: "vibe64_repository_history_snapshot_invalid"
        });
      });
    }
  } finally {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      rm(managedSourceRoot, { force: true, recursive: true })
    ]);
  }
});

test("history cursors and version snapshots cannot select another project's repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-project-scope-"));
  try {
    const fixtures = [];
    for (const label of ["alpha", "beta"]) {
      const projectRoot = path.join(root, label);
      const sessionId = `history-${label}`;
      const sourceRoot = path.join(projectRoot, "sessions", "active", sessionId, "source");
      await mkdir(sourceRoot, { recursive: true });
      await git(sourceRoot, ["init", "--initial-branch=main"]);
      await writeFile(path.join(sourceRoot, "version.txt"), `${label} private version\n`, "utf8");
      await git(sourceRoot, ["add", "version.txt"]);
      await git(sourceRoot, ["commit", "-m", `${label} version`]);
      if (label === "beta") {
        await writeFile(path.join(sourceRoot, "version.txt"), "beta later version\n", "utf8");
        await git(sourceRoot, ["commit", "-am", "beta later version"]);
      }
      const commit = await git(sourceRoot, ["rev-parse", "HEAD"]);
      fixtures.push({
        commit,
        sourceRoot,
        project: localProject(projectRoot),
        session: {
          metadata: {
            canonical_commit: commit,
            source_kind: "session_clone",
            source_path: sourceRoot,
            source_path_authority: "managed_session_source"
          },
          projectContextRoot: projectRoot,
          sessionId
        }
      });
    }
    const [alpha, beta] = fixtures;
    assert.notEqual(alpha.commit, beta.commit);
    const foreignHistory = await inspectRepositoryHistory({ ...beta, limit: 1, runCommand: commandRunner });
    assert.equal(foreignHistory.historySnapshotCommit, beta.commit);
    assert.equal(foreignHistory.hasMore, true);
    assert.ok(foreignHistory.nextCursor);

    for (const [operation, inspect, foreignInput] of [
      ["history", inspectRepositoryHistory, { cursor: foreignHistory.nextCursor }],
      ["files", repositoryVersionFiles, { historySnapshotCommit: foreignHistory.historySnapshotCommit }],
      ["diff", repositoryVersionFileDiff, { historySnapshotCommit: foreignHistory.historySnapshotCommit, path: "version.txt" }]
    ]) {
      await t.test(`${operation} resolves foreign snapshots only inside the selected session repository`, async () => {
        const requests = [];
        await assert.rejects(inspect({
          ...alpha,
          ...foreignInput,
          runCommand: async (request) => {
            requests.push(request);
            return commandRunner(request);
          }
        }), { code: "vibe64_repository_history_failed" });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].cwd, alpha.sourceRoot);
        assert.deepEqual(requests[0].allowedRoots, [alpha.sourceRoot]);
        assert.deepEqual(requests[0].args, ["rev-parse", "--verify", `${beta.commit}^{commit}`]);
      });
    }

    await t.test("the selected session's own history, files and diff remain readable", async () => {
      const requests = [];
      const input = {
        ...alpha,
        historySnapshotCommit: alpha.commit,
        runCommand: async (request) => {
          requests.push(request);
          return commandRunner(request);
        }
      };
      const history = await inspectRepositoryHistory(input);
      assert.deepEqual(history.versions.map((version) => version.commit), [alpha.commit]);
      const files = await repositoryVersionFiles(input);
      assert.deepEqual(files.files.map((file) => file.path), ["version.txt"]);
      const diff = await repositoryVersionFileDiff({ ...input, path: "version.txt" });
      assert.ok(diff.diff.split("\n").includes("+alpha private version"));
      assert.equal(diff.diff.includes("beta"), false);
      assert.ok(requests.every((request) => request.cwd === alpha.sourceRoot));
      assert.ok(requests.every((request) => request.allowedRoots.length === 1 && request.allowedRoots[0] === alpha.sourceRoot));
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("merge history follows its first parent and pages renamed, binary and truncated text changes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-merge-"));
  try {
    await git(root, ["init", "--initial-branch=main"]);
    await writeFile(path.join(root, "original.txt"), "retained rename content\n", "utf8");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "base"]);
    const baseCommit = await git(root, ["rev-parse", "HEAD"]);

    await git(root, ["checkout", "-b", "topic"]);
    await git(root, ["mv", "original.txt", "renamed.txt"]);
    await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(root, "notes.txt"), Array.from({ length: 12 }, (_, index) => `note ${index + 1}\n`).join(""));
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "topic changes"]);
    const topicCommit = await git(root, ["rev-parse", "HEAD"]);

    await git(root, ["checkout", "main"]);
    await writeFile(path.join(root, "main-only.txt"), "main parent content\n", "utf8");
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "main changes"]);
    const firstParent = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["merge", "--no-ff", "topic", "-m", "merge topic"]);
    const mergeCommit = await git(root, ["rev-parse", "HEAD"]);

    const requests = [];
    const input = {
      project: localProject(root),
      runCommand: async (request) => {
        requests.push(request);
        return commandResult(await commandRunner(request));
      }
    };
    const history = await inspectRepositoryHistory(input);
    assert.deepEqual(history.versions.map((version) => version.commit), [mergeCommit, firstParent, baseCommit]);
    assert.equal(history.versions[0].isMerge, true);
    assert.deepEqual(history.versions[0].parents, [firstParent, topicCommit]);
    assert.equal(history.hasMore, false);
    assert.equal(history.nextCursor, "");
    const versionInput = { ...input, commit: mergeCommit, historySnapshotCommit: history.historySnapshotCommit };

    await t.test("file pages retain first-parent rename and binary facts through the terminal page", async () => {
      const first = await repositoryVersionFiles({ ...versionInput, limit: 2 });
      const last = await repositoryVersionFiles({ ...versionInput, limit: 2, offset: first.files.length });
      for (const page of [first, last]) {
        assert.equal(page.commit, mergeCommit);
        assert.equal(page.historySnapshotCommit, mergeCommit);
        assert.equal(page.parent, firstParent);
        assert.equal(page.totalCount, 3);
        assert.equal(page.limit, 2);
      }
      assert.equal(first.offset, 0);
      assert.equal(first.files.length, 2);
      assert.equal(first.truncated, true);
      assert.equal(last.offset, 2);
      assert.equal(last.files.length, 1);
      assert.equal(last.truncated, false);
      assert.deepEqual([...first.files, ...last.files], [
        { added: null, deleted: null, path: "binary.bin", status: "A" },
        { added: 12, deleted: 0, path: "notes.txt", status: "A" },
        { added: 0, deleted: 0, path: "renamed.txt", previousPath: "original.txt", status: "R" }
      ]);
    });

    await t.test("text truncation reports the full line count and only the requested prefix", async () => {
      const full = await repositoryVersionFileDiff({ ...versionInput, path: "notes.txt" });
      assert.equal(full.parent, firstParent);
      assert.equal(full.truncated, false);
      assert.match(full.diff, /^@@ -0,0 \+1,12 @@$/mu);
      const native = await execFileAsync("git", [
        "diff", "--no-ext-diff", "--find-renames", "--unified=3", firstParent, mergeCommit, "--", "notes.txt"
      ], { cwd: root, encoding: "utf8" });
      assert.equal(full.diff, native.stdout);
      assert.equal(full.diff.endsWith("\n"), true);
      // The diff renderer retains Git's final newline as its last empty row.
      assert.equal(full.totalLines, 19);
      assert.equal(full.shownLines, 19);

      const shortened = await repositoryVersionFileDiff({ ...versionInput, path: "notes.txt", lineLimit: 8 });
      assert.equal(shortened.parent, firstParent);
      assert.equal(shortened.lineLimit, 8);
      assert.equal(shortened.truncated, true);
      assert.equal(shortened.totalLines, full.totalLines);
      assert.equal(shortened.shownLines, 8);
      assert.deepEqual(shortened.diff.split("\n"), full.diff.split("\n").slice(0, 8));
      assert.ok(shortened.diff.endsWith("+note 2"));
      assert.equal(shortened.diff.includes("+note 3"), false);
    });

    await t.test("latest-version files and diff validate their shared snapshot object only once", async () => {
      const observed = [];
      for (const [selection, commit, filePath] of [
        ["latest", mergeCommit, "notes.txt"],
        ["older", firstParent, "main-only.txt"]
      ]) {
        for (const [operation, inspect] of [["files", repositoryVersionFiles], ["diff", repositoryVersionFileDiff]]) {
          const start = requests.length;
          const result = await inspect({ ...versionInput, commit, limit: 1, path: filePath });
          assert.equal(result.commit, commit);
          assert.equal(result.historySnapshotCommit, mergeCommit);
          const commands = requests.slice(start);
          observed.push({
            selection,
            operation,
            commandCount: commands.length,
            resolvedObjects: commands
              .filter((request) => request.args[0] === "rev-parse" && request.args[1] === "--verify")
              .map((request) => request.args[2])
          });
        }
      }
      const snapshotObject = `${mergeCommit}^{commit}`;
      const olderObject = `${firstParent}^{commit}`;
      assert.deepEqual(observed, [
        { selection: "latest", operation: "files", commandCount: 5, resolvedObjects: [snapshotObject] },
        { selection: "latest", operation: "diff", commandCount: 4, resolvedObjects: [snapshotObject] },
        { selection: "older", operation: "files", commandCount: 6, resolvedObjects: [snapshotObject, olderObject] },
        { selection: "older", operation: "diff", commandCount: 5, resolvedObjects: [snapshotObject, olderObject] }
      ]);
    });
    assert.ok(requests.every((request) => request.command === "git" && request.cwd === root));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("version diffs preserve exact deleted, renamed and gitlink entries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-exact-entry-"));
  const replacedPath = "replaced[*?]\\name";
  try {
    await git(root, ["init", "--initial-branch=main"]);
    for (const [filePath, contents] of [
      [replacedPath, "deleted original file\n"],
      ["deleted.txt", "plain deleted file\n"],
      ["before.txt", "rename content stays unchanged\n"]
    ]) {
      await writeFile(path.join(root, filePath), contents, "utf8");
    }
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-m", "original files"]);
    const seedCommit = await git(root, ["rev-parse", "HEAD"]);
    await git(root, ["update-index", "--add", "--cacheinfo", `160000,${seedCommit},vendor/lib`]);
    await git(root, ["commit", "-m", "original gitlink"]);
    const parent = await git(root, ["rev-parse", "HEAD"]);

    await git(root, ["--literal-pathspecs", "rm", replacedPath, "deleted.txt"]);
    await mkdir(path.join(root, replacedPath));
    await writeFile(path.join(root, replacedPath, "child.txt"), "unrelated replacement child\n", "utf8");
    await git(root, ["mv", "before.txt", "renamed.txt"]);
    await git(root, ["--literal-pathspecs", "add", `${replacedPath}/child.txt`]);
    await git(root, ["update-index", "--cacheinfo", `160000,${parent},vendor/lib`]);
    await git(root, ["commit", "-m", "change exact entries"]);
    const commit = await git(root, ["rev-parse", "HEAD"]);
    const input = {
      commit,
      historySnapshotCommit: commit,
      project: localProject(root),
      runCommand: commandRunner
    };
    const files = await repositoryVersionFiles(input);
    assert.equal(files.parent, parent);
    assert.deepEqual(files.files.map((file) => [file.path, file.status]), [
      ["deleted.txt", "D"],
      ["renamed.txt", "R"],
      [replacedPath, "D"],
      [`${replacedPath}/child.txt`, "A"],
      ["vendor/lib", "M"]
    ]);
    assert.equal(files.files.find((file) => file.path === "renamed.txt").previousPath, "before.txt");

    for (const [label, filePath, expectedLine] of [
      ["file replaced by a directory", replacedPath, "-deleted original file"],
      ["deleted file", "deleted.txt", "-plain deleted file"],
      ["rename destination", "renamed.txt", "+rename content stays unchanged"],
      ["gitlink", "vendor/lib", `+Subproject commit ${parent}`]
    ]) {
      await t.test(label, async () => {
        const diff = await repositoryVersionFileDiff({ ...input, path: filePath });
        assert.equal(diff.path, filePath);
        assert.equal(diff.parent, parent);
        assert.ok(diff.diff.split("\n").includes(expectedLine), diff.diff);
        assert.equal(diff.diff.includes("unrelated replacement child"), false, diff.diff);
        assert.equal(diff.diff.split("\n").filter((line) => line.startsWith("diff --git ")).length, 1);
      });
    }

    await t.test("ambient literal-pathspec mode retains exact files and gitlinks", async () => {
      for (const [filePath, expectedLine] of [
        [replacedPath, "-deleted original file"],
        ["vendor/lib", `+Subproject commit ${parent}`]
      ]) {
        const diff = await repositoryVersionFileDiff({
          ...input,
          path: filePath,
          runCommand: (request) => commandRunner({
            ...request,
            env: { ...request.env, GIT_LITERAL_PATHSPECS: "1" }
          })
        });
        const lines = diff.diff.split("\n");
        assert.ok(lines.includes(expectedLine), diff.diff);
        assert.equal(lines.includes("+unrelated replacement child"), false, diff.diff);
        assert.equal(lines.filter((line) => line.startsWith("diff --git ")).length, 1);
      }
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("malformed history cursors are rejected before any Git command", async (t) => {
  const snapshot = "a".repeat(40);
  for (const [label, value] of [
    ["invalid JSON", "{"],
    ["unpinned revision", JSON.stringify({ snapshot: "HEAD", offset: 0 })],
    ["negative offset", JSON.stringify({ snapshot, offset: -1 })],
    ["fractional offset", JSON.stringify({ snapshot, offset: 1.5 })],
    ["excessive offset", JSON.stringify({ snapshot, offset: 1_000_001 })]
  ]) {
    await t.test(label, async () => {
      const requests = [];
      await assert.rejects(inspectRepositoryHistory({
        cursor: Buffer.from(value, "utf8").toString("base64url"),
        project: localProject(path.join(os.tmpdir(), "vibe64-history-not-read")),
        runCommand: async (request) => {
          requests.push(request);
          return { ok: false, stderr: "Git must not run for an invalid cursor." };
        }
      }), { code: "vibe64_repository_history_cursor_invalid" });
      assert.deepEqual(requests, []);
    });
  }
});

for (const rootVersion of [true, false]) {
  test(`${rootVersion ? "root" : "parented"} version diffs treat selected filenames literally`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-literal-path-"));
    const cases = [
      { path: "[ab].txt", selected: "selected wildcard file", other: "unrelated wildcard file", otherPath: "a.txt" },
      { path: ":literal.txt", selected: "selected colon file", other: "unrelated colon file", otherPath: "literal.txt" },
      { path: " report.txt ", selected: "selected whitespace file", other: "unrelated ordinary file", otherPath: "report.txt" },
      { path: "tab\tname.txt", selected: "selected tab file", other: "unrelated tab decoy", otherPath: "tab-name.txt" },
      { path: "nested\\file.txt", selected: "selected backslash file", other: "unrelated nested file", otherPath: "nested/file.txt" }
    ];
    try {
      await git(root, ["init", "--initial-branch=main"]);
      let parent = "";
      if (!rootVersion) {
        await writeFile(path.join(root, "baseline.txt"), "baseline\n", "utf8");
        await git(root, ["add", "-A"]);
        await git(root, ["commit", "-m", "baseline"]);
        parent = await git(root, ["rev-parse", "HEAD"]);
      }
      for (const entry of cases) {
        await mkdir(path.dirname(path.join(root, entry.path)), { recursive: true });
        await mkdir(path.dirname(path.join(root, entry.otherPath)), { recursive: true });
        await writeFile(path.join(root, entry.path), `${entry.selected}\n`, "utf8");
        await writeFile(path.join(root, entry.otherPath), `${entry.other}\n`, "utf8");
      }
      await writeFile(path.join(root, "nested/other.txt"), "directory sibling\n", "utf8");
      await git(root, ["add", "-A"]);
      await git(root, ["commit", "-m", "literal filenames"]);
      const commit = await git(root, ["rev-parse", "HEAD"]);
      const files = await repositoryVersionFiles({
        commit,
        historySnapshotCommit: commit,
        project: localProject(root),
        runCommand: commandRunner
      });
      assert.equal(files.parent, parent);

      await t.test("preserves every exact filename without collapsing distinct entries", () => {
        assert.equal(files.totalCount, cases.length * 2 + 1);
        assert.equal(files.files.length, cases.length * 2 + 1);
        assert.equal(files.truncated, false);
        assert.deepEqual(
          files.files.map((file) => file.path).sort(),
          [...cases.flatMap((entry) => [entry.path, entry.otherPath]), "nested/other.txt"].sort()
        );
      });

      for (const entry of cases) {
        await t.test(entry.path, async () => {
          const selected = files.files.find((file) => file.path === entry.path);
          assert.ok(selected, "The file list must offer the exact committed filename.");
          assert.deepEqual(selected, { added: 1, deleted: 0, path: entry.path, status: "A" });
          assert.deepEqual(
            files.files.find((file) => file.path === entry.otherPath),
            { added: 1, deleted: 0, path: entry.otherPath, status: "A" }
          );
          const diff = await repositoryVersionFileDiff({
            commit,
            historySnapshotCommit: commit,
            path: selected.path,
            project: localProject(root),
            runCommand: commandRunner
          });
          assert.equal(diff.path, selected.path);
          assert.equal(diff.parent, parent);
          assert.ok(diff.diff.split("\n").includes(`+${entry.selected}`), diff.diff);
          assert.equal(diff.diff.includes(entry.other), false, diff.diff);
        });
      }

      await t.test("unsafe diff paths are rejected before reading patch contents", async () => {
        for (const invalidPath of ["/outside.txt", "../outside.txt", "file\0name.txt"]) {
          const requests = [];
          await assert.rejects(repositoryVersionFileDiff({
            commit,
            historySnapshotCommit: commit,
            path: invalidPath,
            project: localProject(root),
            runCommand: async (request) => {
              requests.push(request);
              return commandRunner(request);
            }
          }), { code: "vibe64_session_change_path_invalid" });
          assert.ok(requests.length > 0, "Commit metadata is validated before the file path.");
          assert.equal(requests.some((request) => request.args.includes("diff") || request.args.includes("show")), false);
          assert.ok(requests.every((request) => request.cwd === root));
        }
      });

      for (const requestedPath of [".", "nested", "missing.txt", ...(!rootVersion ? ["baseline.txt"] : [])]) {
        await t.test(`non-file diff path ${JSON.stringify(requestedPath)} has no descendant patches`, async () => {
          const diff = await repositoryVersionFileDiff({
            commit,
            historySnapshotCommit: commit,
            path: requestedPath,
            project: localProject(root),
            runCommand: commandRunner
          });
          assert.equal(diff.ok, true);
          assert.equal(diff.path, requestedPath);
          assert.equal(diff.diff, "");
        });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}
