// The production build of the frontend that every browser-test server serves, as a staging or production server
// does: a page then loads a few bundled files instead of every source module from a development server. The build goes where the app
// server serves it from (dist/), never a folder of its own: the server tells every page which build it serves from
// dist/index.html, and a page from any other build offers a reload over the screen. It is reused while its inputs' contents
// are unchanged and dist/index.html is still the one it made, so a repeated focused run does not rebuild, even though a
// build rewrites files it generates among its inputs (vue-router's src/typed-router.d.ts). Two runs in one tree build one
// at a time: the second waits, then reuses the first one's build.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// What the last browser-test build was made from, and the dist/index.html it made.
const FINGERPRINT_FILE = path.join("node_modules", ".cache", "jskit-browser-test-build.json");
// Held, with its holder's process id, while a run builds.
const BUILD_LOCK = path.join("node_modules", ".cache", "jskit-browser-test-build.lock");
const BUILD_WAIT_MS = 10 * 60_000;
const SERVED_INDEX = path.join("dist", "index.html");
// The app's folders a frontend build reads, and the installed packages it bundles. Every file at the app's root is an
// input too (index.html, vite.config.*, favicon.svg, package.json, the .env files Vite reads), except other dotfiles,
// such as caches, and notes.
const BUILD_DIRECTORIES = Object.freeze(["src", "packages", "shared", "config", "public", "node_modules/@jskit-ai"]);
const INSTALLED_PACKAGES = "node_modules/.package-lock.json";
const NOT_AN_INPUT = /^\.(?!env(?:\.|$))|\.(?:md|log|txt)$/u;

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)}s`;
const digest = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : "");

/** Every build input's path and contents, the build command and the VITE_ settings, hashed. */
function buildFingerprint(appRoot, build, env = process.env) {
  const hash = createHash("sha256").update(`${build}\n`);
  const visit = (relative) => {
    const absolute = path.join(appRoot, relative);
    if (!existsSync(absolute)) return;
    const stats = statSync(absolute);
    if (!stats.isDirectory()) {
      hash.update(`${relative}\0${stats.size}\0`).update(readFileSync(absolute));
      return;
    }
    for (const entry of readdirSync(absolute).sort()) {
      if (entry !== "node_modules" && !entry.startsWith(".")) visit(path.join(relative, entry));
    }
  };
  for (const entry of readdirSync(appRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() && !NOT_AN_INPUT.test(entry.name)) visit(entry.name);
  }
  [INSTALLED_PACKAGES, ...BUILD_DIRECTORIES].forEach(visit);
  for (const [name, value] of Object.entries(env).filter(([key]) => key.startsWith("VITE_")).sort()) {
    hash.update(`${name}=${value}\n`);
  }
  return hash.digest("hex");
}

function runToCompletion(command, appRoot) {
  const [program, ...args] = String(command).trim().split(/\s+/u);
  return new Promise((resolve, reject) => {
    // The build a staging or production server serves, whatever NODE_ENV the launcher was given.
    const child = spawn(program, args, {
      cwd: appRoot,
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "inherit"]
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || `exit ${code}`}).`))));
  });
}

function lastBuild(appRoot) {
  try {
    return JSON.parse(readFileSync(path.join(appRoot, FINGERPRINT_FILE), "utf8"));
  } catch {
    return {};
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Takes the tree's build lock, waiting while another live run holds it; a dead holder's lock is taken over. */
async function lockBuild(appRoot) {
  const lock = path.join(appRoot, BUILD_LOCK);
  mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + BUILD_WAIT_MS;
  let reported = false;
  while (true) {
    try {
      const descriptor = openSync(lock, "wx");
      writeSync(descriptor, String(process.pid));
      closeSync(descriptor);
      return () => rmSync(lock, { force: true });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    let holder = 0;
    try {
      holder = Number.parseInt(readFileSync(lock, "utf8"), 10);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (holder && !isRunning(holder)) {
      rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() > deadline) throw new Error(`Another run (process ${holder}) has been building the frontend for 10 minutes.`);
    if (!reported) console.log(`[browser-tests] Waiting for another run's frontend build (process ${holder}).`);
    reported = true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function isCurrent(appRoot, inputs) {
  const last = lastBuild(appRoot);
  return last.inputs === inputs && Boolean(last.index) && last.index === digest(path.join(appRoot, SERVED_INDEX));
}

/**
 * Builds the frontend with `build` unless dist/ already holds the build of the current inputs.
 * @param {{ appRoot?: string, build?: string, run?: (command: string, appRoot: string) => Promise<void> }} [options]
 * @returns {Promise<{ built: boolean }>}
 */
async function buildFrontend({ appRoot = process.cwd(), build = "npm run build", run = runToCompletion } = {}) {
  const started = performance.now();
  const inputs = buildFingerprint(appRoot, build);
  if (isCurrent(appRoot, inputs)) {
    console.log(`[browser-tests] Frontend build unchanged, reused (${seconds(started)}).`);
    return { built: false };
  }
  const unlock = await lockBuild(appRoot);
  try {
    // The run that held the lock may have just built these inputs.
    if (isCurrent(appRoot, inputs)) {
      console.log(`[browser-tests] Frontend built by another run, reused (${seconds(started)}).`);
      return { built: false };
    }
    await run(build, appRoot);
    const index = digest(path.join(appRoot, SERVED_INDEX));
    if (!index) throw new Error(`${build} made no ${SERVED_INDEX}, which the app server serves.`);
    writeFileSync(path.join(appRoot, FINGERPRINT_FILE), JSON.stringify({ inputs, index }));
    console.log(`[browser-tests] Frontend built in ${seconds(started)}.`);
    return { built: true };
  } finally {
    unlock();
  }
}

export { buildFrontend };
