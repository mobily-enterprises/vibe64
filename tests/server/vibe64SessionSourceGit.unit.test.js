import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  rename,
  readdir,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  managedSessionSourcePath,
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createSessionSource,
  githubSourceCommandOptions
} from "../../packages/vibe64-terminals/src/server/sessionSource.js";
import {
  VIBE64_GITHUB_ACCOUNT_MODE_ENV
} from "../../packages/vibe64-execution/src/server/credentialHomes.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return result.stdout.trim();
}

async function createProject(standaloneSourceRoot, {
  branch = "main"
} = {}) {
  await mkdir(standaloneSourceRoot, { recursive: true });
  await git(standaloneSourceRoot, ["init", `--initial-branch=${branch}`]);
  await git(standaloneSourceRoot, ["config", "user.name", "Vibe64 Test"]);
  await git(standaloneSourceRoot, ["config", "user.email", "vibe64@example.test"]);
  await writeFile(path.join(standaloneSourceRoot, "app.txt"), "initial\n", "utf8");
  await git(standaloneSourceRoot, ["add", "app.txt"]);
  await git(standaloneSourceRoot, ["commit", "-m", "initial"]);
}

async function directCommand(request = {}) {
  try {
    const result = await execFileAsync(request.command, request.args || [], {
      cwd: request.cwd,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024
    });
    return {
      ok: true,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      stderr: String(result.stderr || ""),
      stdout: String(result.stdout || "")
    };
  } catch (error) {
    return {
      code: "vibe64_test_command_failed",
      ok: false,
      output: `${error?.stdout || ""}${error?.stderr || error?.message || ""}`,
      stderr: String(error?.stderr || error?.message || ""),
      stdout: String(error?.stdout || "")
    };
  }
}

function sourceContext(root, sessionId = "session-1") {
  const metadata = {};
  return {
    metadata,
    project: {
      repository: {
        defaultBranch: "main",
        mode: "local_source"
      },
      repositoryMode: "local_source",
      sourceRoot: path.join(root, "project")
    },
    runtime: {
      projectContextRoot: path.join(root, "project"),
      projectSessionSourceRoot: path.join(root, "managed-source"),
    },
    session: {
      sessionId
    },
    store: {
      async writeMetadataValue(id, name, value) {
        assert.equal(id, sessionId);
        metadata[name] = value;
      }
    }
  };
}

function githubSourceContext(root, sessionId, {
  branch = "main",
  remoteRoot
} = {}) {
  const context = sourceContext(root, sessionId);
  context.project = {
    githubMirrorPath: path.join(root, "runtime", "github-mirror", "repository.git"),
    githubRepository: {
      cloneUrl: remoteRoot
    },
    repository: {
      defaultBranch: branch,
      github: {
        cloneUrl: remoteRoot
      },
      mode: "github"
    },
    repositoryMode: "github"
  };
  return context;
}

function assertPreparedCloneTarget(request = {}, finalSourcePath = "") {
  const preparedSourcePath = String(request.args?.at(-1) || "");
  assert.equal(path.basename(preparedSourcePath), "source");
  assert.match(path.basename(path.dirname(preparedSourcePath)), /^\.vibe64-source-preparing-/u);
  assert.equal(path.dirname(path.dirname(preparedSourcePath)), path.dirname(finalSourcePath));
}

test("Vibe64 creates an isolated Git source for a session", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root);
    const requests = [];
    await createProject(context.runtime.projectContextRoot);
    const baseline = await git(context.runtime.projectContextRoot, ["rev-parse", "HEAD"]);

    const result = await createSessionSource({
      ...context,
      runCommand: async (request) => {
        requests.push(request);
        return directCommand(request);
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.commit, baseline);
    assert.equal(await git(result.sourcePath, ["branch", "--show-current"]), "vibe64/session-1");
    assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD"]), baseline);
    assert.equal(context.metadata.base_branch, "main");
    assert.equal(context.metadata.local_source_branch, "main");
    assert.equal(context.metadata.base_commit, baseline);
    assert.equal(context.metadata.canonical_commit, baseline);
    assert.equal(context.metadata.branch, "vibe64/session-1");
    assert.equal(context.metadata.source_kind, "session_clone");
    assert.equal(context.metadata.source_cache_attempted, "no");
    assert.equal(context.metadata.source_cache_kind, "none");
    assert.equal(context.metadata.source_cache_reference, "not_used");
    assert.equal(context.metadata.source_cache_refresh, "not_applicable");
    assert.equal(context.metadata.source_path, result.sourcePath);
    assert.equal(context.metadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
    const cloneRequest = requests.find((request) => request.command === "git" && request.args?.[0] === "clone");
    assert.deepEqual(cloneRequest.args.slice(-2), [context.runtime.projectContextRoot, result.sourcePath]);
    assert.equal(cloneRequest.args.includes("--reference"), false);
    assert.equal(requests.some((request) => request.command === "bash"), false);
  });
});

test("Vibe64 ignores a stale hosted namespace checkout and clones the GitHub authority", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = sourceContext(root, "canonical-github-session");
    const requests = [];
    await git(root, ["init", "--bare", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await git(root, ["clone", "--branch", "main", remoteRoot, context.runtime.projectContextRoot]);
    const staleCommit = await git(context.runtime.projectContextRoot, ["rev-parse", "HEAD"]);

    await writeFile(path.join(publisherRoot, "app.txt"), "canonical\n", "utf8");
    await git(publisherRoot, ["add", "app.txt"]);
    await git(publisherRoot, ["commit", "-m", "canonical update"]);
    await git(publisherRoot, ["push", "origin", "main"]);
    const canonicalCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);
    assert.notEqual(staleCommit, canonicalCommit);
    context.project = {
      githubMirrorPath: path.join(root, "runtime", "github-mirror", "repository.git"),
      githubRepository: {
        cloneUrl: remoteRoot
      },
      repository: {
        defaultBranch: "main",
        github: {
          cloneUrl: remoteRoot
        },
        mode: "github"
      },
      repositoryMode: "github"
    };

    const result = await createSessionSource({
      ...context,
      runCommand: async (request) => {
        requests.push(request);
        return directCommand(request);
      }
    });

    assert.equal(result.commit, canonicalCommit);
    assert.equal(context.metadata.base_commit, canonicalCommit);
    assert.equal(context.metadata.canonical_commit, canonicalCommit);
    assert.equal(await git(result.sourcePath, ["show", "HEAD:app.txt"]), "canonical");
    assert.equal(await git(context.runtime.projectContextRoot, ["rev-parse", "HEAD"]), staleCommit);
    assert.equal(requests.some((request) => (
      request.cwd === context.runtime.projectContextRoot ||
      request.allowedRoots?.includes(context.runtime.projectContextRoot)
    )), false);
    assert.equal(context.metadata.source_cache_attempted, "yes");
    assert.equal(context.metadata.source_cache_kind, "github_mirror");
    assert.equal(context.metadata.source_cache_refresh, "refreshed");
    assert.equal(context.metadata.source_cache_reference, "used");
    const cloneRequest = requests.find((request) => (
      request.command === "git" && request.args?.[0] === "clone"
    ));
    assert.equal(cloneRequest.args.at(-2), remoteRoot);
    assertPreparedCloneTarget(cloneRequest, result.sourcePath);
    assert.deepEqual(
      cloneRequest.args.slice(
        cloneRequest.args.indexOf("--reference"),
        cloneRequest.args.indexOf("--single-branch")
      ),
      ["--reference", context.project.githubMirrorPath]
    );
    assert.equal(cloneRequest.args.includes("--dissociate"), false);
    const repackIndex = requests.findIndex((request) => (
      request.command === "git" && request.args?.[0] === "repack"
    ));
    const connectivityIndex = requests.findIndex((request) => (
      request.command === "git" && request.args?.[0] === "fsck"
    ));
    assert.ok(repackIndex > requests.indexOf(cloneRequest));
    assert.ok(connectivityIndex > repackIndex);
    assert.deepEqual(requests[repackIndex].args, ["repack", "-a", "-d"]);
    assert.deepEqual(requests[connectivityIndex].args, [
      "fsck",
      "--connectivity-only",
      "--no-dangling",
      "--no-progress"
    ]);
    assert.equal(requests[repackIndex].gitTransport, "none");
    assert.equal(requests[connectivityIndex].gitTransport, "none");
    assert.ok(requests.some((request) => (
      request.command === "bash" &&
      request.args?.includes("vibe64-github-mirror-refresh") &&
      request.args?.includes(remoteRoot) &&
      request.args?.includes(context.project.githubMirrorPath)
    )));
    await assert.rejects(
      () => access(path.join(result.sourcePath, ".git", "objects", "info", "alternates")),
      { code: "ENOENT" }
    );
  });
});

test("renewal source creation pins the confirmed GitHub commit after authority advances", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "renewal-successor", { remoteRoot });
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    const confirmedCommit = await git(publisherRoot, ["rev-parse", "HEAD^{commit}"]);

    await writeFile(path.join(publisherRoot, "app.txt"), "authority advanced\n", "utf8");
    await git(publisherRoot, ["add", "app.txt"]);
    await git(publisherRoot, ["commit", "-m", "advance after renewal confirmation"]);
    await git(publisherRoot, ["push", "origin", "main"]);
    const advancedCommit = await git(publisherRoot, ["rev-parse", "HEAD^{commit}"]);
    assert.notEqual(advancedCommit, confirmedCommit);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    const result = await createSessionSource({
      ...context,
      expectedCommit: confirmedCommit
    });

    assert.equal(result.commit, confirmedCommit);
    assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD^{commit}"]), confirmedCommit);
    assert.equal(await git(result.sourcePath, ["show", "HEAD:app.txt"]), "initial");
    assert.equal(
      await git(result.sourcePath, ["rev-parse", "refs/remotes/origin/main^{commit}"]),
      advancedCommit
    );
    assert.equal(context.metadata.base_commit, confirmedCommit);
    assert.equal(context.metadata.canonical_commit, confirmedCommit);
    assert.equal(
      await git(root, [
        "--git-dir", context.project.githubMirrorPath,
        "rev-parse", "refs/heads/main^{commit}"
      ]),
      advancedCommit
    );
  });
});

test("renewal source creation pins the confirmed standalone commit after authority advances", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "standalone-renewal-successor");
    await createProject(context.runtime.projectContextRoot);
    const confirmedCommit = await git(
      context.runtime.projectContextRoot,
      ["rev-parse", "HEAD^{commit}"]
    );
    await writeFile(
      path.join(context.runtime.projectContextRoot, "app.txt"),
      "standalone authority advanced\n",
      "utf8"
    );
    await git(context.runtime.projectContextRoot, ["add", "app.txt"]);
    await git(context.runtime.projectContextRoot, ["commit", "-m", "advance standalone source"]);
    const advancedCommit = await git(
      context.runtime.projectContextRoot,
      ["rev-parse", "HEAD^{commit}"]
    );
    assert.notEqual(advancedCommit, confirmedCommit);

    const result = await createSessionSource({
      ...context,
      expectedCommit: confirmedCommit
    });

    assert.equal(result.commit, confirmedCommit);
    assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD^{commit}"]), confirmedCommit);
    assert.equal(await git(result.sourcePath, ["show", "HEAD:app.txt"]), "initial");
    assert.equal(context.metadata.base_commit, confirmedCommit);
    assert.equal(context.metadata.canonical_commit, confirmedCommit);
  });
});

test("renewal source creation pins the confirmed Vibe64 Git commit after authority advances", async () => {
  await withTemporaryRoot(async (root) => {
    const canonicalRoot = path.join(root, "canonical-repository", "repository.git");
    const publisherRoot = path.join(root, "publisher");
    const context = sourceContext(root, "managed-renewal-successor");
    await mkdir(path.dirname(canonicalRoot), { recursive: true });
    await git(root, ["init", "--bare", "--initial-branch=main", canonicalRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", canonicalRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    const confirmedCommit = await git(publisherRoot, ["rev-parse", "HEAD^{commit}"]);
    await writeFile(path.join(publisherRoot, "app.txt"), "managed authority advanced\n", "utf8");
    await git(publisherRoot, ["add", "app.txt"]);
    await git(publisherRoot, ["commit", "-m", "advance managed authority"]);
    await git(publisherRoot, ["push", "origin", "main"]);
    const advancedCommit = await git(publisherRoot, ["rev-parse", "HEAD^{commit}"]);
    context.project = {
      canonicalRepositoryPath: canonicalRoot,
      repository: {
        defaultBranch: "main",
        mode: "managed_git"
      },
      repositoryMode: "managed_git"
    };
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    const result = await createSessionSource({
      ...context,
      expectedCommit: confirmedCommit
    });

    assert.notEqual(advancedCommit, confirmedCommit);
    assert.equal(result.commit, confirmedCommit);
    assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD^{commit}"]), confirmedCommit);
    assert.equal(await git(result.sourcePath, ["show", "HEAD:app.txt"]), "initial");
    assert.equal(
      await git(result.sourcePath, ["rev-parse", "refs/remotes/origin/main^{commit}"]),
      advancedCommit
    );
    assert.equal(context.metadata.base_commit, confirmedCommit);
    assert.equal(context.metadata.canonical_commit, confirmedCommit);
  });
});

test("renewal source creation rejects a frozen commit outside the authority branch", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const unrelatedRoot = path.join(root, "unrelated");
    const context = githubSourceContext(root, "unavailable-renewal-commit", { remoteRoot });
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await createProject(unrelatedRoot);
    await writeFile(path.join(unrelatedRoot, "unrelated.txt"), "outside authority\n", "utf8");
    await git(unrelatedRoot, ["add", "unrelated.txt"]);
    await git(unrelatedRoot, ["commit", "-m", "unrelated history"]);
    const unrelatedCommit = await git(unrelatedRoot, ["rev-parse", "HEAD^{commit}"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    await assert.rejects(
      () => createSessionSource({
        ...context,
        expectedCommit: unrelatedCommit
      }),
      { code: "vibe64_session_source_expected_commit_unavailable" }
    );
    await assert.rejects(
      () => access(managedSessionSourcePath(
        context.runtime.projectSessionSourceRoot,
        context.session.sessionId
      )),
      { code: "ENOENT" }
    );
    assert.deepEqual(context.metadata, {});
  });
});

test("renewal source creation rejects a checkout that does not land on the frozen commit", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "mismatched-renewal-checkout", { remoteRoot });
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    const confirmedCommit = await git(publisherRoot, ["rev-parse", "HEAD^{commit}"]);
    await writeFile(path.join(publisherRoot, "app.txt"), "authority advanced\n", "utf8");
    await git(publisherRoot, ["add", "app.txt"]);
    await git(publisherRoot, ["commit", "-m", "advance authority"]);
    await git(publisherRoot, ["push", "origin", "main"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    await assert.rejects(
      () => createSessionSource({
        ...context,
        expectedCommit: confirmedCommit,
        runCommand: async (request) => {
          if (request.command === "git" && request.args?.[0] === "checkout") {
            return {
              ok: true,
              stdout: ""
            };
          }
          return directCommand(request);
        }
      }),
      { code: "vibe64_session_source_expected_commit_mismatch" }
    );
    assert.deepEqual(context.metadata, {});
  });
});

test("GitHub mirror acceleration handles cold, warm, stale, and non-main session clones", async () => {
  await withTemporaryRoot(async (root) => {
    const branch = "trunk";
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    await git(root, ["init", "--bare", `--initial-branch=${branch}`, remoteRoot]);
    await createProject(publisherRoot, { branch });
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", branch]);
    const initialCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);

    const cold = githubSourceContext(root, "cold-mirror", { branch, remoteRoot });
    await mkdir(cold.runtime.projectContextRoot, { recursive: true });
    const coldResult = await createSessionSource(cold);
    assert.equal(coldResult.commit, initialCommit);
    assert.equal(cold.metadata.source_cache_refresh, "refreshed");
    assert.equal(cold.metadata.source_cache_reference, "used");

    const warm = githubSourceContext(root, "warm-mirror", { branch, remoteRoot });
    const warmResult = await createSessionSource(warm);
    assert.equal(warmResult.commit, initialCommit);
    assert.equal(warm.metadata.source_cache_refresh, "refreshed");
    assert.equal(warm.metadata.source_cache_reference, "used");

    await writeFile(path.join(publisherRoot, "app.txt"), "new canonical object\n", "utf8");
    await git(publisherRoot, ["add", "app.txt"]);
    await git(publisherRoot, ["commit", "-m", "advance canonical trunk"]);
    await git(publisherRoot, ["push", "origin", branch]);
    const advancedCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);
    assert.notEqual(advancedCommit, initialCommit);

    const stale = githubSourceContext(root, "stale-mirror", { branch, remoteRoot });
    const staleResult = await createSessionSource(stale);
    assert.equal(staleResult.commit, advancedCommit);
    assert.equal(stale.metadata.base_branch, branch);
    assert.equal(stale.metadata.source_cache_refresh, "refreshed");
    assert.equal(stale.metadata.source_cache_reference, "used");
    assert.equal(
      await git(root, ["--git-dir", stale.project.githubMirrorPath, "rev-parse", `refs/heads/${branch}`]),
      advancedCommit
    );
    for (const result of [coldResult, warmResult, staleResult]) {
      await assert.rejects(
        () => access(path.join(result.sourcePath, ".git", "objects", "info", "alternates")),
        { code: "ENOENT" }
      );
    }
    assert.deepEqual(await readdir(cold.runtime.projectContextRoot), []);
  });
});

test("GitHub mirror refresh replaces non-bare storage and corrects the wrong origin", async () => {
  await withTemporaryRoot(async (root) => {
    for (const condition of ["non-bare", "wrong-origin"]) {
      const caseRoot = path.join(root, condition);
      const remoteRoot = path.join(caseRoot, "remote.git");
      const publisherRoot = path.join(caseRoot, "publisher");
      const context = githubSourceContext(caseRoot, `${condition}-mirror`, { remoteRoot });
      await mkdir(caseRoot, { recursive: true });
      await git(caseRoot, ["init", "--bare", "--initial-branch=main", remoteRoot]);
      await createProject(publisherRoot);
      await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
      await git(publisherRoot, ["push", "-u", "origin", "main"]);
      const canonicalCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);
      await mkdir(context.runtime.projectContextRoot, { recursive: true });

      if (condition === "non-bare") {
        await mkdir(context.project.githubMirrorPath, { recursive: true });
        await writeFile(path.join(context.project.githubMirrorPath, "corrupt.txt"), "not a repository\n", "utf8");
      } else {
        const wrongPublisher = path.join(caseRoot, "wrong-publisher");
        const wrongRemote = path.join(caseRoot, "wrong.git");
        await createProject(wrongPublisher);
        await git(caseRoot, ["clone", "--bare", wrongPublisher, wrongRemote]);
        await mkdir(path.dirname(context.project.githubMirrorPath), { recursive: true });
        await git(caseRoot, ["clone", "--bare", wrongRemote, context.project.githubMirrorPath]);
      }

      const result = await createSessionSource(context);
      assert.equal(result.commit, canonicalCommit, condition);
      assert.equal(context.metadata.source_cache_refresh, "refreshed", condition);
      assert.equal(context.metadata.source_cache_reference, "used", condition);
      assert.equal(
        await git(caseRoot, ["--git-dir", context.project.githubMirrorPath, "remote", "get-url", "origin"]),
        remoteRoot,
        condition
      );
      assert.equal(
        await git(caseRoot, ["--git-dir", context.project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
        canonicalCommit,
        condition
      );
    }
  });
});

test("GitHub session cloning treats denied or interrupted mirror refresh as non-authoritative", async () => {
  await withTemporaryRoot(async (root) => {
    for (const condition of ["cold-denied", "cold-interrupted", "warm-stale-denied"]) {
      const warmMirror = condition.startsWith("warm-stale");
      const caseRoot = path.join(root, condition);
      const remoteRoot = path.join(caseRoot, "remote.git");
      const publisherRoot = path.join(caseRoot, "publisher");
      const context = githubSourceContext(caseRoot, `${condition}-refresh-denied`, { remoteRoot });
      const requests = [];
      await mkdir(caseRoot, { recursive: true });
      await git(caseRoot, ["init", "--bare", "--initial-branch=main", remoteRoot]);
      await createProject(publisherRoot);
      await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
      await git(publisherRoot, ["push", "-u", "origin", "main"]);
      await mkdir(context.runtime.projectContextRoot, { recursive: true });
      if (warmMirror) {
        await mkdir(path.dirname(context.project.githubMirrorPath), { recursive: true });
        await git(caseRoot, ["clone", "--bare", remoteRoot, context.project.githubMirrorPath]);
        await writeFile(path.join(publisherRoot, "app.txt"), "advanced while cache remains stale\n", "utf8");
        await git(publisherRoot, ["add", "app.txt"]);
        await git(publisherRoot, ["commit", "-m", "advance without mirror refresh"]);
        await git(publisherRoot, ["push", "origin", "main"]);
      }
      const canonicalCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);

      const result = await createSessionSource({
        ...context,
        runCommand: async (request) => {
          requests.push(request);
          if (
            request.command === "bash" &&
            request.args?.includes("vibe64-github-mirror-refresh")
          ) {
            if (condition === "cold-interrupted") {
              throw new Error("simulated interrupted mirror refresh");
            }
            return {
              code: "vibe64_test_refresh_denied",
              ok: false,
              stderr: "simulated mirror refresh denial"
            };
          }
          return directCommand(request);
        }
      });

      assert.equal(result.commit, canonicalCommit, condition);
      assert.equal(context.metadata.source_cache_refresh, "failed", condition);
      assert.equal(
        context.metadata.source_cache_reference,
        warmMirror ? "used" : "not_used",
        condition
      );
      const cloneRequest = requests.find((request) => request.command === "git" && request.args?.[0] === "clone");
      assert.equal(cloneRequest.args.at(-2), remoteRoot, condition);
      assertPreparedCloneTarget(cloneRequest, result.sourcePath);
      assert.equal(cloneRequest.args.includes("--reference"), warmMirror, condition);
      assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit, condition);
    }
  });
});

test("GitHub session cloning retries the authoritative remote without a rejected reference", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "reference-fallback", { remoteRoot });
    const requests = [];
    let rejectedReference = false;
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    const result = await createSessionSource({
      ...context,
      runCommand: async (request) => {
        requests.push(request);
        if (
          !rejectedReference &&
          request.command === "git" &&
          request.args?.[0] === "clone" &&
          request.args.includes("--reference")
        ) {
          rejectedReference = true;
          return {
            code: "vibe64_test_reference_failed",
            ok: false,
            stderr: "simulated reference failure"
          };
        }
        return directCommand(request);
      }
    });

    const cloneRequests = requests.filter((request) => request.command === "git" && request.args?.[0] === "clone");
    assert.equal(cloneRequests.length, 2);
    assert.equal(cloneRequests[0].args.includes("--reference"), true);
    assert.equal(cloneRequests[1].args.includes("--reference"), false);
    assert.ok(cloneRequests.every((request) => request.args.at(-2) === remoteRoot));
    assert.ok(cloneRequests.every((request) => {
      assertPreparedCloneTarget(request, result.sourcePath);
      return true;
    }));
    assert.equal(context.metadata.source_cache_reference, "not_used");
    assert.equal(result.commit, await git(publisherRoot, ["rev-parse", "HEAD"]));
  });
});

test("GitHub session cloning falls back when reference dissociation cannot be proven", async () => {
  await withTemporaryRoot(async (root) => {
    for (const failedStep of ["repack", "alternates-removal", "fsck"]) {
      const caseRoot = path.join(root, failedStep);
      const remoteRoot = path.join(caseRoot, "remote.git");
      const publisherRoot = path.join(caseRoot, "publisher");
      const context = githubSourceContext(caseRoot, `${failedStep}-fallback`, { remoteRoot });
      const requests = [];
      let rejected = false;
      await mkdir(caseRoot, { recursive: true });
      await git(caseRoot, ["init", "--bare", "--initial-branch=main", remoteRoot]);
      await createProject(publisherRoot);
      await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
      await git(publisherRoot, ["push", "-u", "origin", "main"]);
      await mkdir(context.runtime.projectContextRoot, { recursive: true });

      const result = await createSessionSource({
        ...context,
        runCommand: async (request) => {
          requests.push(request);
          if (!rejected && request.command === "git" && request.args?.[0] === failedStep) {
            rejected = true;
            return {
              code: `vibe64_test_${failedStep}_failed`,
              ok: false,
              stderr: `simulated ${failedStep} failure`
            };
          }
          const result = await directCommand(request);
          if (
            !rejected &&
            failedStep === "alternates-removal" &&
            request.command === "git" &&
            request.args?.[0] === "repack"
          ) {
            const alternatesPath = path.join(
              request.cwd,
              ".git",
              "objects",
              "info",
              "alternates"
            );
            await rename(alternatesPath, `${alternatesPath}.reference`);
            await mkdir(alternatesPath);
            await writeFile(path.join(alternatesPath, "refuse-removal"), "intentional\n", "utf8");
            rejected = true;
          }
          return result;
        }
      });

      assert.equal(rejected, true, failedStep);
      const cloneRequests = requests.filter((request) => (
        request.command === "git" && request.args?.[0] === "clone"
      ));
      assert.equal(cloneRequests.length, 2, failedStep);
      assert.equal(cloneRequests[0].args.includes("--reference"), true, failedStep);
      assert.equal(cloneRequests[1].args.includes("--reference"), false, failedStep);
      assert.ok(cloneRequests.every((request) => request.args.at(-2) === remoteRoot), failedStep);
      assert.ok(cloneRequests.every((request) => {
        assertPreparedCloneTarget(request, result.sourcePath);
        return true;
      }), failedStep);
      assert.equal(context.metadata.source_cache_reference, "not_used", failedStep);
      assert.equal(result.commit, await git(publisherRoot, ["rev-parse", "HEAD"]), failedStep);
      await assert.rejects(
        () => access(path.join(result.sourcePath, ".git", "objects", "info", "alternates")),
        { code: "ENOENT" }
      );
      assert.deepEqual(await readdir(path.dirname(result.sourcePath)), ["source"]);
    }
  });
});

test("GitHub reference preparation never exposes a cache-dependent checkout", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "atomic-reference", { remoteRoot });
    let releaseRepack;
    const repackReleased = new Promise((resolve) => {
      releaseRepack = resolve;
    });
    let announceRepack;
    const repackStarted = new Promise((resolve) => {
      announceRepack = resolve;
    });
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    const sourceCreation = createSessionSource({
      ...context,
      runCommand: async (request) => {
        if (request.command === "git" && request.args?.[0] === "repack") {
          announceRepack();
          await repackReleased;
        }
        return directCommand(request);
      }
    });
    await repackStarted;

    const finalSourcePath = managedSessionSourcePath(
      context.runtime.projectSessionSourceRoot,
      context.session.sessionId
    );
    await assert.rejects(() => access(finalSourcePath), { code: "ENOENT" });
    const sourceParentEntries = await readdir(path.dirname(finalSourcePath));
    assert.equal(sourceParentEntries.length, 1);
    assert.match(sourceParentEntries[0], /^\.vibe64-source-preparing-/u);

    releaseRepack();
    const result = await sourceCreation;
    assert.equal(result.sourcePath, finalSourcePath);
    assert.equal(context.metadata.source_cache_reference, "used");
    assert.deepEqual(await readdir(path.dirname(finalSourcePath)), ["source"]);
    await assert.rejects(
      () => access(path.join(finalSourcePath, ".git", "objects", "info", "alternates")),
      { code: "ENOENT" }
    );
  });
});

test("GitHub unavailability fails session creation even when the complete mirror exists", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "remote.git");
    const unavailableRoot = path.join(root, "remote-unavailable.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "unavailable-authority", { remoteRoot });
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });
    await mkdir(path.dirname(context.project.githubMirrorPath), { recursive: true });
    await git(root, ["clone", "--bare", remoteRoot, context.project.githubMirrorPath]);
    await rename(remoteRoot, unavailableRoot);
    const finalSourcePath = managedSessionSourcePath(
      context.runtime.projectSessionSourceRoot,
      context.session.sessionId
    );

    await assert.rejects(
      () => createSessionSource({
        ...context,
        runCommand: directCommand
      }),
      (error) => error?.code === "vibe64_test_command_failed"
    );
    await assert.rejects(
      () => access(finalSourcePath),
      { code: "ENOENT" }
    );
    assert.deepEqual(await readdir(path.dirname(finalSourcePath)), []);
    assert.equal(
      await git(root, ["--git-dir", context.project.githubMirrorPath, "rev-parse", "refs/heads/main"]),
      await git(publisherRoot, ["rev-parse", "HEAD"])
    );
  });
});

test("Vibe64-only sessions clone the canonical bare repository without a namespace cache", async () => {
  await withTemporaryRoot(async (root) => {
    const canonicalRoot = path.join(root, "canonical-repository", "repository.git");
    const publisherRoot = path.join(root, "publisher");
    const first = sourceContext(root, "managed-session-one");
    const second = sourceContext(root, "managed-session-two");
    await mkdir(path.dirname(canonicalRoot), { recursive: true });
    await git(root, ["init", "--bare", "--initial-branch=main", canonicalRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", canonicalRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    const canonicalCommit = await git(publisherRoot, ["rev-parse", "HEAD"]);
    await mkdir(first.runtime.projectContextRoot, { recursive: true });

    for (const context of [first, second]) {
      const requests = [];
      context.project = {
        canonicalRepositoryPath: canonicalRoot,
        repository: {
          defaultBranch: "main",
          mode: "managed_git"
        },
        repositoryMode: "managed_git"
      };
      const result = await createSessionSource({
        ...context,
        runCommand: async (request) => {
          requests.push(request);
          return directCommand(request);
        }
      });

      assert.equal(result.commit, canonicalCommit);
      assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit);
      assert.equal(await git(result.sourcePath, ["remote", "get-url", "origin"]), canonicalRoot);
      assert.equal(context.metadata.source_cache_attempted, "no");
      assert.equal(context.metadata.source_cache_kind, "none");
      assert.equal(context.metadata.source_cache_reference, "not_used");
      assert.equal(context.metadata.source_cache_refresh, "not_applicable");
      const cloneRequest = requests.find((request) => request.command === "git" && request.args?.[0] === "clone");
      assert.equal(cloneRequest.args.at(-2), canonicalRoot);
      assertPreparedCloneTarget(cloneRequest, result.sourcePath);
      assert.equal(cloneRequest.args.includes("--reference"), false);
      assert.equal(requests.some((request) => request.command === "bash"), false);
      await assert.rejects(
        () => access(path.join(result.sourcePath, ".git", "objects", "info", "alternates")),
        { code: "ENOENT" }
      );
    }
    assert.deepEqual(await readdir(first.runtime.projectContextRoot), []);
  });
});

test("hosted GitHub session cloning reads the requester's token but retains the daemon filesystem actor", async () => {
  let tokenRequest = null;
  const options = await githubSourceCommandOptions({
    gid: 1001,
    home: "/home/ada",
    uid: 1001,
    username: "ada"
  }, {
    [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
  }, {
    async runCommand(request) {
      tokenRequest = request;
      return {
        ok: true,
        stdout: "github-token\n"
      };
    }
  });

  assert.deepEqual(tokenRequest, {
    actor: "named-user",
    allowedRoots: ["/home/ada"],
    args: ["auth", "token"],
    command: "gh",
    cwd: "/home/ada",
    envPolicy: "auth",
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: "ada"
    },
    purpose: "github-api",
    runtimes: ["gh"],
    timeout: 60_000,
    userKey: "ada"
  });
  assert.deepEqual(options, {
    actor: "daemon",
    gitAuthToken: "github-token",
    gitTransport: "github-token"
  });
});

test("private GitHub credentials remain attached to mirror refresh and authoritative clone without entering evidence", async () => {
  await withTemporaryRoot(async (root) => {
    const remoteRoot = path.join(root, "private-remote.git");
    const publisherRoot = path.join(root, "publisher");
    const context = githubSourceContext(root, "private-github-session", { remoteRoot });
    const requests = [];
    const token = "private-github-token";
    await git(root, ["init", "--bare", "--initial-branch=main", remoteRoot]);
    await createProject(publisherRoot);
    await git(publisherRoot, ["remote", "add", "origin", remoteRoot]);
    await git(publisherRoot, ["push", "-u", "origin", "main"]);
    await mkdir(context.runtime.projectContextRoot, { recursive: true });

    const result = await createSessionSource({
      ...context,
      env: {
        [VIBE64_GITHUB_ACCOUNT_MODE_ENV]: "user"
      },
      runCommand: async (request) => {
        requests.push(request);
        if (request.command === "gh") {
          return {
            ok: true,
            stdout: `${token}\n`
          };
        }
        return directCommand(request);
      },
      vibe64User: {
        gid: 1001,
        home: "/home/ada",
        uid: 1001,
        username: "ada"
      }
    });

    const remoteRequests = requests.filter((request) => (
      request.command === "bash" ||
      (request.command === "git" && request.args?.[0] === "clone")
    ));
    assert.equal(remoteRequests.length, 2);
    for (const request of remoteRequests) {
      assert.equal(request.actor, "daemon");
      assert.equal(request.gitAuthToken, token);
      assert.equal(request.gitTransport, "github-token");
      assert.equal(JSON.stringify(request.args).includes(token), false);
    }
    assert.ok(remoteRequests.every((request) => request.args.includes(remoteRoot)));
    const localReferenceRequests = requests.filter((request) => (
      request.command === "git" && ["repack", "fsck"].includes(request.args?.[0])
    ));
    assert.deepEqual(localReferenceRequests.map((request) => request.args?.[0]), ["repack", "fsck"]);
    for (const request of localReferenceRequests) {
      assert.equal(request.actor, "daemon");
      assert.equal(Boolean(request.gitAuthToken), false);
      assert.equal(request.gitTransport, "none");
    }
    assert.equal(result.commit, await git(publisherRoot, ["rev-parse", "HEAD"]));
    assert.equal(context.metadata.source_cache_refresh, "refreshed");
    assert.equal(context.metadata.source_cache_reference, "used");
    assert.equal(JSON.stringify(context.metadata).includes(token), false);
  });
});

test("Vibe64 never falls back to a stale cache when the canonical remote is unavailable", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "unavailable-canonical-session");
    await createProject(context.runtime.projectContextRoot);
    context.project = {
      githubRepository: {
        cloneUrl: path.join(root, "missing-remote.git")
      },
      repository: {
        defaultBranch: "main",
        mode: "github"
      },
      repositoryMode: "github"
    };
    const finalSourcePath = managedSessionSourcePath(
      context.runtime.projectSessionSourceRoot,
      context.session.sessionId
    );

    await assert.rejects(
      createSessionSource(context),
      (error) => error?.code === "vibe64_session_source_git_failed"
    );
    await assert.rejects(
      () => access(finalSourcePath),
      { code: "ENOENT" }
    );
    assert.deepEqual(await readdir(path.dirname(finalSourcePath)), []);
    assert.deepEqual(context.metadata, {});
  });
});

test("Vibe64 creates a Git baseline for a new unversioned project", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "new-project-session");
    await mkdir(context.runtime.projectContextRoot, { recursive: true });
    await writeFile(path.join(context.runtime.projectContextRoot, "README.md"), "New project\n", "utf8");

    const result = await createSessionSource(context);

    assert.equal(result.ok, true);
    assert.match(result.commit, /^[0-9a-f]{40}$/u);
    assert.equal(await git(context.runtime.projectContextRoot, ["status", "--porcelain"]), "");
    assert.equal(await git(result.sourcePath, ["show", "HEAD:README.md"]), "New project");
  });
});

test("Vibe64 refuses to hide uncommitted project changes in a new session", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "dirty-project-session");
    await createProject(context.runtime.projectContextRoot);
    await writeFile(path.join(context.runtime.projectContextRoot, "app.txt"), "changed\n", "utf8");

    await assert.rejects(
      createSessionSource(context),
      (error) => error?.code === "vibe64_session_source_project_dirty"
    );
  });
});
