import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { commandDatabaseServer } from "../../packages/vibe64-terminals/src/server/agentCommandDatabaseServers.js";
import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import {
  AGENT_SESSION_COMMAND_TIMEOUT_MS,
  commandRunnerSource
} from "../../packages/vibe64-terminals/src/server/agentSessionCommandRun.js";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

// A database server an agent command starts dies with the command, at the latest at its 30-minute limit, and takes every
// test using it along. The AI hears of one at once, found by its executable among the command's own processes, and a
// command that reaches its limit answers with what it wrote and where long-lived work runs instead.

const execFileAsync = promisify(execFile);
const LIMIT_MINUTES = AGENT_SESSION_COMMAND_TIMEOUT_MS / 60_000;

/** /proc/<pid>/stat text for a process of group `groupId`. */
function statText(pid, name, groupId) {
  const fields = ["S", "1", String(groupId), String(groupId), "0", "-1", "0", ...Array(10).fill("0"), "1", "0", "4242", "0"];
  return `${pid} (${name}) ${fields.join(" ")}\n`;
}

test("a command's database server is found by its executable in its unit's control group, the groups below it, or else its process group", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-command-db-servers-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const procRoot = path.join(root, "proc");
  const cgroupRoot = path.join(root, "cgroup");
  const unit = "vibe64.slice/vibe64-ws.slice/vibe64-ws-work.slice/vibe64-exec-ws-0123abcd.service";
  async function proc(pid, { cgroup = "", exe = "", stat = "" } = {}) {
    await mkdir(path.join(procRoot, String(pid)), { recursive: true });
    if (cgroup) await writeFile(path.join(procRoot, String(pid), "cgroup"), `0::/${cgroup}\n`);
    if (exe) await symlink(exe, path.join(procRoot, String(pid), "exe"));
    if (stat) await writeFile(path.join(procRoot, String(pid), "stat"), stat);
  }
  await proc("self", { cgroup: "system.slice/vibe64-ws-editor.service" });
  // The runner, and in its unit a server that left the runner's process group (setsid) and its parent (a daemon's
  // fork): the unit's control group still holds it.
  await proc(100, { cgroup: unit, exe: "/usr/bin/bash", stat: statText(100, "bash", 100) });
  await proc(101, { cgroup: unit, exe: "/srv/runtime-packs/mariadb/bin/mariadbd", stat: statText(101, "mariadbd", 101) });
  // Outside the unit, in the runner's process group: not the command's on a host whose units hold its commands.
  await proc(103, { cgroup: "system.slice/other.service", exe: "/usr/sbin/mysqld", stat: statText(103, "mysqld", 100) });
  await mkdir(path.join(cgroupRoot, unit, "below"), { recursive: true });
  await writeFile(path.join(cgroupRoot, unit, "cgroup.procs"), "100\n101\n");
  await writeFile(path.join(cgroupRoot, unit, "below", "cgroup.procs"), "102\n");
  const roots = { procRoot, cgroupRoot };

  assert.deepEqual(await commandDatabaseServer(100, roots), { executable: "mariadbd", pid: 101 });

  // A server in a control group below the unit's, by an executable deleted after it started.
  await writeFile(path.join(cgroupRoot, unit, "cgroup.procs"), "100\n");
  await proc(102, { cgroup: `${unit}/below`, exe: "/srv/runtime-packs/postgresql/bin/postgres (deleted)" });
  assert.deepEqual(await commandDatabaseServer(100, roots), { executable: "postgres", pid: 102 });

  // A process named after a server whose executable is something else is not one, nor is one whose executable cannot
  // be read.
  await rm(path.join(procRoot, "102"), { recursive: true });
  await writeFile(path.join(cgroupRoot, unit, "below", "cgroup.procs"), "104\n105\n");
  await proc(104, { exe: "/usr/bin/bash", stat: statText(104, "mariadbd", 104) });
  await proc(105, { stat: statText(105, "postgres", 105) });
  assert.equal(await commandDatabaseServer(100, roots), null);

  // A runner in the editor's own control group has no unit of its own: its process group is the command's.
  await writeFile(path.join(procRoot, "100", "cgroup"), "0::/system.slice/vibe64-ws-editor.service\n");
  assert.deepEqual(await commandDatabaseServer(100, roots), { executable: "mysqld", pid: 103 });
  // A runner that has gone has no processes.
  assert.equal(await commandDatabaseServer(999, roots), null);
});

/**
 * A session command service whose commands run through the real runner in a process group of their own, as the
 * detached engine runs them.
 */
async function realRunnerService(t, { commandTimeoutMs } = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-command-db-session-"));
  t.after(() => rm(temporaryRoot, { force: true, recursive: true }));
  const editorTemp = await realpath(await mkdtemp("/tmp/v64-cds-"));
  t.after(() => rm(editorTemp, { force: true, recursive: true }));
  const previousTmpdir = process.env.TMPDIR;
  process.env.TMPDIR = editorTemp;
  t.after(() => {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  });
  const sessionId = "session-db";
  const sourceRoot = path.join(temporaryRoot, "sessions", "active", sessionId, "source");
  const descriptor = {
    metadata: { source_kind: "session_clone", source_path: sourceRoot, source_path_authority: "managed_session_source" },
    sessionId,
    sessionRoot: path.join(temporaryRoot, "state", sessionId)
  };
  const project = { projectRoot: path.join(temporaryRoot, "project"), slug: "project-db" };
  const runnerPath = path.join(temporaryRoot, "runner");
  await writeFile(runnerPath, commandRunnerSource());
  await chmod(runnerPath, 0o755);
  const children = new Map();
  const killGroup = (child) => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The command's process group has already ended.
    }
  };
  t.after(() => {
    for (const child of children.values()) killGroup(child);
  });
  const notes = [];
  const stops = [];
  let executions = 0;
  const service = createAgentSessionCommandService({
    logger: silentLogger,
    project: {
      async createSessionStore() {
        return {
          async readSessionSourceDescriptor() { return descriptor; },
          async readMetadataValue() { return ""; }
        };
      },
      async readCurrentProject() { return project; },
      async projectInspectionEnvironment() { return {}; },
      async runInProjectContext(_slug, operation) { return operation(); }
    },
    async runCommand(request) {
      const child = spawn(runnerPath, [], {
        cwd: request.cwd,
        detached: true,
        env: { ...request.baseEnv, PATH: process.env.PATH },
        stdio: "ignore"
      });
      const id = `execution-${++executions}`;
      children.set(id, child);
      return { execution: { id }, ok: true };
    },
    async stopExecution(executionId, options) {
      stops.push([executionId, options?.reason]);
      killGroup(children.get(executionId));
      return { executionId, ok: true, stopped: true };
    },
    noteAgent: async (id, message, options) => {
      notes.push([id, message, options]);
      return { delivered: true };
    },
    databaseServerScan: { intervalMs: 50 },
    ...(commandTimeoutMs ? { commandTimeoutMs } : {})
  });
  await mkdir(sourceRoot, { recursive: true });
  await service.bindSession(sessionId, { wrapperHostDir: path.join(temporaryRoot, "wrappers") });
  const run = (command) => service.run({ commandBase64: Buffer.from(command, "utf8").toString("base64url"), cwd: sourceRoot, sessionId });
  return { notes, run, sessionId, stops, temporaryRoot };
}

test("a database server an agent command starts is told at once, by its executable, in the command's output and the main chat", {
  skip: process.platform !== "linux" && "Linux lists a process's executable in /proc"
}, async (t) => {
  const { notes, run, sessionId, temporaryRoot } = await realRunnerService(t);
  // A database server's executable: a copy of bash named mariadbd, which stays running while its child sleeps.
  const { stdout: bash } = await execFileAsync("bash", ["-c", "command -v bash"]);
  const server = path.join(temporaryRoot, "bin", "mariadbd");
  await mkdir(path.dirname(server), { recursive: true });
  await copyFile(await realpath(bash.trim()), server);
  await chmod(server, 0o755);

  // A command whose text and process title name mariadbd but whose executable is bash is not told; nor is a mariadbd
  // that runs beside the command, outside its processes.
  const beside = spawn(server, ["-c", "sleep 30; :"], { stdio: "ignore" });
  t.after(() => beside.kill("SIGKILL"));
  // In a subshell: exec in the command itself would replace its runner, which then writes no result.
  const named = await run("(exec -a mariadbd bash -c 'sleep 0.5; :'); echo named-only");
  assert.equal(named.ok, true);
  assert.equal(named.stdout, "named-only\n");
  assert.deepEqual(notes, []);

  const started = await run(`echo starting; ${JSON.stringify(server)} -c 'sleep 1.5; :'; echo ended`);
  assert.equal(started.ok, true);
  assert.match(started.stdout, /^starting\n/u);
  assert.match(started.stdout, /\nended\n/u);
  const notice = new RegExp(`Vibe64: an agent command of this session started a database server \\(mariadbd, process \\d+\\)\\. It runs inside that command, so it ends when the command ends, at the latest at the command's ${LIMIT_MINUTES}-minute limit`, "u");
  assert.match(started.stdout, notice);
  assert.match(started.stdout, /TEST_DB_NAME for `jskit test --databases`, BROWSER_TEST_DB_NAME for browser workers\)/u);
  // Told once, as Vibe64's note to the main chat for the session's project, which a running turn hears at once and
  // otherwise its next message leads with.
  assert.equal(notes.length, 1);
  assert.equal(notes[0][0], sessionId);
  assert.match(notes[0][1], notice);
  assert.deepEqual(notes[0][2], { actor: null, projectSlug: "project-db", nextTurn: true });
  assert.equal(started.stdout.match(/started a database server/gu).length, 1);
});

test("a command that reaches its limit answers with what it wrote, why it ended and where long-lived work runs", async (t) => {
  const { run, stops } = await realRunnerService(t, { commandTimeoutMs: 600 });
  const result = await run("echo partial-output; sleep 30; :");
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_agent_session_command_timeout");
  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /^partial-output\n/u);
  assert.match(result.stderr, new RegExp(`This command reached the ${LIMIT_MINUTES}-minute limit of an agent command and was stopped, with every process it started\\.`, "u"));
  assert.match(result.stderr, /Never keep a database server, dev server, watcher, queue or other long-lived process alive through a command\./u);
  assert.match(result.stderr, /The app, its dev server and watchers run in Preview/u);
  assert.deepEqual(stops, [["execution-1", "vibe64_agent_session_command_timeout"]]);
});
