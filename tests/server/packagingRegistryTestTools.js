// Throwaway registries for the publishing integration tests: a Verdaccio npm
// registry and a pypiserver Python index, each on a free loopback port with its
// storage in a temp folder, stopped and removed when the test ends. The tools
// themselves are installed once into a user cache folder (never system-wide).
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const TOOLS = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "vibe64-test-tools");
const VERDACCIO_VERSION = "6.1.6";
const PYTHON_PACKAGES = ["pypiserver[passlib]==2.3.2", "twine==6.1.0", "build==1.2.2.post1", "setuptools==80.9.0", "wheel==0.45.1"];
const exists = (file) => stat(file).then(() => true, () => false);

async function temporaryFolder(t, prefix) {
  const folder = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Starts a server in its own process group and stops the whole group at teardown.
async function startServer(t, { command, args, cwd, env = process.env, url, label }) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
  child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-8000); });
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    try { process.kill(-child.pid, "SIGTERM"); } catch { resolve(); }
    setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, 5000).unref();
  });
  t.after(stop);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited early:\n${output}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return { stop, output: () => output };
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stop();
  throw new Error(`${label} did not start:\n${output}`);
}

async function verdaccioBinary() {
  const root = path.join(TOOLS, `verdaccio-${VERDACCIO_VERSION}`);
  const binary = path.join(root, "node_modules", ".bin", "verdaccio");
  if (!await exists(binary)) {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "package.json"), "{\"private\":true}\n");
    await run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", `verdaccio@${VERDACCIO_VERSION}`], { cwd: root, timeout: 300_000 });
  }
  return binary;
}

// A Verdaccio registry with no uplinks; returns its URL and a signed-in user's token.
async function startVerdaccio(t) {
  const binary = await verdaccioBinary();
  const root = await temporaryFolder(t, "vibe64-verdaccio-");
  const port = await freePort();
  const config = path.join(root, "config.yaml");
  await writeFile(config, [
    `storage: ${path.join(root, "storage")}`,
    "auth:",
    "  htpasswd:",
    `    file: ${path.join(root, "htpasswd")}`,
    "    max_users: 10",
    "uplinks: {}",
    "packages:",
    "  '**':",
    "    access: $all",
    "    publish: $authenticated",
    "log: { type: stdout, format: pretty, level: warn }",
    ""
  ].join("\n"));
  const url = `http://127.0.0.1:${port}/`;
  await startServer(t, {
    command: binary,
    args: ["--config", config, "--listen", `127.0.0.1:${port}`],
    cwd: root,
    url: `${url}-/ping`,
    label: "Verdaccio"
  });
  const name = "canary";
  const response = await fetch(new URL(`-/user/org.couchdb.user:${name}`, url), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: randomBytes(12).toString("hex") })
  });
  const body = await response.json();
  if (!response.ok || typeof body.token !== "string") throw new Error(`Verdaccio refused the test user (${response.status}).`);
  return { url, user: name, token: body.token };
}

async function pythonTools() {
  const root = path.join(TOOLS, "python-registry");
  const python = path.join(root, "bin", "python");
  // The standard library's venv and pip, so CI needs no extra Python tooling.
  if (!await exists(python)) {
    await run("python3", ["-m", "venv", root], { timeout: 120_000 });
  }
  try {
    await run(python, ["-c", "import pypiserver, twine, build, passlib"], { timeout: 60_000 });
  } catch {
    await run(python, ["-m", "pip", "install", "-q", ...PYTHON_PACKAGES], { timeout: 300_000 });
  }
  return { python, bin: path.join(root, "bin") };
}

// A pypiserver index that accepts uploads from one user with a random password.
async function startPypiServer(t) {
  const tools = await pythonTools();
  const root = await temporaryFolder(t, "vibe64-pypiserver-");
  const packages = path.join(root, "packages");
  await mkdir(packages);
  const password = randomBytes(12).toString("hex");
  const htpasswd = path.join(root, "htpasswd");
  // The password reaches passlib through a private file, never argv.
  const secretFile = path.join(root, "password");
  await writeFile(secretFile, password, { mode: 0o600 });
  await run(tools.python, ["-c", [
    "import sys",
    "from passlib.apache import HtpasswdFile",
    "h = HtpasswdFile(sys.argv[1], new=True)",
    "h.set_password('canary', open(sys.argv[2]).read())",
    "h.save()"
  ].join("\n"), htpasswd, secretFile], { timeout: 30_000 });
  await rm(secretFile);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  await startServer(t, {
    command: tools.python,
    args: ["-m", "pypiserver", "run", "-i", "127.0.0.1", "-p", String(port), "-a", "update", "-P", htpasswd, "--hash-algo", "sha256", packages],
    cwd: root,
    url: `${url}simple/`,
    label: "pypiserver"
  });
  return { url, index: `${url}simple/`, user: "canary", password, tools };
}

// A Git repository with the given files committed; returns its root and commit.
async function gitProject(t, files) {
  const root = await temporaryFolder(t, "vibe64-publish-project-");
  await run("git", ["init", "-q", "-b", "main", root]);
  return { root, ...await commitFiles(root, files, "Initial project") };
}

async function commitFiles(root, files, message) {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  await run("git", ["-C", root, "add", "-A"]);
  await run("git", ["-C", root, "-c", "user.name=Canary", "-c", "user.email=canary@example.invalid", "commit", "-q", "-m", message]);
  const { stdout } = await run("git", ["-C", root, "rev-parse", "HEAD"]);
  return { commit: stdout.trim() };
}

export { commitFiles, gitProject, startPypiServer, startVerdaccio, temporaryFolder };
