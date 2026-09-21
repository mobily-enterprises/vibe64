import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

async function prepareExampleProject(projectRoot) {
  try {
    await lstat(projectRoot);
    const { stdout } = await run("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"]);
    if (path.resolve(stdout.trim()) !== path.resolve(projectRoot)) {
      throw new Error(`Example project needs its own Git repository: ${projectRoot}`);
    }
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(projectRoot), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(projectRoot), ".example-"));
  try {
    await cp(path.join(appRoot, "examples", "hello-node"), staging, { recursive: true });
    await run("git", ["init", "--initial-branch=main", staging]);
    const { initializeGenesisProject } = await import("@local/vibe64-genesis/server");
    await initializeGenesisProject({ projectRoot: staging });
    await run("git", ["-C", staging, "add", "."]);
    await run("git", ["-C", staging, "-c", "user.name=Vibe64 Example", "-c",
      "user.email=example@localhost", "-c", "commit.gpgSign=false", "commit", "-m", "Create Node example"]);
    await rename(staging, projectRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: "string" },
    "state-dir": { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "5173" }
  } });
  if (!["127.0.0.1", "localhost", "::1"].includes(values.host)) {
    throw new Error("The example editor must listen on localhost; use the host's authenticated preview proxy.");
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preview port.");
  const developmentRoot = path.resolve(values["state-dir"] || path.join(appRoot, ".vibe64-local", "development"));
  const projectRoot = path.resolve(values.project || path.join(developmentRoot, "hello-node"));

  // Load the normal env files once, then give this editor its own runtime.
  // It is a standalone application inside the parent's managed preview process.
  process.env.VIBE64_RUNTIME_NAMESPACE = "__local__";
  const { resolveRuntimeEnv } = await import("../server/lib/runtimeEnv.js");
  resolveRuntimeEnv();
  const sharedTools = new Set(["VIBE64_RUNTIME_PACK_ROOT", "VIBE64_SHARED_CACHE_ROOT"]);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("VIBE64_") && !sharedTools.has(key)) delete process.env[key];
  }
  const identity = createHash("sha256").update(developmentRoot).digest("hex").slice(0, 12);
  process.env.VIBE64_RUNTIME_NAMESPACE = `example-${identity}`;
  process.env.VIBE64_SYSTEM_ROOT = path.join(developmentRoot, "state");
  process.env.VIBE64_SERVICE_DATA_ROOT = path.join(developmentRoot, "state", "services");
  process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT = "1";
  process.env.VIBE64_CODEX_ATTACHMENTS_ROOT = path.join(developmentRoot, "state", "attachments");
  await prepareExampleProject(projectRoot);

  const { parseStartupArgs } = await import("../bin/server.js");
  const { createServer } = await import("../server.js");
  const app = await createServer({
    ...parseStartupArgs(["--no-open", "--project", projectRoot]),
    appRoot,
    systemRoot: process.env.VIBE64_SYSTEM_ROOT,
    managedSourceRoot: path.join(developmentRoot, "sessions"),
    logLevel: "warn"
  });
  let vite;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await vite?.close();
    await app.close();
  };
  try {
    const apiOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
    process.env.VITE_API_PROXY_TARGET = apiOrigin;
    const proxy = { target: apiOrigin, changeOrigin: true, ws: true,
      headers: { origin: apiOrigin }, rewriteWsOrigin: true };
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root: appRoot,
      server: {
        host: values.host, port, strictPort: true,
        // The loopback listener is reached through the authenticated host proxy.
        allowedHosts: true,
        proxy: { "/api": proxy, "/socket.io": proxy }
      }
    });
    await vite.listen();
    console.log(`Example project: ${projectRoot}`);
    console.log(`Vibe64 development preview: http://${values.host}:${port}/app`);
  } catch (error) {
    await close();
    throw error;
  }
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { prepareExampleProject };
