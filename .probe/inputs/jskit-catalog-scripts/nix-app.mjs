// The programs of a JSKIT app that `jskit package nix` packaged. The package.nix it writes embeds this file whole, so
// it imports only Node's own modules. The package's bin/ runs it with the app's folder (--app) and a shell (--shell):
//
//   <app> [--env FILE] [--migrate]   serve: the app's start script, in place of this process; with --migrate, its
//                                    db:migrate script first when it has one
//   <app>-migrate [--env FILE]       migrate: its db:migrate script, in place of this process
//   <app>-check [--env FILE]         check: exits 0 once GET /api/health answers 200, 1 after --wait seconds (60)
//   <app>-prepare --settings JSON --env FILE [--user NAME]
//                                    prepare: the settings, one JSON object, written as FILE for NAME alone, and the
//                                    folders they name for the app's files made for NAME
//
// A script runs as `npm run` would run it, with no npm: from the app's folder, by the shell, with node_modules/.bin
// and this Node first on PATH, NODE_ENV=production unless the environment or the env file says otherwise, and the
// env file's variables (Node's .env format) over the environment's. The option is --env, not --env-file: Node reads
// an --env-file anywhere on its command line, even after the script, and fails when the file is not there yet.
// The package's build runs `npm-cache LIST DIR`:
// it files each tarball LIST names (one `<integrity> <file>` line each) in npm's cache at DIR, by every hash of its
// integrity, where `npm ci` looks before it would download, so npm installs package-lock.json with no network.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
// The quotes a value can be written in, as Node's .env parser reads them back: single quotes and backticks keep it
// as written; double quotes turn \n into a new line, so they hold only a value without a backslash.
const QUOTES = Object.freeze(["'", "`", "\""]);
const HEALTH_PATH = "/api/health";
const MODES = Object.freeze(["serve", "migrate", "check", "prepare", "npm-cache"]);
// The settings that name a folder a JSKIT app writes its files in (uploads, local and OIDC sign-in's files), each kept
// under the app's own read-only folder unless a setting names another. prepare makes each one given as an absolute
// path, for the user the app runs as.
const FILE_FOLDERS = Object.freeze(["JSKIT_STORAGE_FS_BASE_PATH", "AUTH_LOCAL_STORE_DIR", "AUTH_OIDC_STORE_DIR"]);

class Refusal extends Error {}

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * The settings as an env file Node reads back exactly (`process.loadEnvFile`, `util.parseEnv`), one quoted line each.
 * @param {unknown} settings one JSON object: an environment variable's name to a string, a number or true or false
 */
function formatEnvFile(settings) {
  if (!isObject(settings)) throw new Refusal("The settings must be one JSON object of environment variables.");
  return Object.entries(settings).map(([name, value]) => {
    if (!ENV_NAME.test(name)) {
      throw new Refusal(`The setting ${name} is not an environment variable name (letters, digits and _, not first a digit).`);
    }
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new Refusal(`The setting ${name} must be a string, a number or true or false.`);
    }
    const text = String(value);
    const quote = QUOTES.find((mark) => !text.includes(mark) && (mark !== "\"" || !text.includes("\\")));
    if (!quote) throw new Refusal(`The setting ${name} holds ', \` and " together, which an env file cannot hold.`);
    return `${name}=${quote}${text}${quote}\n`;
  }).join("");
}

/** The environment a script of the app runs with. */
function scriptEnvironment({ app, envFile }) {
  const env = { ...process.env, ...(envFile ? parseEnv(readFileSync(envFile, "utf8")) : {}) };
  env.NODE_ENV ||= "production";
  env.PATH = [path.join(app, "node_modules", ".bin"), path.dirname(process.execPath), env.PATH].filter(Boolean).join(":");
  return env;
}

/** The app's script `name`; when it has none, null if `optional`, else a refusal. */
function scriptOf(app, name, { optional = false } = {}) {
  const manifest = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
  const script = manifest.scripts?.[name];
  if (typeof script === "string" && script.trim()) return script;
  if (optional) return null;
  throw new Refusal(`${manifest.name ?? app} has no ${name} script.`);
}

/**
 * Runs the app's script `name` in place of this process; with `first` (db:migrate), runs that script before it, when
 * the app has one, and stops on its failure. An app without it has nothing to migrate, so it starts: one service
 * command then fits every app.
 */
function replaceWithScript({ app, shell, envFile, name, first }) {
  const env = scriptEnvironment({ app, envFile });
  const script = scriptOf(app, name);
  const firstScript = first ? scriptOf(app, first, { optional: true }) : null;
  if (first && firstScript === null) {
    const { name: appName } = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
    process.stderr.write(`${appName ?? app} has no ${first} script, so there is nothing to migrate: starting it.\n`);
  } else if (first) {
    const ran = spawnSync(shell, ["-c", firstScript], { cwd: app, env: { ...env, npm_lifecycle_event: first }, stdio: "inherit" });
    if (ran.error) throw ran.error;
    if (ran.status !== 0) return ran.status ?? 1;
  }
  process.chdir(app);
  process.execve(shell, [shell, "-c", script], { ...env, npm_lifecycle_event: name });
  return 1;
}

async function check({ envFile, wait }) {
  const env = envFile ? { ...process.env, ...parseEnv(readFileSync(envFile, "utf8")) } : process.env;
  const port = Number.parseInt(String(env.PORT ?? ""), 10) || 3000;
  const host = !env.HOST || env.HOST === "0.0.0.0" || env.HOST === "::" ? "127.0.0.1" : env.HOST;
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}${HEALTH_PATH}`;
  const deadline = Date.now() + wait * 1000;
  let last = "no answer";
  do {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = (await response.text()).slice(0, 2000);
      if (response.status === 200) {
        process.stdout.write(`${body}\n`);
        return 0;
      }
      last = `${HEALTH_PATH} answered ${response.status}: ${body}`;
    } catch (error) {
      last = error.cause?.code ?? error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  process.stderr.write(`${url} did not answer 200 within ${wait} s: ${last}\n`);
  return 1;
}

/** Gives `file` to `user` with the host's own chown, which finds the user through whichever account databases it keeps. */
function chownTo(user, file) {
  const owned = spawnSync("chown", ["--", `${user}:`, file], { encoding: "utf8" });
  if (owned.error || owned.status !== 0) throw new Refusal(`chown ${user}: ${owned.stderr || owned.error?.message}`.trim());
}

function prepare({ settings, envFile, user }) {
  if (!settings || !envFile) throw new Refusal("prepare needs --settings FILE and --env FILE.");
  const values = JSON.parse(readFileSync(settings, "utf8"));
  const text = formatEnvFile(values);
  // A host runs prepare as root before the app's services start, so the user they run as can write where the
  // settings keep the app's files (a host's data folder is its own until then). A relative folder is the app's own.
  for (const name of FILE_FOLDERS) {
    const folder = values[name];
    if (typeof folder !== "string" || !path.isAbsolute(folder)) continue;
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    if (user) chownTo(user, folder);
  }
  mkdirSync(path.dirname(envFile), { recursive: true });
  const temporary = `${envFile}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600 });
    if (user) chownTo(user, temporary);
    renameSync(temporary, envFile);
  } finally {
    rmSync(temporary, { force: true });
  }
  return 0;
}

function npmCache(list, cache) {
  for (const line of readFileSync(list, "utf8").split("\n")) {
    const words = line.split(/\s+/u).filter(Boolean);
    const file = words.pop();
    for (const hash of words) {
      const separator = hash.indexOf("-");
      const hex = Buffer.from(hash.slice(separator + 1), "base64").toString("hex");
      const entry = path.join(cache, "_cacache", "content-v2", hash.slice(0, separator), hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
      mkdirSync(path.dirname(entry), { recursive: true });
      if (!existsSync(entry)) symlinkSync(file, entry);
    }
  }
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      app: { type: "string" },
      shell: { type: "string", default: "/bin/sh" },
      env: { type: "string" },
      migrate: { type: "boolean", default: false },
      settings: { type: "string" },
      user: { type: "string" },
      wait: { type: "string", default: "60" }
    }
  });
  const [mode, ...rest] = positionals;
  if (!MODES.includes(mode)) throw new Refusal(`The mode must be one of ${MODES.join(", ")}: ${mode}`);
  const app = values.app ? path.resolve(values.app) : process.cwd();
  const envFile = values.env ? path.resolve(values.env) : null;
  if (mode === "serve") return replaceWithScript({ app, shell: values.shell, envFile, name: "start", first: values.migrate ? "db:migrate" : null });
  if (mode === "migrate") return replaceWithScript({ app, shell: values.shell, envFile, name: "db:migrate" });
  if (mode === "check") return check({ envFile, wait: Number(values.wait) || 60 });
  if (mode === "prepare") return prepare({ settings: values.settings, envFile, user: values.user });
  return npmCache(rest[0], rest[1]);
}

function isCliEntrypoint(argvPath = process.argv[1]) {
  try {
    return Boolean(argvPath) && realpathSync(argvPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isCliEntrypoint()) {
  main().then((code) => {
    process.exitCode = code;
  }, (error) => {
    process.stderr.write(`${error instanceof Refusal ? error.message : error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

export { formatEnvFile, main };
