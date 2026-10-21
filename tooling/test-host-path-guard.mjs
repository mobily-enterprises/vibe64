// Loaded into every test process (node --import, vitest setupFiles). Tests run
// on a person's own computer and must never change system locations: a write,
// a program started from one, or a command run inside one throws instead.
// Reading stays allowed (tests read /etc/passwd and find Homebrew tools).
// Child Node processes inherit the guard through NODE_OPTIONS; a child started
// with an environment rebuilt from scratch, and Playwright browser tests, run
// without it, but the command that starts such a child is still checked here.
import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SYSTEM_ROOTS = Object.freeze(["/var/lib", "/var/cache", "/opt", "/etc", "/usr/lib", "/run"]);
// The person's own runtime folder is theirs to use.
const OWN_RUNTIME_ROOT = `/run/user/${process.getuid?.() ?? os.userInfo().uid}`;
// Functions that change a path, with the argument indexes of the paths they change.
const WRITES = Object.freeze({
  appendFile: [0], chmod: [0], chown: [0], copyFile: [1], cp: [1], createWriteStream: [0], lchmod: [0],
  lchown: [0], link: [1], lutimes: [0], mkdir: [0], mkdtemp: [0], rename: [0, 1], rm: [0], rmdir: [0],
  symlink: [1], truncate: [0], unlink: [0], utimes: [0], writeFile: [0]
});
const CHILD_PROCESS_FUNCTIONS = ["exec", "execSync", "execFile", "execFileSync", "fork", "spawn", "spawnSync"];
const GUARDED = Symbol.for("vibe64.testHostPathGuard");

function pathText(value) {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof URL) return value.protocol === "file:" ? fileURLToPath(value) : "";
  return "";
}

function systemPathOf(value) {
  const text = pathText(value);
  if (!text || text.includes("\0")) return "";
  const resolved = path.resolve(text);
  const inside = (root) => resolved === root || resolved.startsWith(`${root}/`);
  return SYSTEM_ROOTS.some(inside) && !inside(OWN_RUNTIME_ROOT) ? resolved : "";
}

function refuse(systemPath, operation) {
  throw new Error(`test changed a system location: ${systemPath} (${operation})`);
}

function guardFunction(original, operation, check) {
  if (typeof original !== "function" || original[GUARDED]) return original;
  const guarded = function guardedSystemPathCall(...args) {
    check(args, operation);
    return Reflect.apply(original, this, args);
  };
  for (const key of Reflect.ownKeys(original)) {
    if (key === "length" || key === "name" || key === "prototype") continue;
    Object.defineProperty(guarded, key, Object.getOwnPropertyDescriptor(original, key));
  }
  Object.defineProperty(guarded, "name", { value: original.name });
  Object.defineProperty(guarded, GUARDED, { value: true });
  return guarded;
}

function checkWrite(args, operation) {
  for (const index of WRITES[operation.replace(/Sync$/u, "")]) {
    const systemPath = systemPathOf(args[index]);
    if (systemPath) refuse(systemPath, operation);
  }
}

function opensForWriting(flags) {
  if (typeof flags === "number") return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
  return /[wa+]/u.test(String(flags ?? "r"));
}

function checkOpen(args, operation) {
  const systemPath = opensForWriting(args[1]) && systemPathOf(args[0]);
  if (systemPath) refuse(systemPath, operation);
}

function checkChildProcess(args, operation) {
  const [command, second, third] = args;
  const options = Array.isArray(second) ? third : second;
  // exec runs a shell command line; its program is the first word.
  const program = operation === "exec" || operation === "execSync"
    ? String(command || "").trim().split(/\s+/u)[0]
    : pathText(command);
  const systemPath = program.startsWith("/") && systemPathOf(program);
  if (systemPath) refuse(systemPath, operation);
  const cwd = options && typeof options === "object" ? systemPathOf(options.cwd) : "";
  if (cwd) refuse(cwd, `${operation} cwd`);
}

function guardFs(target) {
  for (const name of Object.keys(target)) {
    const base = name.replace(/Sync$/u, "");
    const check = Object.hasOwn(WRITES, base) ? checkWrite : base === "open" ? checkOpen : null;
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    if (!check || !descriptor || typeof descriptor.value !== "function" || !descriptor.writable) continue;
    target[name] = guardFunction(descriptor.value, name, check);
  }
}

if (!globalThis[GUARDED]) {
  globalThis[GUARDED] = true;
  guardFs(fs);
  guardFs(fs.promises);
  for (const name of CHILD_PROCESS_FUNCTIONS) {
    childProcess[name] = guardFunction(childProcess[name], name, checkChildProcess);
  }
  // An env file from a system location would configure tests as that machine.
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile = guardFunction(process.loadEnvFile, "loadEnvFile", (args, operation) => {
      const systemPath = systemPathOf(args[0] ?? ".env");
      if (systemPath) refuse(systemPath, operation);
    });
  }
  syncBuiltinESMExports();
}
