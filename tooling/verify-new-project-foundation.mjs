import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  initializeManagedProject
} from "@local/vibe64-project/server/managedProject";

import { applyGenesisTemplate, inspectGenesisProject } from "@local/vibe64-genesis/server";
import { reserveAvailableWebLaunchTargetPort } from "../packages/vibe64-terminals/src/server/launchTargetTerminal.js";

const START_TIMEOUT_MS = 30_000;

function run(command, args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (code=${code}, signal=${signal || "none"}).`));
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.json()).ok === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The created application did not become healthy: ${lastError?.message || "timeout"}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-created-project-proof-"));
  const namespaceRoot = path.join(root, "namespace");
  const projectRuntimeRoot = path.join(root, "runtime");
  const checkoutRoot = path.join(root, "checkout");
  let server = null;
  try {
    await Promise.all([
      mkdir(namespaceRoot),
      mkdir(projectRuntimeRoot)
    ]);
    const initialized = await initializeManagedProject({
      projectContextRoot: namespaceRoot,
      projectName: "created-project-proof",
      projectRuntimeRoot
    });
    assert.deepEqual(await readdir(namespaceRoot), []);
    await run("git", ["clone", initialized.repositoryPath, checkoutRoot]);
    assert.equal((await inspectGenesisProject({ projectRoot: checkoutRoot })).state, "new");
    await applyGenesisTemplate({ projectRoot: checkoutRoot, templateId: "official:jskit/public" });
    assert.equal((await inspectGenesisProject({ projectRoot: checkoutRoot })).state, "ready");

    const packageJson = JSON.parse(await readFile(path.join(checkoutRoot, "package.json"), "utf8"));
    const mainPackage = JSON.parse(await readFile(
      path.join(checkoutRoot, "packages", "main", "package.json"),
      "utf8"
    ));
    assert.equal(typeof packageJson.name, "string");
    assert.deepEqual(packageJson.workspaces, ["packages/*"]);
    assert.equal(typeof packageJson.devDependencies["@jskit-ai/jskit-catalog"], "string");
    assert.equal(packageJson.devDependencies["@jskit-ai/jskit-cli"], undefined);
    assert.equal(packageJson.scripts["jskit:update"], "npx --yes @jskit-ai/jskit-catalog@latest update");
    assert.equal(packageJson.scripts["jskit:check"], "jskit check");
    assert.equal(mainPackage.name, "@local/main");
    assert.equal(mainPackage.version, "0.1.0");
    JSON.parse(await readFile(path.join(checkoutRoot, "package-lock.json"), "utf8"));

    const seededStatus = execFileSync("git", ["status", "--porcelain"], { cwd: checkoutRoot, encoding: "utf8" });
    await run("npm", ["ci"], { cwd: checkoutRoot });
    assert.equal(execFileSync("git", ["status", "--porcelain"], {
      cwd: checkoutRoot,
      encoding: "utf8"
    }), seededStatus);
    await run("npm", ["run", "jskit:check"], { cwd: checkoutRoot });
    await run("npm", ["ls"], { cwd: checkoutRoot });
    await run("npm", ["run", "verify"], { cwd: checkoutRoot });

    // The new app is told its port and answers on a health URL made from it, so its port is chosen here, by Preview's own
    // picker from Preview's own start: free, outside the ephemeral range, where an outgoing connection can take it before
    // the app binds it, and outside the ports the host claims, never a range of this check's own.
    const reservation = await reserveAvailableWebLaunchTargetPort();
    reservation.release();
    const port = reservation.port;
    process.stdout.write(`Starting the created application on port ${port}.\n`);
    server = spawn("npm", ["start"], {
      cwd: checkoutRoot,
      env: {
        ...process.env,
        // A JSKIT app refuses to start without its APP_ENV; this local start is a developer's, as a Preview's is.
        APP_ENV: "development",
        HOST: "127.0.0.1",
        PORT: String(port)
      },
      stdio: "inherit"
    });
    await waitForHealth(`http://127.0.0.1:${port}/api/health`);
    process.stdout.write("Fresh Vibe64 JSKIT project installed, verified, built, and started successfully.\n");
  } finally {
    if (server) {
      await stop(server);
    }
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

await main();
