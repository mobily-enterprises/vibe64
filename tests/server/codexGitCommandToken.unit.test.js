// A command of the AI's that carries the session's GitHub token runs no
// program the AI chose (codexGitCommandToken.js).

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runVibe64Command } from "../../packages/vibe64-execution/src/server/runVibe64Command.js";
import { currentOsUser } from "@local/vibe64-core/server/osUserIdentity";
import { VIBE64_RUNTIME_NAMESPACE_ENV } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "@local/vibe64-core/server/sessionSourcePath";
import { createCodexGitCommandService, prepareCodexGitCommand } from "@local/vibe64-terminals/server/codexGitCommand";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";
import { endChildInput } from "./childInputTestHelpers.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const TOKEN = "secret-github-token";
const REFUSED = "vibe64_codex_git_command_token_refused";

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

function githubSession(root) {
  const sessionId = "token-session";
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  const user = currentOsUser();
  return {
    id: sessionId,
    metadata: {
      github_repository: "owner/repo",
      session_git_command_actor_reason: "unit-test",
      session_git_command_actor_scope: "user",
      session_git_command_actor_session_id: sessionId,
      session_git_command_actor_source_root: sourcePath,
      session_git_command_actor_thread_id: "thread-1",
      session_git_command_actor_user_key: user.username,
      session_git_command_actor_workdir: sourcePath,
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      source_remote_url: "https://github.com/owner/repo.git"
    },
    sessionId
  };
}

function serviceForSession(session, runGatewayCommand) {
  return createCodexGitCommandService({
    env: process.env,
    logger: silentLogger,
    project: {
      currentProjectSlug: () => "",
      async createSessionStore() {
        return {
          async readMetadataValue(_sessionId, name) {
            return session.metadata[name] || "";
          },
          async readSessionSourceDescriptor(sessionId) {
            return { metadata: { ...session.metadata }, sessionId };
          }
        };
      }
    },
    runGatewayCommand
  });
}

const isTokenRead = (request) => request.command === "gh" && request.args[0] === "auth";

// Checks every row, then fails once naming each row that failed, so a rule
// that lets cases through shows all of them.
async function eachRow(rows, check) {
  const failed = [];
  for (const row of rows) {
    try {
      await check(...row);
    } catch (error) {
      failed.push(`${JSON.stringify(row.slice(0, 2))}: ${String(error.message).split("\n")[0]}`);
    }
  }
  assert.deepEqual(failed, []);
}

// A gateway that answers the token read and runs nothing else.
function recordingGateway(calls) {
  return async (request) => {
    calls.push(request);
    return isTokenRead(request) ? { exitCode: 0, ok: true, stdout: `${TOKEN}\n` } : { exitCode: 0, ok: true, stdout: "" };
  };
}

test("a command with the session's GitHub token refuses an option, a shell variable or a gh command that names a program, before anything runs", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    const source = session.metadata.source_path;
    await mkdir(source, { recursive: true });
    const calls = [];
    const service = serviceForSession(session, recordingGateway(calls));
    const run = (command, args, env = {}) => service.run({ args, command, cwd: source, env, sessionId: session.sessionId });
    const clone = "https://github.com/owner/other.git";
    await eachRow([
      ["git", ["-c", "credential.helper=!cat", "fetch", "origin"], {}, /-c credential\.helper/u],
      ["git", ["-c", "core.sshCommand=ssh -oProxyCommand=id", "fetch"], {}, /core\.sshCommand/u],
      ["git", ["-c", "core.hooksPath=.husky", "push", "origin", "main"], {}, /core\.hooksPath/u],
      ["git", ["-c", "include.path=/tmp/more", "pull"], {}, /include\.path/u],
      ["git", ["-c", "http.sslVerify=false", "fetch"], {}, /TLS setting/u],
      ["git", ["--config-env=core.askPass=VIBE64_GIT_AUTH_TOKEN", "fetch"], {}, /--config-env/u],
      ["git", ["--config-env", "credential.helper=VIBE64_GIT_AUTH_TOKEN", "fetch"], {}, /--config-env/u],
      ["git", ["--exec-path=/tmp/programs", "push", "origin", "main"], {}, /--exec-path/u],
      ["git", ["fetch", "--upload-pack=sh -c id", "origin"], {}, /--upload-pack/u],
      ["git", ["fetch", "--upload=sh", "origin"], {}, /--upload-pack/u],
      ["git", ["ls-remote", "-u", "sh", "origin"], {}, /-u names the program/u],
      ["git", ["clone", "-u", "sh", clone], {}, /-u names the program/u],
      ["git", ["clone", "--template=/tmp/hooks", clone], {}, /copies hooks/u],
      ["git", ["clone", "-c", "filter.x.smudge=cat", clone], {}, /filter\.x\.smudge is a filter program/u],
      ["git", ["push", "--receive-pack=sh", "origin", "main"], {}, /--receive-pack/u],
      ["git", ["push", "--exec", "sh", "origin", "main"], {}, /--exec/u],
      ["git", ["push", "--signed", "origin", "main"], {}, /signing program/u],
      ["git", ["push", "--recurse-submodules=on-demand", "origin", "main"], {}, /submodules/u],
      ["git", ["fetch", "--recurse-submodules", "origin"], {}, /submodules/u],
      ["git", ["pull", "-S", "origin", "main"], {}, /signing program/u],
      ["git", ["pull", "--verify-signatures", "origin", "main"], {}, /signing program/u],
      ["git", ["pull", "-s", "evil", "origin", "main"], {}, /merge strategy/u],
      ["git", ["pull", "--strategy=evil", "origin", "main"], {}, /merge strategy/u],
      ["git", ["fetch"], { GIT_SSH_COMMAND: "ssh -oProxyCommand=id" }, /env -u GIT_SSH_COMMAND git/u],
      ["git", ["push"], { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.sshCommand", GIT_CONFIG_VALUE_0: "id" }, /GIT_CONFIG_COUNT/u],
      ["git", ["fetch"], { GIT_EXEC_PATH: "/tmp/programs" }, /GIT_EXEC_PATH/u],
      ["gh", ["auth", "token"], {}, /gh auth shows or changes/u],
      ["gh", ["auth", "status", "--show-token"], {}, /gh auth shows or changes/u],
      ["gh", ["alias", "set", "co", "!cat"], {}, /gh alias is not one/u],
      ["gh", ["extension", "install", "owner/gh-tool"], {}, /gh extension is not one/u],
      ["gh", ["config", "set", "http_unix_socket", "/tmp/socket"], {}, /gh config is not one/u],
      ["gh", ["tool"], {}, /gh tool is not one/u],
      ["gh", ["codespace", "ssh"], {}, /gh codespace is not one/u],
      ["gh", ["pr", "list"], { GIT_ASKPASS: "/tmp/askpass" }, /GIT_ASKPASS/u]
    ], async (command, args, env, shown) => {
      const result = await run(command, args, env);
      assert.equal(result.code, REFUSED, `${result.code || "ran"} ${result.error || ""}`);
      assert.match(result.error, shown);
      assert.match(result.error, /[Ll]eave it out|use one of those|unset it|Use gh's own commands|signs in to GitHub in Vibe64/u);
    });
    assert.deepEqual(calls, [], "nothing ran and no token was read");

    // Git's own options and harmless config still run, with what the token
    // command switches off.
    await eachRow([
      ["git", ["push", "-u", "origin", "main"], {}],
      ["git", ["fetch", "-u", "origin"], {}],
      ["git", ["pull", "--verify", "-s", "ort", "-X", "ours", "origin", "main"], {}],
      ["git", ["-c", "http.postBuffer=524288000", "push", "origin", "main"], {}],
      ["git", ["push", "--recurse-submodules=no", "--no-signed", "-o", "--exec=not-an-option", "origin", "main"], {}],
      ["git", ["clone", "-c", "core.autocrlf=false", clone, "other"], {}],
      ["git", ["fetch", "origin"], { GIT_CONFIG_COUNT: "0" }],
      ["gh", ["pr", "list"], {}],
      ["gh", ["api", "user"], {}]
    ], async (command, args, env) => {
      calls.length = 0;
      const result = await run(command, args, env);
      assert.equal(result.ok, true, result.error);
      const ran = calls.at(-1);
      assert.deepEqual(ran.args, args);
      assert.equal(ran.env.GIT_ALLOW_PROTOCOL, "https");
      assert.match(ran.env.GIT_CONFIG_PARAMETERS || "", /'core\.hooksPath'='\/dev\/null'/u);
      assert.equal(ran.env.GIT_EDITOR, ":");
      if (command === "gh") assert.equal(ran.env.GH_TOKEN, TOKEN);
      else assert.equal(ran.gitAuthToken, TOKEN);
    });
  });
});

test("only Git commands that reach GitHub carry the token; the rest keep their options, the shell's variables and the repository's hooks", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    const source = session.metadata.source_path;
    await mkdir(source, { recursive: true });
    const calls = [];
    const service = serviceForSession(session, recordingGateway(calls));
    await eachRow([
      // `git credential fill` printed the token with it.
      [["credential", "fill"], "protocol=https\nhost=github.com\n\n"],
      [["submodule", "foreach", "env"]],
      [["show-me-the-token"]],
      [["fetch", path.join(root, "elsewhere.git")]],
      [["pull", "../scratch", "main"]],
      [["push", "file:///tmp/scratch", "main"]],
      [["-c", "core.hooksPath=.husky", "-c", "core.sshCommand=id", "commit", "--allow-empty", "-m", "x"]]
    ], async (args, inputText = "") => {
      calls.length = 0;
      const result = await service.run({
        args,
        command: "git",
        cwd: source,
        env: { GIT_SSH_COMMAND: "id" },
        inputBase64: Buffer.from(inputText).toString("base64"),
        sessionId: session.sessionId
      });
      assert.equal(result.ok, true, result.error);
      assert.equal(calls.some(isTokenRead), false, "read no token");
      assert.equal(calls.length, 1, "ran alone, with no config read");
      assert.deepEqual(calls[0].args, args);
      assert.equal(calls[0].gitTransport, "none");
      assert.equal(calls[0].gitAuthToken, "");
      assert.equal(calls[0].env.GIT_ALLOW_PROTOCOL, undefined);
      assert.equal(calls[0].env.GIT_CONFIG_PARAMETERS, undefined);
    });
    calls.length = 0;
    assert.equal((await service.run({ args: ["fetch", "origin"], command: "git", cwd: source, sessionId: session.sessionId })).ok, true);
    assert.equal(calls.filter(isTokenRead).length, 1);
    assert.equal(calls.at(-1).gitTransport, "github-token");
  });
});

// The session's source with a GitHub origin, served by a stand-in for
// git-remote-https from a repository on this computer: it asks Git for the
// credential as git-remote-https does and writes what it got to `credential`.
// Hooks, fsmonitor and the repository's credential helper log their names to
// `log`, with "token" when the session's token was in their environment.
async function tokenTransportFixture(root) {
  const session = githubSession(root);
  const source = session.metadata.source_path;
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
  const calls = [];
  const service = serviceForSession(session, async (request) => {
    calls.push(request);
    if (isTokenRead(request)) return { exitCode: 0, ok: true, stdout: `${TOKEN}\n` };
    // This computer's Git, apart from the person's own config, with the
    // stand-in transport.
    return runVibe64Command({ ...request, env: { ...request.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1", GIT_EXEC_PATH: execPath } });
  });
  const run = (args, { command = "git", env = {} } = {}) => service.run({ args, command, cwd: source, env, sessionId: session.sessionId });
  const programsRun = async () => (await readFile(log, "utf8")).split("\n").filter(Boolean);
  return { bare, calls, credential, git, program, programsRun, run, source, upstream };
}

test("fetch, pull and push with the session's token still work and run none of the repository's hooks, fsmonitor or credential helpers", async () => {
  await withTemporaryRoot(async (root) => {
    const fixture = await tokenTransportFixture(root);
    const { git, program, source } = fixture;
    const hooks = path.join(source, ".git", "hooks");
    for (const name of ["pre-push", "reference-transaction", "post-merge", "post-checkout", "post-commit"]) {
      await program(path.join(hooks, name), name);
    }
    await git(source, ["config", "core.fsmonitor", await program(path.join(root, "programs", "fsmonitor"), "fsmonitor")]);
    await git(source, ["config", "credential.helper", `!${await program(path.join(root, "programs", "helper"), "helper")}`]);
    await git(fixture.upstream, ["commit", "--quiet", "--allow-empty", "-m", "upstream change"]);
    await git(fixture.upstream, ["push", "--quiet", "origin", "main"]);
    const upstreamHead = await git(fixture.upstream, ["rev-parse", "HEAD"]);

    const fetched = await fixture.run(["fetch", "origin"]);
    assert.equal(fetched.ok, true, fetched.error || Buffer.from(fetched.stderr || "", "base64").toString());
    assert.equal(await git(source, ["rev-parse", "origin/main"]), upstreamHead);
    // Vibe64's credential helper, the only one, gave the transport the token.
    assert.match(await readFile(fixture.credential, "utf8"), new RegExp(`^password=${TOKEN}$`, "mu"));
    const pulled = await fixture.run(["pull", "--ff-only", "origin", "main"]);
    assert.equal(pulled.ok, true, pulled.error);
    assert.equal(await git(source, ["rev-parse", "HEAD"]), upstreamHead);
    assert.deepEqual(await fixture.programsRun(), [], "no hook, fsmonitor or helper ran");

    // Git run without the token runs them: they are there and run.
    await git(source, ["commit", "--quiet", "--allow-empty", "-m", "local"]);
    assert.ok((await fixture.programsRun()).includes("post-commit "));
    const pushed = await fixture.run(["push", "origin", "HEAD:main"]);
    assert.equal(pushed.ok, true, pushed.error);
    assert.equal(await git(fixture.bare, ["rev-parse", "main"]), await git(source, ["rev-parse", "HEAD"]));

    // A hooks folder the repository's config names is switched off too.
    await git(source, ["config", "core.hooksPath", "custom-hooks"]);
    await program(path.join(source, "custom-hooks", "pre-push"), "custom-pre-push");
    await git(source, ["commit", "--quiet", "--allow-empty", "-m", "custom"]);
    assert.equal((await fixture.run(["push", "origin", "HEAD:main"])).ok, true);
    const ran = await fixture.programsRun();
    assert.deepEqual(ran.filter((line) => line.endsWith("token")), [], ran.join("\n"));
    assert.equal(ran.some((line) => line.startsWith("pre-push") || line.startsWith("custom-pre-push")), false, ran.join("\n"));
  });
});

test("a repository whose own config names a program or weakens TLS refuses a command with the token, naming the setting and where it is", async () => {
  await withTemporaryRoot(async (root) => {
    const fixture = await tokenTransportFixture(root);
    const { git, source } = fixture;
    const included = path.join(root, "included.gitconfig");
    await writeFile(included, "[merge \"union-ish\"]\n\tdriver = cat %A\n");
    await eachRow([
      [["filter.lfs.smudge", "cat"], ["fetch", "origin"], "filter.lfs.smudge", ".git/config"],
      [["include.path", included], ["pull", "origin", "main"], "merge.union-ish.driver", included],
      [["http.https://github.com/.sslVerify", "false"], ["push", "origin", "main"], "http.https://github.com/.sslverify", ".git/config"],
      [["http.sslCAInfo", path.join(root, "ca.pem")], ["ls-remote", "origin"], "http.sslcainfo", ".git/config"],
      [["diff.lockb.textconv", "cat"], ["pull", "origin", "main"], "diff.lockb.textconv", ".git/config"],
      [["pull.twohead", "evil"], ["pull", "origin", "main"], "pull.twohead", ".git/config"],
      [["core.alternateRefsCommand", "cat"], ["fetch", "origin"], "core.alternaterefscommand", ".git/config"]
    ], async (setting, args, key, file) => {
      await git(source, ["config", ...setting]);
      fixture.calls.length = 0;
      try {
        const result = await fixture.run(args);
        assert.equal(result.code, REFUSED, `${result.code || "ran"} ${result.error || ""}`);
        assert.ok(result.error.includes(`sets ${key} (${file})`), result.error);
        const unset = file === included ? `git config --file ${included}` : "git config --local";
        assert.ok(result.error.includes(`${unset} --unset-all ${key}`), result.error);
        assert.equal(fixture.calls.filter((request) => request.gitTransport === "github-token").length, 0, "the command did not run");
      } finally {
        await git(source, ["config", "--unset-all", setting[0]]);
      }
    });
    // What the command switches off, or cannot reach, and the person's own
    // global config are no reason to refuse.
    for (const setting of [
      ["http.postBuffer", "524288000"],
      ["http.sslVerify", "true"],
      ["core.hooksPath", ".husky"],
      ["credential.helper", "!cat"],
      ["core.sshCommand", "ssh -oProxyCommand=id"],
      ["pull.twohead", "ort"]
    ]) await git(source, ["config", ...setting]);
    await git(root, ["config", "--global", "filter.lfs.smudge", "git-lfs smudge -- %f"]);
    const fetched = await fixture.run(["fetch", "origin"]);
    assert.equal(fetched.ok, true, fetched.error);
  });
});

test("a command with the token reaches GitHub over HTTPS only, and one naming a repository on this computer runs without the token", async () => {
  await withTemporaryRoot(async (root) => {
    const fixture = await tokenTransportFixture(root);
    const { git, source } = fixture;
    const marker = path.join(root, "ext-ran");
    await git(source, ["remote", "add", "scratch", fixture.bare]);
    await git(source, ["config", "protocol.ext.allow", "always"]);
    await git(source, ["remote", "add", "ext", `ext::sh -c touch% ${marker}`]);
    await eachRow([["scratch", "file"], ["ext", "ext"]], async (remote, transport) => {
      const result = await fixture.run(["fetch", remote]);
      assert.equal(result.ok, false, "fetched");
      assert.match(Buffer.from(result.stderr || "", "base64").toString("utf8"), new RegExp(`transport '${transport}' not allowed`, "u"));
      if (remote === "ext") await assert.rejects(readFile(marker), { code: "ENOENT" }, "the ext:: command ran");
    });

    fixture.calls.length = 0;
    const local = await fixture.run(["fetch", fixture.bare, "main"]);
    assert.equal(local.ok, true, local.error);
    assert.equal(fixture.calls.some(isTokenRead), false);
    assert.equal(fixture.calls.at(-1).gitTransport, "none");
  });
});

test("the wrapper sends the shell's variables that name a program, which a command with the token refuses", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    const source = session.metadata.source_path;
    await mkdir(source, { recursive: true });
    const calls = [];
    const service = serviceForSession(session, recordingGateway(calls));
    const prepared = await prepareCodexGitCommand({
      commandService: service,
      env: { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId: session.sessionId,
      stateRoot: root
    });
    const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));
    const wrapper = (env) => runProcess(path.join(prepared.hostWrapperDir, "git"), ["fetch", "origin"], {
      cwd: source,
      env: { ...baseEnv, ...prepared.env, ...env }
    });
    const refused = await wrapper({ GIT_SSH_COMMAND: "ssh -oProxyCommand=id" });
    assert.notEqual(refused.exitCode, 0);
    assert.match(refused.stderr, /This shell sets GIT_SSH_COMMAND/u);
    assert.deepEqual(calls, []);
    const ran = await wrapper({ GIT_CONFIG_COUNT: "0" });
    assert.equal(ran.exitCode, 0, ran.stderr);
    assert.equal(calls.at(-1).gitTransport, "github-token");
  });
});
