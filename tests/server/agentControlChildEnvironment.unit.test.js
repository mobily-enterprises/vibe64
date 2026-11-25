// A project's own tests often run their children with every secret-looking variable blanked (Mercbot Online's
// tests/server/composedApp.integration.js blanks each name ending _TOKEN, _API_KEY and the like), with those variables
// removed, or with nothing but PATH. In a Vibe64 session those children are still the session's: the managed commands
// they run (git, gh, vibe64-env, vibe64-database, vibe64-pages, vibe64-preview, vibe64-session and vibe64-plan) reach
// the session's control as the agent's own commands do, and the control still checks the session, token and
// generation. The shell-execution wrapper stays out of a managed child's reach, as it always was.

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareAgentDatabaseCommand } from "../../packages/vibe64-terminals/src/server/agentDatabaseCommand.js";
import { prepareAgentEnvCommand } from "../../packages/vibe64-terminals/src/server/agentEnvCommand.js";
import { prepareAgentPagesCommand } from "../../packages/vibe64-terminals/src/server/agentPagesCommand.js";
import { prepareAgentPreviewCommand } from "../../packages/vibe64-terminals/src/server/agentPreviewCommand.js";
import { prepareAgentSessionCommand } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { prepareCodexGitCommand, removeCodexGitCommandSession } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";

// The project test's own pattern, as it blanks what it takes for a credential.
const CREDENTIAL = /(_API_KEY|_CLIENT_ID|_CLIENT_SECRET|_SECRET_KEY|_SITE_KEY|_ACCESS_KEY_ID|_SECRET_ACCESS_KEY|_TOKEN)$/u;

const root = await mkdtemp(path.join(os.tmpdir(), "v64-ctl-env-"));
// Every control socket of this file lands in its own folder, removed at the end.
process.env.TMPDIR = path.join(root, "tmp");
await mkdir(process.env.TMPDIR, { recursive: true });
test.after(() => rm(root, { force: true, recursive: true }));

function run(command, args, env, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stderr, stdout }));
    child.stdin.end(input);
  });
}

/** The environments a project's test gives its children, from the one the agent's command received. */
function childEnvironments(agentEnv) {
  return {
    blanked: Object.fromEntries(Object.entries(agentEnv).map(([name, value]) => [name, CREDENTIAL.test(name) ? "" : value])),
    removed: Object.fromEntries(Object.entries(agentEnv).filter(([name]) => !CREDENTIAL.test(name))),
    "PATH only": { PATH: agentEnv.PATH }
  };
}

async function prepareSessionControls(sessionId) {
  const answer = (control) => async (input) => ({ ok: true, exitCode: 0, stdout: `${control} ${input.sessionId}` });
  const git = await prepareCodexGitCommand({
    commandService: { logger: silentLogger, run: async (input) => answer(input.command)(input) },
    env: { TMPDIR: process.env.TMPDIR, VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
    sessionId,
    stateRoot: root
  });
  const wrapperHostDir = git.hostWrapperDir;
  const bound = { bindSession: async () => null, logger: silentLogger };
  const steps = await Promise.all([
    prepareAgentEnvCommand({ commandService: { ...bound, offersStaging: false, run: answer("env") }, sessionId, wrapperHostDir }),
    prepareAgentDatabaseCommand({ commandService: { ...bound, run: answer("database") }, sessionId, wrapperHostDir }),
    prepareAgentPagesCommand({ commandService: { ...bound, run: answer("pages") }, sessionId, wrapperHostDir }),
    prepareAgentPreviewCommand({
      commandService: { logger: silentLogger, registerBrowserWorker() {}, run: answer("preview") },
      env: process.env,
      sessionId,
      wrapperHostDir
    }),
    prepareAgentSessionCommand({
      commandService: {
        ...bound,
        managePlan: async (id, fields) => ({ ok: true, plan: `${fields.operation} ${id}` }),
        sessionStatus: async (id) => ({ ok: true, status: `session ${id}` })
      },
      sessionId,
      wrapperHostDir
    })
  ]);
  for (const step of [git, ...steps]) assert.equal(step.ok, true);
  const agentEnv = {
    ...process.env,
    ...Object.assign({}, git.env, ...steps.map((step) => step.env)),
    PATH: [wrapperHostDir, path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter)
  };
  return { agentEnv, wrapperHostDir };
}

// Each managed command a child runs, and what its control answers it.
const COMMANDS = [
  { command: "git", args: ["rev-parse", "--show-toplevel"], answer: "git" },
  { command: "gh", args: ["pr", "list"], answer: "gh" },
  { command: "vibe64-env", args: ["status"], answer: "env" },
  { command: "vibe64-database", args: ["overview"], answer: "database" },
  { command: "vibe64-pages", args: ["list"], answer: "pages" },
  { command: "vibe64-preview", args: ["status"], answer: "preview" },
  { command: "vibe64-session", args: ["status"], answer: "session", json: "status" },
  { command: "vibe64-plan", args: ["read"], answer: "read", json: "plan" }
];

test("a child whose environment has secret-looking variables blanked, removed or only PATH runs the session's managed commands", async () => {
  const sessionId = "scrubbed-child-session";
  const { agentEnv, wrapperHostDir } = await prepareSessionControls(sessionId);
  try {
    for (const [label, env] of Object.entries({ agent: agentEnv, ...childEnvironments(agentEnv) })) {
      for (const { answer, args, command, json } of COMMANDS) {
        const result = await run(command, args, env);
        assert.equal(result.exitCode, 0, `${command} in a child with ${label}: ${result.stderr}`);
        const said = json ? JSON.parse(result.stdout)[json] : result.stdout.trim();
        assert.equal(said, `${answer} ${sessionId}`, `${command} in a child with ${label}`);
      }
    }

    // What names the control to such a child: one file per control, in the session's own helper directory, that only
    // this account reads. The session's holds its control token, never the shell-execution token.
    const controls = path.join(wrapperHostDir, "controls");
    assert.equal((await stat(controls)).mode & 0o777, 0o700);
    for (const control of ["git", "env", "database", "pages", "preview", "session"]) {
      assert.equal((await stat(path.join(controls, `${control}.json`))).mode & 0o777, 0o600, control);
    }
    const sessionControl = await readFile(path.join(controls, "session.json"), "utf8");
    assert.equal(JSON.parse(sessionControl).token, JSON.parse(agentEnv.VIBE64_SESSION_RENAME_CONTROL).token);
    assert.ok(!sessionControl.includes(agentEnv.VIBE64_AGENT_SESSION_COMMAND_TOKEN));

    // The shell-execution wrapper still refuses a managed child, whatever its environment.
    for (const [label, env] of Object.entries(childEnvironments(agentEnv))) {
      const shell = await run("vibe64-session-command", ["true"], env);
      assert.equal(shell.exitCode, 1, label);
      assert.match(shell.stderr, /Session command control is unavailable/u, label);
    }

    // The environment still decides when it names the whole control: a stale generation is refused as before.
    const stale = await run("git", ["status"], { ...agentEnv, VIBE64_CODEX_GIT_COMMAND_GENERATION: "stale" });
    assert.equal(stale.exitCode, 1);
    assert.match(stale.stderr, /generation is no longer current/u);

    // And the control checks what the file names: a token that is not the control's is refused, the command unsent.
    const gitControl = path.join(controls, "git.json");
    await writeFile(gitControl, JSON.stringify({ ...JSON.parse(await readFile(gitControl, "utf8")), token: "forged" }));
    const forged = await run("git", ["status"], { PATH: agentEnv.PATH });
    assert.equal(forged.exitCode, 1);
    assert.match(forged.stderr, /vibe64_agent_control_unavailable/u);
    assert.match(forged.stderr, /The requested command was not submitted/u);
  } finally {
    await removeCodexGitCommandSession({ env: { TMPDIR: process.env.TMPDIR, VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") },
      sessionId, stateRoot: root });
  }
});
