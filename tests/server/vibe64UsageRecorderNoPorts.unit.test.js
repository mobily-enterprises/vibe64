import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const RUNTIME_ROOT = fileURLToPath(new URL("../../packages/vibe64-usage-recording/runtime", import.meta.url));
const PRELOAD = path.join(RUNTIME_ROOT, "node/preload.mjs");
const HTTP_FIXTURE = fileURLToPath(new URL("../fixtures/usage-recording/node-http", import.meta.url));
// Recorder code may never open a debugging or network endpoint of its own.
const FORBIDDEN = Object.freeze([
  /\binspector\b/u,
  /["'`](?:node:)?net["'`]/u,
  /\bdgram\b/u,
  /\.listen\(/u,
  /\bcreateServer\(/u
]);
// /proc/net/tcp state 0A is LISTEN; unix sockets with __SO_ACCEPTCON accept connections.
const TCP_LISTEN = "0A";
const UNIX_ACCEPTING = 0x10000;

const children = new Set();
const roots = [];

after(async () => {
  for (const child of children) child.kill("SIGKILL");
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function runtimeFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? runtimeFiles(entryPath) : [entryPath];
  });
}

// The listening or bound sockets a process holds, by protocol, from /proc.
function listeningSockets(pid) {
  const inodes = new Set();
  for (const descriptor of readdirSync(`/proc/${pid}/fd`)) {
    try {
      const match = /^socket:\[(\d+)\]$/u.exec(readlinkSync(`/proc/${pid}/fd/${descriptor}`));
      if (match) inodes.add(match[1]);
    } catch {
      // The descriptor closed while it was being read.
    }
  }
  const sockets = [];
  for (const protocol of ["tcp", "tcp6", "udp", "udp6"]) {
    for (const row of readFileSync(`/proc/${pid}/net/${protocol}`, "utf8").trim().split("\n").slice(1)) {
      const fields = row.trim().split(/\s+/u);
      const listening = protocol.startsWith("udp") || fields[3] === TCP_LISTEN;
      if (listening && inodes.has(fields[9])) sockets.push(`${protocol} ${Number.parseInt(fields[1].split(":")[1], 16)}`);
    }
  }
  for (const row of readFileSync(`/proc/${pid}/net/unix`, "utf8").trim().split("\n").slice(1)) {
    const fields = row.trim().split(/\s+/u);
    if ((Number.parseInt(fields[3], 16) & UNIX_ACCEPTING) && inodes.has(fields[6])) sockets.push(`unix ${fields[7] || "(unnamed)"}`);
  }
  return sockets.sort();
}

async function startServer(env) {
  const child = spawn(process.execPath, ["server.mjs"], { cwd: HTTP_FIXTURE, env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  child.once("exit", () => children.delete(child));
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /LISTENING (\d+)/u.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once("exit", (code) => reject(new Error(`server exited (${code})`)));
  });
  return { child, port };
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null || server.child.signalCode !== null) return;
  const exited = once(server.child, "exit");
  server.child.kill("SIGTERM");
  await exited;
}

test("recorder code names no debugging or network endpoint", () => {
  const files = runtimeFiles(RUNTIME_ROOT);
  assert.ok(files.includes(PRELOAD));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const token of FORBIDDEN) assert.doesNotMatch(text, token, `${path.relative(RUNTIME_ROOT, file)} names ${token}`);
  }
});

test("a recorded web process listens on exactly what an unrecorded one does", { skip: !existsSync("/proc/self/net/unix") }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "v64-node-usage-ports-"));
  roots.push(root);
  const plainEnv = { ...process.env };
  const tracedEnv = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(PRELOAD).href}`.trim(),
    VIBE64_USAGE_RECORDING_DIR: root,
    VIBE64_USAGE_SOURCE_ROOT: HTTP_FIXTURE,
    VIBE64_USAGE_TARGET_KIND: "web"
  };
  const servers = [];
  try {
    const plain = await startServer(plainEnv);
    servers.push(plain);
    const traced = await startServer(tracedEnv);
    servers.push(traced);
    const response = await fetch(`http://127.0.0.1:${traced.port}/alpha`);
    assert.equal(await response.text(), "hello alpha");
    const port = (sockets, server) => sockets.map((socket) => socket.replace(` ${server.port}`, " APP"));
    const plainSockets = port(listeningSockets(plain.child.pid), plain);
    assert.deepEqual(plainSockets, ["tcp APP"]);
    assert.deepEqual(port(listeningSockets(traced.child.pid), traced), plainSockets);
    assert.ok(readdirSync(root).some((name) => name.startsWith("hits-nodejs-") && statSync(path.join(root, name)).size > 0));
  } finally {
    await Promise.all(servers.map(stopServer));
  }
});
