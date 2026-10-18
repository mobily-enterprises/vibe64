import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { runSourceDevelopment, sourceDevelopmentSelected } from "./development/run.mjs";

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
    "connected-sources": { type: "string" },
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
  if (values["connected-sources"]) {
    process.env.VIBE64_CONNECTED_SOURCES_FILE = path.resolve(values["connected-sources"]);
  }

  if (sourceDevelopmentSelected()) {
    process.exitCode = await runSourceDevelopment({ publicRoot: appRoot, command: process.execPath,
      args: ["tooling/dev-example.mjs", "--project", projectRoot, "--state-dir", developmentRoot,
        "--host", values.host, "--port", values.port], watch: true });
    return;
  }

  // Load the normal env files once, then give this editor its own runtime.
  // It is a standalone application inside the parent's managed preview process.
  process.env.VIBE64_RUNTIME_NAMESPACE = "__local__";
  const { resolveRuntimeEnv } = await import("../server/lib/runtimeEnv.js");
  resolveRuntimeEnv();
  const hostedStudioHost = process.env.VIBE64_WORKSPACE && process.env.VIBE64_PUBLIC_USER_DOMAIN
    ? `${process.env.VIBE64_WORKSPACE}.${process.env.VIBE64_PUBLIC_USER_DOMAIN}` : "";
  const sharedTools = new Set(["VIBE64_RUNTIME_PACK_ROOT", "VIBE64_SHARED_CACHE_ROOT",
    "VIBE64_DEVELOPMENT_COMPOSED", "VIBE64_DEVELOPMENT_LOCAL_PACKAGES", "VIBE64_CLAUDE_COMMAND",
    "VIBE64_PUBLIC_USER_DOMAIN", "VIBE64_PUBLIC_PROTOCOL",
    "VIBE64_PREVIEW_PUBLIC_DOMAIN", "VIBE64_PREVIEW_PUBLIC_PROTOCOL",
    "VIBE64_PREVIEW_PUBLIC_NAMESPACE", "VIBE64_PREVIEW_PROXY_SOCKET_DIR"]);
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("VIBE64_") && !sharedTools.has(key)) delete process.env[key];
  }
  const identity = createHash("sha256").update(developmentRoot).digest("hex").slice(0, 12);
  process.env.VIBE64_RUNTIME_NAMESPACE = `example-${identity}`;
  process.env.VIBE64_SYSTEM_ROOT = path.join(developmentRoot, "state");
  process.env.VIBE64_SERVICE_DATA_ROOT = path.join(developmentRoot, "state", "services");
  process.env.VIBE64_SELF_TARGET_SYSTEM_ROOT = "1";
  process.env.VIBE64_CODEX_ATTACHMENTS_ROOT = path.join(developmentRoot, "state", "attachments");
  if (!hostedStudioHost) {
    process.env.VIBE64_PREVIEW_PROXY_SOCKET_DIR ||= path.join(developmentRoot, "preview-sockets");
  }
  process.env.VIBE64_PREVIEW_PUBLIC_NAMESPACE = `${process.env.VIBE64_PREVIEW_PUBLIC_NAMESPACE || "example"}-${identity}`;
  await prepareExampleProject(projectRoot);

  const { parseStartupArgs } = await import("../bin/server.js");
  const { createServer } = await import("../server.js");
  const app = await createServer({
    ...parseStartupArgs(["--no-open", "--project", projectRoot]),
    appRoot,
    systemRoot: process.env.VIBE64_SYSTEM_ROOT,
    managedSourceRoot: path.join(developmentRoot, "sessions")
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
    // API authorization remains loopback. Only output routing uses the host's
    // configured Studio hostname; it must not become the backend Origin.
    const proxy = { target: apiOrigin, changeOrigin: true, ws: true,
      headers: { origin: apiOrigin, "x-forwarded-host": hostedStudioHost || new URL(apiOrigin).host,
        "x-forwarded-proto": new URL(apiOrigin).protocol.slice(0, -1) },
      rewriteWsOrigin: true };
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root: appRoot,
      cacheDir: path.join(developmentRoot, "vite-cache"),
      plugins: [{
        name: "vibe64-example-backend",
        async closeServer({ reason }) {
          if (reason === "restart") return;
          // Vite exits after its own SIGTERM handler. Finish native cleanup first.
          try {
            await app.vibe64CapabilityRuntime.shutdown();
            await app.close();
          } catch (error) {
            process.exitCode = 1;
            throw error;
          }
        }
      }],
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
