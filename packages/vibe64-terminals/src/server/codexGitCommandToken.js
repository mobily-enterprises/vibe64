// What an agent's Git or GitHub CLI command may do when it carries the
// session's GitHub token. The token travels in the command's environment
// (VIBE64_GIT_AUTH_TOKEN for Vibe64's credential helper, GH_TOKEN for gh),
// where every program the command starts can read it. So such a command runs
// no program the AI chose:
//
// - It refuses an option, a shell variable or, for gh, a command that names a
//   program or Git config, saying what to do instead; it never drops one unseen.
// - It refuses a repository whose own config (local and worktree, with every
//   file they include) names a program it would run, or a TLS setting under
//   which another program could read its traffic.
// - It runs with what it cannot refuse switched off (GITHUB_TOKEN_COMMAND_ENV),
//   and Vibe64's credential helper clears every other one (gitConfigEnv.js).
//
// Only commands that reach GitHub carry the token; every other command keeps
// its freedom, none of this applying to it.

import { normalizeText } from "@local/vibe64-execution/server";
import { commandFailure } from "./commandFailure.js";
import { parseGitInvocation } from "./codexGitCommandOperations.js";
import { SUBCOMMAND_VALUE_OPTIONS, subcommandArguments } from "./codexGitCommandPlaces.js";

const TOKEN_REFUSED_CODE = "vibe64_codex_git_command_token_refused";
const TOKEN_RULE = "A Git or gh command that carries this session's GitHub token runs no program and reads no config " +
  "that its command line, its shell or its repository names, since that program would see the token.";

// Git operations that reach a remote. One naming a repository on this computer
// needs no token, and the rest only work on their repository.
const GITHUB_GIT_OPERATIONS = new Set(["clone", "fetch", "ls-remote", "pull", "push", "remote"]);
const LOCAL_REPOSITORY = /^(?:\/|~|\.\.?(?:\/|$)|file:)/iu;

// The shell variables that point Git at a program or config. None ever
// reaches a command (the wrapper forwards only CODEX_GIT_COMMAND_FORWARDED_ENV_NAMES),
// so one carrying the token refuses them rather than run without them unseen.
// Every agent shell has GIT_CONFIG_COUNT=0 of Vibe64's own.
const CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES = Object.freeze([
  "GIT_ASKPASS",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_EXEC_PATH",
  "GIT_EXTERNAL_DIFF",
  "GIT_PROXY_COMMAND",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_TEMPLATE_DIR"
]);

// What a command with the token runs with. Command-scope config outranks the
// repository's, so this switches off hooks (.git/hooks and core.hooksPath
// alike), fsmonitor, askpass, signing (a signing program) and recursion into
// submodules, whose own config is never read here. GIT_ALLOW_PROTOCOL
// overrides every protocol setting: no ssh, local, ext or remote-helper
// program. GIT_EDITOR and GIT_SEQUENCE_EDITOR ":" open no editor.
const TOKEN_COMMAND_CONFIG = Object.freeze([
  ["commit.gpgSign", "false"],
  ["core.askPass", ""],
  ["core.fsmonitor", "false"],
  ["core.hooksPath", "/dev/null"],
  ["fetch.recurseSubmodules", "false"],
  ["merge.verifySignatures", "false"],
  ["push.gpgSign", "false"],
  ["push.recurseSubmodules", "no"],
  ["submodule.recurse", "false"]
]);
const GITHUB_TOKEN_COMMAND_ENV = Object.freeze({
  GIT_ALLOW_PROTOCOL: "https",
  GIT_CONFIG_PARAMETERS: TOKEN_COMMAND_CONFIG.map(([key, value]) => `'${key}'='${value}'`).join(" "),
  GIT_EDITOR: ":",
  GIT_SEQUENCE_EDITOR: ":"
});

const TLS_SETTING = "a TLS setting under which another program could read the token on its way to GitHub";
// Config refused wherever it is set (the repository's own config, `-c`,
// `clone -c`): a program the command could run that nothing above switches
// off, or a TLS setting. Keys as `git config --list` shows them, in lower case.
const REFUSED_CONFIG = Object.freeze([
  [/^core\.alternaterefscommand$/u, "a program Git runs"],
  [/^diff\.(?:external|.+\.(?:command|textconv))$/u, "a diff program Git runs"],
  [/^filter\..+\.(?:clean|process|smudge)$/u, "a filter program Git runs"],
  [/^hook\..+\.command$/u, "a hook Git runs"],
  [/^lfs\.(?:customtransfer\..+\.path|extension\..+\.(?:clean|smudge))$/u, "a program Git LFS runs"],
  [/^merge\..+\.driver$/u, "a merge driver Git runs"],
  [/^http\.(?:.+\.)?(?:curloptresolve|sslcainfo|sslcapath)$/u, TLS_SETTING]
]);
// What the command switches off or decides itself, and the other config that
// names a program: its own command line may not set it either.
const COMMAND_LINE_REFUSED_CONFIG = new RegExp([
  "^(?:alias|credential|gpg|include|includeif|pager|submodule)\\.",
  "^core\\.(?:askpass|editor|fsmonitor|gitproxy|hookspath|pager|sshcommand)$",
  "^(?:commit|push)\\.gpgsign$",
  "^merge\\.verifysignatures$",
  "^(?:fetch|push)\\.recursesubmodules$",
  "^remote\\..+\\.(?:receivepack|uploadpack|vcs)$",
  "^sequence\\.editor$"
].join("|"), "u");
const GIT_FALSE = /^(?:false|no|off|0|)$/iu;
const BUILTIN_MERGE_STRATEGIES = new Set(["octopus", "ort", "ours", "recursive", "resolve", "subtree"]);

// Each operation's options that name a program or config. Git takes any
// unambiguous abbreviation of a long option, so a prefix counts too, except
// an option of its own (`exact`). `values` are the short options whose value
// is the rest of their argument or the next one.
const REFUSED_OPTIONS = Object.freeze({
  clone: { long: ["config", "template", "upload-pack"], short: "cu", values: "bcjou" },
  fetch: { long: ["recurse-submodules", "upload-pack"], short: "", values: "jo" },
  "ls-remote": { long: ["upload-pack"], short: "u", values: "ou" },
  pull: {
    exact: ["verify"],
    long: ["gpg-sign", "recurse-submodules", "strategy", "upload-pack", "verify-signatures"],
    short: "Ss",
    values: "jXos"
  },
  push: { long: ["exec", "receive-pack", "recurse-submodules", "signed"], short: "", values: "o" }
});
const OPTION_HINTS = Object.freeze({
  exec: "names the program run at the other end; leave it out",
  "gpg-sign": "runs a signing program; leave it out",
  "receive-pack": "names the program run at the other end; leave it out",
  "recurse-submodules": "would run Git in submodules, whose own config is not checked; leave it out " +
    "(or give --no-recurse-submodules) and run the command in the submodule (git -C <submodule> ...)",
  signed: "runs a signing program; leave it out",
  strategy: "names a merge strategy, a program unless it is one of Git's own (ort, recursive, resolve, octopus, ours, " +
    "subtree); use one of those",
  template: "copies hooks from a folder; leave it out",
  "upload-pack": "names the program run at the other end; leave it out",
  "verify-signatures": "runs a signing program; leave it out"
});
const SHORT_OPTIONS = Object.freeze({ S: "gpg-sign", c: "config", s: "strategy", u: "upload-pack" });

// The GitHub CLI's own commands a command with the token runs. gh runs an
// alias or extension, a program of its own, for any other name, and `auth`,
// `alias`, `config`, `extension` and `codespace` show the token, change gh
// itself or open remote shells.
const GH_TOKEN_COMMANDS = new Set(["api", "attestation", "cache", "completion", "gist", "gpg-key", "help", "issue",
  "label", "org", "pr", "project", "release", "repo", "ruleset", "run", "search", "secret", "ssh-key", "status",
  "variable", "version", "workflow", "--help", "-h", "--version"]);

const CONFIG_READ_ARGS = Object.freeze(["config", "--list", "--includes", "--show-scope", "--show-origin", "-z"]);
const REPOSITORY_SCOPES = new Set(["local", "worktree"]);
// The repository's own config file, which Git names from its top folder, not a file it includes.
const REPOSITORY_CONFIG_FILE = /(?:^|\/)config(?:\.worktree)?$/u;

function tokenRefusal(message) {
  return commandFailure(message, TOKEN_REFUSED_CODE, { statusCode: 403 });
}

/** Whether a command carries the session's GitHub token: gh always, Git when it reaches GitHub. */
function commandRequiresGithubToken(command = "", args = []) {
  if (normalizeText(command) === "gh") return true;
  const values = args.map((arg) => String(arg));
  const invocation = parseGitInvocation(values);
  if (!GITHUB_GIT_OPERATIONS.has(invocation.operation)) return false;
  if (invocation.operation === "remote") return true;
  const valueOptions = SUBCOMMAND_VALUE_OPTIONS[invocation.operation];
  const { options, positionals } = subcommandArguments(values, invocation.operationIndex + 1, valueOptions);
  const repository = (options.get("--repo") || []).at(-1) ?? positionals[0];
  return repository === undefined || !LOCAL_REPOSITORY.test(repository);
}

/**
 * Why config would hand the token to a program, or "".
 * @param {string} key as Git lists it
 * @param {string | null} value null for a key given without one
 * @param {{ commandLine?: boolean }} [options] the command's own `-c`, which may not undo what it switches off
 */
function configRefusalReason(key, value, { commandLine = false } = {}) {
  const name = key.toLowerCase();
  const refused = REFUSED_CONFIG.find(([pattern]) => pattern.test(name));
  if (refused) return refused[1];
  if (/^http\.(?:.+\.)?sslverify$/u.test(name) && value !== null && GIT_FALSE.test(value.trim())) return TLS_SETTING;
  if (/^pull\.(?:octopus|twohead)$/u.test(name) &&
      String(value ?? "").split(/\s+/u).some((strategy) => strategy && !BUILTIN_MERGE_STRATEGIES.has(strategy))) {
    return "a merge strategy, a program Git runs";
  }
  if (commandLine && COMMAND_LINE_REFUSED_CONFIG.test(name)) {
    return "a setting such a command decides itself: it runs with hooks, fsmonitor, askpass, editors, signing and " +
      "submodule recursion off and Vibe64's credential helper only";
  }
  return "";
}

function commandLineConfigRefusal(label, setting = "") {
  const equals = setting.indexOf("=");
  const key = equals >= 0 ? setting.slice(0, equals) : setting;
  const reason = configRefusalReason(key, equals >= 0 ? setting.slice(equals + 1) : null, { commandLine: true });
  return reason ? tokenRefusal(`${label} ${key} is ${reason}. ${TOKEN_RULE} Leave it out.`) : null;
}

function globalOptionRefusal(values, operationIndex) {
  for (let index = 0; index < operationIndex; index += 1) {
    const value = values[index];
    if (value === "-c") {
      const refusal = commandLineConfigRefusal("-c", values[index + 1] ?? "");
      if (refusal) return refusal;
      index += 1;
    } else if (value === "--config-env" || value.startsWith("--config-env=")) {
      return tokenRefusal(`--config-env turns a variable, which could be the token itself, into Git config. ${TOKEN_RULE} ` +
        "Leave it out; give harmless config with -c <key>=<value>.");
    } else if (value.startsWith("--exec-path=")) {
      return tokenRefusal(`--exec-path= points Git at programs of its own. ${TOKEN_RULE} Leave it out.`);
    }
  }
  return null;
}

/** A refused option's refusal, or null for `--recurse-submodules=no`, Git's own strategies and harmless config. */
function optionRefusal(operation, label, option, given) {
  if (option === "config") return commandLineConfigRefusal(`${operation} ${label}`, given ?? "");
  if (option === "recurse-submodules" && given !== undefined && GIT_FALSE.test(given)) return null;
  if (option === "strategy" && BUILTIN_MERGE_STRATEGIES.has(given ?? "")) return null;
  return tokenRefusal(`git ${operation} ${label} ${OPTION_HINTS[option]}. ${TOKEN_RULE}`);
}

function subcommandOptionRefusal(operation, values) {
  const rules = REFUSED_OPTIONS[operation];
  if (!rules) return null;
  const valueOptions = SUBCOMMAND_VALUE_OPTIONS[operation] || new Set();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") break;
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      const name = value.slice(2, equals > 0 ? equals : undefined);
      const option = name && !(rules.exact || []).includes(name) ? rules.long.find((long) => long.startsWith(name)) : undefined;
      const separate = equals < 0 && valueOptions.has(`--${option}`);
      const given = equals > 0 ? value.slice(equals + 1) : separate ? values[index + 1] : undefined;
      const refusal = option && optionRefusal(operation, `--${option}`, option, given);
      if (refusal) return refusal;
      if (equals < 0 && (separate || valueOptions.has(value))) index += 1;
    } else if (value.startsWith("-") && value.length > 1) {
      for (let at = 1; at < value.length; at += 1) {
        const letter = value[at];
        const rest = value.slice(at + 1);
        if (rules.short.includes(letter)) {
          // `-S` takes its key only in the same argument.
          const given = rest || (letter === "S" ? undefined : values[index + 1]);
          const refusal = optionRefusal(operation, `-${letter}`, SHORT_OPTIONS[letter], given);
          if (refusal) return refusal;
        }
        if (rules.values.includes(letter) || rules.short.includes(letter)) {
          if (!rest && letter !== "S") index += 1;
          break;
        }
      }
    }
  }
  return null;
}

function programEnvRefusal(env) {
  const record = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  const names = CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES.filter((name) => typeof record[name] === "string" && record[name] !== "" &&
    (name !== "GIT_CONFIG_COUNT" || Number(record[name]) > 0));
  if (!names.length) return null;
  return tokenRefusal(`This shell sets ${names.join(", ")}, which point${names.length === 1 ? "s" : ""} Git at a program ` +
    `or config. ${TOKEN_RULE} It never takes ${names.length === 1 ? "it" : "them"} from the shell, so it refuses rather ` +
    `than ignore ${names.length === 1 ? "it" : "them"}: unset ${names.length === 1 ? "it" : "them"} for this command ` +
    `(env ${names.map((name) => `-u ${name}`).join(" ")} git ...).`);
}

function ghCommandRefusal(args) {
  const name = String(args[0] ?? "");
  if (!name || GH_TOKEN_COMMANDS.has(name)) return null;
  if (name === "auth") {
    return tokenRefusal("gh auth shows or changes the session's GitHub sign-in, which the AI's gh never does: the person " +
      "signs in to GitHub in Vibe64 (Account settings → GitHub).");
  }
  return tokenRefusal(`gh ${name} is not one of the GitHub CLI's own commands Vibe64 runs with the session's GitHub ` +
    "token: an alias or extension is a program of its own, and gh alias, config, extension and codespace change gh " +
    "itself or open remote shells. Use gh's own commands, such as gh pr, gh issue, gh repo or gh api.");
}

/**
 * Why a command that carries the session's GitHub token may not run as given, or null.
 * @param {object} request
 * @param {string[]} request.args
 * @param {string} request.command git or gh
 * @param {unknown} request.env what the wrapper sent from the command's shell
 */
function githubTokenCommandRefusal({ args, command, env }) {
  const envRefusal = programEnvRefusal(env);
  if (envRefusal) return envRefusal;
  if (command === "gh") return ghCommandRefusal(args);
  const invocation = parseGitInvocation(args);
  return globalOptionRefusal(args, invocation.operationIndex) ||
    subcommandOptionRefusal(invocation.operation, args.slice(invocation.operationIndex + 1));
}

/** `git config --list --show-scope --show-origin -z` entries. */
function configEntries(stdout = "") {
  const fields = stdout.split("\0");
  const entries = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [scope, origin, item] = fields.slice(index, index + 3);
    const newline = item.indexOf("\n");
    entries.push({
      key: newline >= 0 ? item.slice(0, newline) : item,
      origin: origin.replace(/^file:/u, ""),
      scope,
      value: newline >= 0 ? item.slice(newline + 1) : null
    });
  }
  return entries;
}

function resultText(result = {}, name = "stdout") {
  return Buffer.from(result[name] || "", result.outputEncoding === "base64" ? "base64" : "utf8").toString("utf8");
}

/**
 * Reads the config of the repository the command works on, as Git reads it
 * there, and refuses the command when its own config names a program or a TLS
 * setting. The person's and the host's own config (global, system) are theirs.
 * A read that timed out is returned as it is, for the command's own result.
 * @param {object} request
 * @param {string[]} request.args
 * @param {string} request.command git or gh
 * @param {(args: string[]) => Promise<object>} request.readConfig runs plain Git where the command runs
 */
async function githubTokenConfigRefusal({ args, command, readConfig }) {
  const invocation = command === "git" ? parseGitInvocation(args) : { operation: "", operationIndex: 0 };
  // A clone makes its repository; the one it runs in has no say.
  if (invocation.operation === "clone") return null;
  const result = await readConfig([...args.slice(0, invocation.operationIndex), ...CONFIG_READ_ARGS]);
  if (result?.timedOut) return result;
  if (result?.ok !== true) {
    return tokenRefusal("Vibe64 could not read this repository's Git config, so the command, which carries the " +
      `session's GitHub token, did not run: ${normalizeText(resultText(result, "stderr") || result?.error)}`);
  }
  for (const { key, origin, scope, value } of configEntries(resultText(result))) {
    const reason = REPOSITORY_SCOPES.has(scope) ? configRefusalReason(key, value) : "";
    if (reason) {
      const file = REPOSITORY_CONFIG_FILE.test(origin) ? `--${scope}` : `--file ${origin}`;
      return tokenRefusal(`This repository's Git config sets ${key} (${origin}), ${reason}. ${TOKEN_RULE} Remove it ` +
        `(git config ${file} --unset-all ${key}) and run the command again.`);
    }
  }
  return null;
}

export {
  CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES,
  commandRequiresGithubToken,
  GITHUB_TOKEN_COMMAND_ENV,
  githubTokenCommandRefusal,
  githubTokenConfigRefusal
};
