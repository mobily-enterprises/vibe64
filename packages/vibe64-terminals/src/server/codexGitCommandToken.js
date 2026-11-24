// What an agent's Git or GitHub CLI command may do when it carries the
// session's GitHub token, where every program the command starts can read it.
// Such a command runs no program the AI chose: it refuses an option, a shell
// variable or, for gh, a command that names a program or Git config, saying
// what to do instead, and never drops one unseen. Its repository's own config
// and what it runs with are those of any Git with the token (githubTokenGit.js).
//
// Only commands that reach GitHub carry the token; every other command keeps
// its freedom, none of this applying to it. Git in the session's temporary
// folder, plain local Git that takes none of the shell's program or config
// variables either, refuses those the same way (temporaryFolderEnvRefusal).

import { normalizeText } from "@local/vibe64-execution/server";
import { commandFailure } from "./commandFailure.js";
import { parseGitInvocation } from "./codexGitCommandOperations.js";
import { SUBCOMMAND_VALUE_OPTIONS, subcommandArguments } from "./codexGitCommandPlaces.js";
import { configRefusalReason, TOKEN_RULE, tokenRefusal } from "./githubTokenGit.js";

// Git operations that reach a remote. One naming a repository on this computer
// needs no token, and the rest only work on their repository.
const GITHUB_GIT_OPERATIONS = new Set(["clone", "fetch", "ls-remote", "pull", "push", "remote"]);
const LOCAL_REPOSITORY = /^(?:\/|~|\.\.?(?:\/|$)|file:)/iu;

// The shell variables that point Git at a program or config. None ever
// reaches a command (the wrapper forwards only CODEX_GIT_COMMAND_FORWARDED_ENV_NAMES),
// so one carrying the token, or run in the temporary folder, refuses them
// rather than run without them unseen. Every agent shell has GIT_CONFIG_COUNT=0
// of Vibe64's own; GIT_CONFIG_KEY_<n> and GIT_CONFIG_VALUE_<n> count only below it.
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

// Besides config that names a program (configRefusalReason), the command's own
// `-c` may not set what it switches off or decides itself, nor other config
// that names a program.
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

function commandLineConfigRefusal(label, setting = "") {
  const equals = setting.indexOf("=");
  const key = equals >= 0 ? setting.slice(0, equals) : setting;
  const reason = configRefusalReason(key, equals >= 0 ? setting.slice(equals + 1) : null) ||
    (COMMAND_LINE_REFUSED_CONFIG.test(key.toLowerCase())
      ? "a setting such a command decides itself: it runs with hooks, fsmonitor, askpass, editors, signing and " +
        "submodule recursion off and Vibe64's credential helper only"
      : "");
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

const TEMPORARY_FOLDER_RULE = "Git in this session's temporary folder is plain local Git, which takes only GIT_DIR, " +
  "GIT_WORK_TREE and the author's and committer's names, emails and dates from its shell.";
const TEMPORARY_FOLDER_ENV_REFUSED_CODE = "vibe64_codex_git_command_temp_env_refused";

/**
 * Why a command may not run with the shell's Git program and config variables, which never reach it, or "".
 * @param {unknown} env what the wrapper sent from the command's shell
 * @param {string} rule what the command takes instead
 */
function programEnvRefusalMessage(env, rule) {
  const record = env && typeof env === "object" && !Array.isArray(env) ? env : {};
  const names = CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES.filter((name) => typeof record[name] === "string" && record[name] !== "" &&
    (name !== "GIT_CONFIG_COUNT" || Number(record[name]) > 0));
  if (!names.length) return "";
  const count = Number(record.GIT_CONFIG_COUNT);
  const shown = names.map((name) => {
    if (name !== "GIT_CONFIG_COUNT" || !Number.isInteger(count)) return name;
    return count === 1
      ? "GIT_CONFIG_COUNT with GIT_CONFIG_KEY_0 and GIT_CONFIG_VALUE_0"
      : `GIT_CONFIG_COUNT with GIT_CONFIG_KEY_0 to GIT_CONFIG_KEY_${count - 1} and GIT_CONFIG_VALUE_0 to GIT_CONFIG_VALUE_${count - 1}`;
  });
  const one = names.length === 1;
  return `This shell sets ${shown.join(", ")}, which point${one ? "s" : ""} Git at a program or config. ${rule} ` +
    `It never takes ${one ? "it" : "them"} from the shell, so it refuses rather than ignore ${one ? "it" : "them"}: ` +
    `unset ${one ? "it" : "them"} for this command (env ${names.map((name) => `-u ${name}`).join(" ")} git ...).`;
}

function programEnvRefusal(env) {
  const message = programEnvRefusalMessage(env, TOKEN_RULE);
  return message ? tokenRefusal(message) : null;
}

/**
 * Why a command in the session's temporary folder may not run as its shell gives it, or null: a shell variable that
 * would point Git at a program or config, which plain local Git there never takes.
 * @param {unknown} env what the wrapper sent from the command's shell
 */
function temporaryFolderEnvRefusal(env) {
  const message = programEnvRefusalMessage(env, TEMPORARY_FOLDER_RULE);
  if (!message) return null;
  return commandFailure(
    `${message} Config the command needs goes on its command line (git -c <key>=<value> ...).`,
    TEMPORARY_FOLDER_ENV_REFUSED_CODE,
    { statusCode: 403 }
  );
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

export {
  CODEX_GIT_COMMAND_PROGRAM_ENV_NAMES,
  commandRequiresGithubToken,
  githubTokenCommandRefusal,
  temporaryFolderEnvRefusal
};
