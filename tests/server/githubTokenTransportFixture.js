// A session's source whose origin is GitHub, served by a stand-in for
// git-remote-https from a bare repository on this computer, for tests of Git
// that carries the session's GitHub token (githubTokenGit.js). The stand-in
// asks Git for the credential as git-remote-https does and writes what it got
// to `credential`. Programs made with `program` (hooks, fsmonitor, a
// credential helper) log their name to `log`, followed by "token" when the
// session's token was in their environment.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { endChildInput } from "./childInputTestHelpers.js";

function runProcess(command, args = [], { cwd = "", env = process.env, input = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({
      exitCode,
      stderr: Buffer.concat(stderr).toString("utf8"),
      stdout: Buffer.concat(stdout).toString("utf8")
    }));
    endChildInput(child, input);
  });
}

/**
 * @param {string} root the test's own folder
 * @param {string} source where the session's source goes
 */
async function githubTokenTransportFixture(root, source) {
  const bare = path.join(root, "github", "repo.git");
  const upstream = path.join(root, "upstream");
  const globalConfig = path.join(root, "global.gitconfig");
  const credential = path.join(root, "credential");
  const log = path.join(root, "programs.log");
  await writeFile(globalConfig, "[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n");
  await writeFile(log, "");
  const plain = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    HOME: root,
    PATH: process.env.PATH
  };
  const git = async (cwd, args) => {
    const result = await runProcess("git", args, { cwd, env: plain });
    assert.equal(result.exitCode, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await mkdir(source, { recursive: true });
  await mkdir(path.dirname(bare), { recursive: true });
  await git(root, ["init", "--quiet", "--bare", "-b", "main", bare]);
  await git(source, ["init", "--quiet", "-b", "main"]);
  await git(source, ["commit", "--quiet", "--allow-empty", "-m", "first"]);
  await git(source, ["push", "--quiet", bare, "main"]);
  await git(source, ["remote", "add", "origin", "https://github.com/owner/repo.git"]);
  await git(root, ["clone", "--quiet", bare, upstream]);

  const execPath = path.join(root, "exec-path");
  await mkdir(execPath);
  const gitExecPath = await git(root, ["--exec-path"]);
  for (const name of await readdir(gitExecPath)) {
    if (!/^git-remote-(?:https?|ftps?)$/u.test(name)) await symlink(path.join(gitExecPath, name), path.join(execPath, name));
  }
  await writeFile(path.join(execPath, "git-remote-https"), [
    "#!/bin/sh",
    "while read -r line; do",
    "  case \"$line\" in",
    "    capabilities) printf 'connect\\n\\n' ;;",
    "    connect\\ *)",
    `      printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill > '${credential}' 2>/dev/null`,
    "      printf '\\n'",
    "      service=${line#connect git-}",
    "      unset GIT_DIR GIT_WORK_TREE",
    `      exec git "$service" '${bare}' ;;`,
    "    *) exit 1 ;;",
    "  esac",
    "done",
    ""
  ].join("\n"));
  await chmod(path.join(execPath, "git-remote-https"), 0o755);

  const program = async (file, name) => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `#!/bin/sh\necho "${name} \${VIBE64_GIT_AUTH_TOKEN:+token}\${GH_TOKEN:+token}" >> '${log}'\nexit 0\n`);
    await chmod(file, 0o755);
    return file;
  };
  return {
    bare,
    credential,
    git,
    program,
    programsRun: async () => (await readFile(log, "utf8")).split("\n").filter(Boolean),
    // This computer's Git, apart from the person's own config, with the
    // stand-in transport.
    runGateway: (request) => runVibe64Command({
      ...request,
      env: { ...request.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_EXEC_PATH: execPath }
    }),
    upstream
  };
}

export { githubTokenTransportFixture, runProcess };
