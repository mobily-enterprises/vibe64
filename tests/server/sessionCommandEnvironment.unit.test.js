// A host's own command in a session (a check it runs there, say) reaches the session's managed commands as the
// session's AI engines do: prepareSessionCommandEnvironment gives it the env that names the session's controls and the
// session's wrappers' folder first in its shimDirs, the folder runVibe64Command puts first on a command's PATH. Here
// the preparation is the real one (its sockets, wrappers, control tokens and vibe64-helper's dispatcher); only what
// each control answers is this file's.

import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareSessionCommandEnvironment } from "../../packages/vibe64-terminals/src/server/agentCommandEnvironment.js";
import { removeCodexGitCommandSession } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";

const root = await mkdtemp(path.join(os.tmpdir(), "v64-ses-env-"));
// Every control socket of this file lands in its own folder, removed at the end.
process.env.TMPDIR = path.join(root, "tmp");
await mkdir(process.env.TMPDIR, { recursive: true });
test.after(() => rm(root, { force: true, recursive: true }));

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stderr, stdout }));
  });
}

test("a host's command in a session runs vibe64-helper from the session's wrappers, answered by the session's own control", async () => {
  const sessionId = "host-command-session";
  const answer = (control) => async (input) => ({ ok: true, exitCode: 0, stdout: `${control} ${input.sessionId}` });
  const bound = { bindSession: async () => null, logger: silentLogger };
  const commands = {
    agentDatabaseCommand: { ...bound, run: answer("database") },
    agentEnvCommand: { ...bound, offersStaging: false, run: answer("env") },
    agentPagesCommand: { ...bound, run: answer("pages") },
    agentPreviewCommand: { logger: silentLogger, registerBrowserWorker() {}, run: answer("preview") },
    agentSessionCommand: { ...bound, helperGroups: [], sessionStatus: async (id) => ({ ok: true, status: `session ${id}` }) },
    codexGitCommand: { logger: silentLogger, run: async (input) => answer(input.command)(input) }
  };
  const env = { TMPDIR: process.env.TMPDIR, VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments") };
  const source = path.join(root, "source");
  await mkdir(source, { recursive: true });
  const prepared = await prepareSessionCommandEnvironment({
    commands,
    env,
    project: { readCurrentProject: async () => ({ slug: "catalogue" }) },
    // A project runtime's own state folder and session store (this session keeps no drop zones).
    runtime: { stateRoot: root, store: { paths: () => ({}), prepareProjectFileAreas: async () => {} } },
    session: { sessionId, metadata: { source_path: source } },
    sessionId
  });
  try {
    assert.ok(path.isAbsolute(prepared.hostWrapperDir));
    assert.equal(prepared.shimDirs[0], prepared.hostWrapperDir, "the session's wrappers come first on the command's PATH");
    assert.ok(!("PATH" in prepared.env), "PATH is the command runner's, through shimDirs");
    const PATH = [...prepared.shimDirs, path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter);
    const status = await run("vibe64-helper", ["session", "status", "--json"], { ...process.env, ...prepared.env, PATH });
    assert.equal(status.exitCode, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).status, `session ${sessionId}`);
    // Without the prepared env the same helper has no session to reach.
    const unprepared = await run("vibe64-helper", ["session", "status", "--json"], { PATH });
    assert.notEqual(unprepared.exitCode, 0);
  } finally {
    await removeCodexGitCommandSession({ env, sessionId, stateRoot: root });
  }
});
