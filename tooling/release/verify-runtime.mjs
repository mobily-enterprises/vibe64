import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function verifyRuntime(appRoot, { serverEntry = "server.bundle.mjs" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-runtime-proof-"));
  const project = path.join(root, "project");
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `release-proof-${process.pid}`;
  let server;
  let cliProcess;
  let cliExit;
  try {
    await mkdir(project);
    const require = createRequire(path.join(appRoot, "package.json"));
    const pty = require("node-pty");
    await new Promise((resolve, reject) => {
      const terminal = pty.spawn(process.execPath, ["-e", "console.log('native-pty-ok')"], { cwd: project });
      let output = "";
      const timeout = setTimeout(() => { terminal.kill(); reject(new Error("Native terminal timed out")); }, 10000);
      terminal.onData(chunk => { output += chunk; });
      terminal.onExit(({ exitCode }) => {
        clearTimeout(timeout);
        if (exitCode === 0 && output.includes("native-pty-ok")) resolve();
        else reject(new Error(`Native terminal failed: ${output}`));
      });
    });
    const module = await import(pathToFileURL(path.join(appRoot, serverEntry)).href);
    server = await module.createServer({ runtimeMode: "local", targetRoot: project, systemRoot: path.join(root, "state"), logLevel: "silent" });
    assert.equal((await server.inject("/api/health")).statusCode, 200);
    const html = await server.inject("/app");
    assert.equal(html.statusCode, 200);
    const asset = html.body.match(/src="([^"]+\.js)"/u)?.[1];
    assert.ok(asset, "Built frontend must reference a JavaScript asset");
    const script = await server.inject(asset);
    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"], /javascript/u);
    const address = await server.listen({ host: "127.0.0.1", port: 0 });
    const socket = await fetch(`${address}/socket.io/?EIO=4&transport=polling`);
    assert.equal(socket.status, 200);
    assert.match(await socket.text(), /^0\{/u);
    await execute("git", ["init", "--quiet", project]);
    const genesis = path.join(appRoot, "node_modules/@local/vibe64-genesis/bin/genesis");
    const cli = (...args) => execute(process.execPath, [genesis, ...args], {
      cwd: project, env: { ...process.env, GENESIS_PARSER_ROOT: path.join(root, "parsers"), GENESIS_PARSER_AUTO_INSTALL: "0" }
    });
    await cli("init");
    await writeFile(path.join(project, "genesis/blueprint.md"), "# Blueprint\n\nA small JavaScript greeting example for developers.\n");
    await writeFile(path.join(project, "hello.js"), "export function greeting() { return 'hello'; }\n");
    await cli("stack", "add", "nodejs");
    await cli("index", "hello.js");
    assert.match(await readFile(path.join(project, ".genesis/machine-city.json"), "utf8"), /greeting/u);
    const runner = await import(pathToFileURL(path.join(appRoot, "bin/run.js")).href);
    assert.equal(runner.SERVER_ENTRYPOINT, path.join(appRoot, "bin/server.js"));
    await server.close();
    server = null;
    cliProcess = spawn(process.execPath, [runner.SERVER_ENTRYPOINT, "--project", project, "--no-open"], {
      cwd: project,
      env: { ...process.env, HOST: "127.0.0.1", PORT: new URL(address).port, VIBE64_SYSTEM_ROOT: path.join(root, "cli-state") },
      stdio: ["ignore", "pipe", "pipe"]
    });
    cliExit = new Promise(resolve => cliProcess.once("close", resolve));
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`Packaged CLI did not start: ${output}`)), 30000);
      const fail = error => { clearTimeout(timer); reject(error); };
      cliProcess.once("error", fail);
      cliProcess.once("exit", code => fail(new Error(`Packaged CLI exited ${code}: ${output}`)));
      for (const stream of [cliProcess.stdout, cliProcess.stderr]) stream.on("data", chunk => {
        output = (output + chunk).slice(-16000);
        if (output.includes("Vibe64 is running at")) { clearTimeout(timer); resolve(); }
      });
    });
    assert.equal((await fetch(`${address}/api/health`)).status, 200);
    console.log("Runtime proof passed: server, frontend asset, realtime handshake, native PTY, Genesis catalog and index, packaged CLI startup.");
  } finally {
    if (cliProcess && cliProcess.exitCode === null) {
      cliProcess.kill("SIGTERM");
      const force = setTimeout(() => cliProcess.kill("SIGKILL"), 5000);
      await cliExit;
      clearTimeout(force);
    }
    await server?.close();
    if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
    await rm(root, { recursive: true, force: true });
  }
}

export { verifyRuntime };
