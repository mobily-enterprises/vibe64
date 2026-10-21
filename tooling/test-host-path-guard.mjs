// Loaded into every test process (node --import, vitest setupFiles). Tests run
// on a person's own computer and must never read or write a hosting
// environment's system directories; any such access throws instead.
// Child Node processes inherit it through NODE_OPTIONS. A child started with
// an environment rebuilt from scratch (NODE_OPTIONS removed) and Playwright
// browser tests run without it; the command that starts such a child is
// still checked here.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST_PATH_ROOTS = Object.freeze([
  "/var/lib/vibe64",
  "/opt/vibe64",
  "/var/cache/vibe64",
  "/etc/vibe64",
  "/run/vibe64",
  "/usr/lib/vibe64"
]);
const TWO_PATH_FUNCTIONS = new Set([
  "copyFile", "copyFileSync", "cp", "cpSync", "link", "linkSync",
  "rename", "renameSync", "symlink", "symlinkSync"
]);
const CHILD_PROCESS_FUNCTIONS = ["exec", "execSync", "execFile", "execFileSync", "fork", "spawn", "spawnSync"];
const GUARDED = Symbol.for("vibe64.testHostPathGuard");

function pathText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : "";
  return "";
}

function hostPathOf(value, { resolveRelative = true } = {}) {
  const text = pathText(value);
  if (!text || text.includes("\0")) return "";
  if (!resolveRelative && !text.startsWith("/")) return "";
  const resolved = path.resolve(text);
  return HOST_PATH_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`) || resolved.startsWith(`${root}-`))
    ? resolved
    : "";
}

function refuse(hostPath, operation) {
  throw new Error(`test touched a host path: ${hostPath} (${operation})`);
}

function guardFunction(original, operation, check) {
  if (typeof original !== "function" || original[GUARDED]) return original;
  const guarded = function guardedHostPathCall(...args) {
    check(args, operation);
    return Reflect.apply(original, this, args);
  };
  for (const key of Reflect.ownKeys(original)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    // realpath.native and realpathSync.native take a path too.
    if (key === "native") descriptor.value = guardFunction(descriptor.value, operation, check);
    Object.defineProperty(guarded, key, descriptor);
  }
  Object.defineProperty(guarded, "name", { value: original.name });
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

function checkFsArguments(args, operation) {
  const count = TWO_PATH_FUNCTIONS.has(operation) ? 2 : 1;
  for (const value of args.slice(0, count)) {
    const hostPath = hostPathOf(value);
    if (hostPath) refuse(hostPath, operation);
  }
}

function checkChildProcessArguments(args, operation) {
  const [command, second, third] = args;
  const argv = Array.isArray(second) ? second : [];
  const options = Array.isArray(second) ? third : second;
  // Shell programs (exec, `sh -c ...`, `bash -lc ...`) carry paths inside
  // one argument, so every argument is split into words.
  const words = [command, ...argv].flatMap((value) => typeof value === "string"
    ? value.split(/[\s"'=;|&()<>`]+/u)
    : [value]);
  for (const word of words) {
    const hostPath = hostPathOf(word, { resolveRelative: false });
    if (hostPath) refuse(hostPath, operation);
  }
  const cwd = options && typeof options === "object" ? hostPathOf(options.cwd) : "";
  if (cwd) refuse(cwd, `${operation} cwd`);
}

function guardModule(target, check) {
  for (const name of Object.keys(target)) {
    // Classes (fs.Stats, fs.ReadStream, ...) keep their identity.
    if (/^[A-Z]/u.test(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!descriptor || typeof descriptor.value !== "function" || !descriptor.writable) continue;
    target[name] = guardFunction(descriptor.value, name, check);
  }
}

if (!globalThis[GUARDED]) {
  globalThis[GUARDED] = true;
  guardModule(fs, checkFsArguments);
  guardModule(fs.promises, checkFsArguments);
  for (const name of CHILD_PROCESS_FUNCTIONS) {
    childProcess[name] = guardFunction(childProcess[name], name, checkChildProcessArguments);
  }
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile = guardFunction(process.loadEnvFile, "loadEnvFile", checkFsArguments);
  }
  syncBuiltinESMExports();
}

