import { spawn } from "node:child_process";
import { watch as watchFiles } from "chokidar";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { composePublicDevelopment } from "./compose.mjs";

export function sourceDevelopmentSelected(env = process.env) {
  return !env.VIBE64_DEVELOPMENT_COMPOSED && Boolean(env.VIBE64_JSKIT_SOURCE_ROOT || env.VIBE64_GENESIS_SOURCE_ROOT);
}

export async function runSourceDevelopment({ publicRoot, command, args, watch = false, env = process.env }) {
  if (env.NODE_ENV === "production") throw new Error("Source development cannot run with NODE_ENV=production.");
  const parent = path.join(publicRoot, ".vibe64-local", "source-development");
  await mkdir(parent, { recursive: true });
  const appRoot = await mkdtemp(path.join(parent, "app-"));
  let child;
  let finished;
  let stopping = false;
  let restart = false;
  let debounce;
  let stopTimer;
  let watcher;
  let watcherError;
  const stop = () => {
    stopping = true;
    child?.kill("SIGTERM");
  };
  const changed = (event, file) => {
    if (stopping) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      console.log(`[vibe64] Development source ${event}: ${file}. Restarting.`);
      restart = true;
      child?.kill("SIGTERM");
      // Do not start another application over an unconfirmed shutdown.
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        stopping = true;
        console.error("Development source changed, but the previous app has not stopped. Stop Preview and inspect its cleanup log before retrying.");
      }, 30_000);
      stopTimer.unref();
    }, 400);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    do {
      clearTimeout(debounce);
      await watcher?.close();
      restart = false;
      await rm(appRoot, { recursive: true, force: true });
      const composition = await composePublicDevelopment({ publicRoot, appRoot, env, includeTests: !watch });
      if (watch) {
        watcher = watchFiles(composition.sourceRoots, {
          ignoreInitial: true,
          followSymlinks: false,
          ignored: (file) => file.split(path.sep).some((part) =>
            ["node_modules", ".git", ".genesis", ".vibe64-local", ".cache", "coverage", "test-results"].includes(part))
        }).on("error", (error) => {
          watcherError = error;
          stop();
        });
        await new Promise((resolve, reject) => {
          watcher.once("error", reject);
          watcher.once("ready", () => { watcher.off("error", reject); resolve(); });
        });
        // Initial symlink discovery can emit add even with ignoreInitial.
        watcher.on("all", changed);
      }
      for (const root of composition.sourceRoots) console.log(`[vibe64] Development source: ${root}`);
      console.log(`[vibe64] Source packages: ${composition.localPackages.map((entry) => entry.packageId).join(", ")}`);
      if (stopping) break;
      child = spawn(command, args, { cwd: appRoot, stdio: "inherit", env: {
        ...env, VIBE64_DEVELOPMENT_COMPOSED: "1",
        VIBE64_DEVELOPMENT_LOCAL_PACKAGES: JSON.stringify(composition.localPackages.map((entry) => entry.packageId))
      } });
      finished = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      child = null;
      clearTimeout(stopTimer);
      if (watcherError) throw watcherError;
    } while (watch && restart && !stopping);
    return stopping ? 130 : (finished?.code ?? 1);
  } finally {
    clearTimeout(debounce);
    clearTimeout(stopTimer);
    await watcher?.close();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await rm(appRoot, { recursive: true, force: true });
  }
}
