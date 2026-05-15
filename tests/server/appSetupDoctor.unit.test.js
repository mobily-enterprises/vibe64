import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  configImportProblems,
  configImportSpecifiersFromText,
  directDependencyNames,
  doctorIssueLines,
  gitCheckpointScript,
  githubBranchRefApiPath,
  ghRepoCreateScript,
  inspectAppSetup,
  missingDirectDependencies,
  npmInstallScript,
  onlyUiVerificationDoctorIssues
} from "../../packages/app-setup-doctor/src/server/service.js";
import {
  ghRepoCreateScript as targetGhRepoCreateScript
} from "../../packages/target-app-doctor/src/server/service.js";

function assertShellScriptSurvivesWhitespaceCollapse(script) {
  const flattened = script.replace(/\s+/gu, " ");
  const result = spawnSync("bash", ["-n", "-c", flattened], {
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || flattened);
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

async function runGitForDoctor(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8"
  });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  return {
    exitCode: result.status,
    ok: result.status === 0,
    output: [stdout, stderr].filter(Boolean).join("\n"),
    stderr,
    stdout
  };
}

test("App Setup Doctor hard-stops when a non-git directory already has files", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-files-"));
  await writeFile(path.join(targetRoot, "notes.txt"), "existing work\n", "utf8");

  const status = await inspectAppSetup({
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.currentStageId, "directory");
  assert.equal(status.hardStop, true);
  assert.equal(status.stages[0].status, "hard-stop");
  assert.match(status.stages[0].observed, /notes\.txt/u);
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "pending");
});

test("App Setup Doctor blocks an empty directory at Git initialization", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-empty-"));

  const status = await inspectAppSetup({
    targetRoot
  });

  assert.equal(status.ready, false);
  assert.equal(status.hardStop, false);
  assert.equal(status.stages[0].status, "pass");
  assert.equal(status.currentStageId, "git-ready");
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.status, "blocked");
  assert.equal(status.stages.find((stage) => stage.id === "git-ready")?.repair?.actionId, "terminal-git-init");
});

test("App Setup Doctor admits linked Git worktrees before Git safety checks", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-linked-repo-"));
  const worktreeRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-linked-worktree-"));

  runGit(repoRoot, ["init", "-b", "main"]);
  runGit(repoRoot, ["config", "user.name", "Studio Test"]);
  runGit(repoRoot, ["config", "user.email", "studio-test@example.com"]);
  await writeFile(path.join(repoRoot, "README.md"), "# Test\n", "utf8");
  runGit(repoRoot, ["add", "README.md"]);
  runGit(repoRoot, ["commit", "-m", "Initial commit"]);
  runGit(repoRoot, ["worktree", "add", "-b", "studio-test", worktreeRoot]);

  const status = await inspectAppSetup({
    runGitCommand: runGitForDoctor,
    targetRoot: worktreeRoot
  });

  assert.equal(status.stages.find((stage) => stage.id === "directory")?.status, "pass");
  assert.match(status.stages.find((stage) => stage.id === "directory")?.observed || "", /linked Git metadata/u);
  assert.notEqual(status.currentStageId, "directory");
});

test("App Setup Doctor dependency gate catches partial node_modules installs", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-deps-"));
  const packageJson = {
    dependencies: {
      "@jskit-ai/kernel": "0.x"
    },
    devDependencies: {
      "@jskit-ai/config-eslint": "0.x",
      "@jskit-ai/jskit-cli": "0.x"
    },
    optionalDependencies: {
      "optional-tool": "1.x"
    }
  };
  await writeFile(path.join(targetRoot, "package.json"), JSON.stringify(packageJson, null, 2), "utf8");
  await mkdir(path.join(targetRoot, "node_modules", "@jskit-ai", "jskit-cli"), {
    recursive: true
  });
  await writeFile(
    path.join(targetRoot, "node_modules", "@jskit-ai", "jskit-cli", "package.json"),
    "{}",
    "utf8"
  );

  assert.deepEqual(directDependencyNames(packageJson), [
    "@jskit-ai/config-eslint",
    "@jskit-ai/jskit-cli",
    "@jskit-ai/kernel"
  ]);

  const missing = await missingDirectDependencies(targetRoot, packageJson);

  assert.deepEqual(missing, [
    "@jskit-ai/config-eslint",
    "@jskit-ai/kernel"
  ]);
});

test("App Setup Doctor uses the same GitHub create-or-link repair as App Bootup", () => {
  const script = ghRepoCreateScript("exampleapp");

  assert.equal(script, targetGhRepoCreateScript("exampleapp"));
  assert.match(script, /gh repo view "\$repo_slug" --json url/u);
  assert.match(script, /git remote add origin "\$repo_url"/u);
  assert.match(script, /Linked existing GitHub repository/u);
});

test("App Setup Doctor dependency repair never runs devlinks", () => {
  const script = npmInstallScript();

  assert.match(script, /npm install/u);
  assert.match(script, /npm update \$jskit_deps/u);
  assert.doesNotMatch(script, /@latest/u);
  assert.doesNotMatch(script, /--save-exact/u);
  assert.doesNotMatch(script, /devlinks/u);
  assert.doesNotMatch(script, /JSKIT_REPO_ROOT/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("App Setup Doctor checkpoint repair commits and pushes the baseline", () => {
  const script = gitCheckpointScript();

  assert.match(script, /gh auth token/u);
  assert.match(script, /GIT_ASKPASS=\/tmp\/jskit-git-askpass/u);
  assert.match(script, /setpriv --reuid "\$JSKIT_HOST_UID" --regid "\$JSKIT_HOST_GID"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace commit -m "\$JSKIT_COMMIT_MESSAGE"/u);
  assert.match(script, /as_host git -c safe\.directory=\/workspace -c credential\.helper= push -u origin HEAD/u);
  assert.match(script, /GIT_TERMINAL_PROMPT=0/u);
  assert.doesNotMatch(script, /Working tree is already clean/u);
  assertShellScriptSurvivesWhitespaceCollapse(script);
});

test("App Setup Doctor builds GitHub branch ref API paths", () => {
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "main"),
    "repos/mercmobily/exampleapp/git/ref/heads/main"
  );
  assert.equal(
    githubBranchRefApiPath("mercmobily/exampleapp", "feature/setup baseline"),
    "repos/mercmobily/exampleapp/git/ref/heads/feature/setup%20baseline"
  );
});

test("App Setup Doctor parses config package imports", () => {
  assert.deepEqual(configImportSpecifiersFromText(`
    import "node:test";
    import "./local.js";
    import { baseConfig } from "@jskit-ai/config-eslint/server";
    const plugin = await import("@vitejs/plugin-vue");
  `), [
    "@jskit-ai/config-eslint/server",
    "@vitejs/plugin-vue"
  ]);
});

test("App Setup Doctor catches stale config package subpath exports", async () => {
  const targetRoot = await mkdtemp(path.join(os.tmpdir(), "jskit-app-setup-config-imports-"));
  await writeFile(
    path.join(targetRoot, "eslint.config.mjs"),
    "import { baseConfig } from '@jskit-ai/config-eslint/server';\nexport default baseConfig;\n",
    "utf8"
  );
  await mkdir(path.join(targetRoot, "node_modules", "@jskit-ai", "config-eslint"), {
    recursive: true
  });
  await writeFile(
    path.join(targetRoot, "node_modules", "@jskit-ai", "config-eslint", "package.json"),
    JSON.stringify({
      description: "Retired",
      name: "@jskit-ai/config-eslint",
      type: "module",
      version: "0.1.3"
    }),
    "utf8"
  );

  assert.deepEqual(await configImportProblems(targetRoot), [
    "eslint.config.mjs: @jskit-ai/config-eslint/server is not present in @jskit-ai/config-eslint@0.1.3."
  ]);
});

test("App Setup Doctor recognizes a doctor result with only UI verification receipt issues", () => {
  const output = `
Doctor status: unhealthy (1 issue(s))
- [ui:verification] changed UI files require a matching .jskit/verification/ui.json receipt. Run jskit app verify-ui --command "<playwright command>" --feature "<label>" --auth-mode <mode>.
jskit: /workspace/node_modules/.bin/jskit failed with exit code 1 (cwd: /workspace).
`;

  assert.deepEqual(doctorIssueLines(output), [
    "- [ui:verification] changed UI files require a matching .jskit/verification/ui.json receipt. Run jskit app verify-ui --command \"<playwright command>\" --feature \"<label>\" --auth-mode <mode>."
  ]);
  assert.equal(onlyUiVerificationDoctorIssues(output), true);
});

test("App Setup Doctor does not ignore non-UI doctor issues", () => {
  const output = `
Doctor status: unhealthy (2 issue(s))
- [ui:verification] changed UI files require a matching .jskit/verification/ui.json receipt.
- [server:verification] changed server files require a matching verification receipt.
`;

  assert.equal(onlyUiVerificationDoctorIssues(output), false);
});
