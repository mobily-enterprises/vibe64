// What any Git that carries a session's GitHub credential runs with: the AI's
// own Git and gh (codexGitCommandToken.js) and Save's, Update's and work
// inspection's Git (sessionWorkCommands.js). The token travels in the
// command's environment (VIBE64_GIT_AUTH_TOKEN for Vibe64's credential helper,
// GH_TOKEN for gh), or comes from the person's own helper on a computer signed
// in to GitHub itself, so every program the command starts can reach it. Such
// a command runs no program its repository names:
//
// - It runs with what can be switched off switched off (GITHUB_TOKEN_COMMAND_ENV),
//   and Vibe64's credential helper clears every other one (gitConfigEnv.js).
// - Just before it runs, a read of its repository's own config (local and
//   worktree, with every file they include) refuses one that names a program
//   the command could run, or a TLS setting under which another program could
//   read its traffic (githubTokenConfigRefusal).

import { normalizeText } from "@local/vibe64-execution/server/normalize";
import { commandFailure } from "./commandFailure.js";
import { parseGitInvocation } from "./codexGitCommandOperations.js";

const TOKEN_REFUSED_CODE = "vibe64_codex_git_command_token_refused";
const TOKEN_RULE = "Git or gh that carries this session's GitHub token, the AI's or Save's, runs no program and reads " +
  "no config that its command line, its shell or its repository names, since that program would see the token.";

// Command-scope config outranks the repository's, so this switches off hooks
// (.git/hooks and core.hooksPath alike), fsmonitor, askpass, signing (a
// signing program) and recursion into submodules, whose own config is never
// read. GIT_ALLOW_PROTOCOL overrides every protocol setting: no ssh, local,
// ext or remote-helper program. GIT_EDITOR and GIT_SEQUENCE_EDITOR ":" open no
// editor. Every program the command starts inherits all of it.
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
// Config naming a program that nothing above switches off, or a TLS setting.
// Keys as `git config --list` shows them, in lower case. A Git command that
// only talks to the remote (NETWORK_OPERATIONS) can run just the first; one
// that merges, checks out or diffs too (pull, gh's own Git, Save and Update)
// can run both.
const NETWORK_REFUSED_CONFIG = Object.freeze([
  [/^core\.alternaterefscommand$/u, "a program Git runs"],
  [/^hook\..+\.command$/u, "a hook Git runs"],
  [/^http\.(?:.+\.)?(?:curloptresolve|sslcainfo|sslcapath)$/u, TLS_SETTING]
]);
const WORK_TREE_REFUSED_CONFIG = Object.freeze([
  [/^diff\.(?:external|.+\.(?:command|textconv))$/u, "a diff program Git runs"],
  [/^filter\..+\.(?:clean|process|smudge)$/u, "a filter program Git runs"],
  [/^lfs\.(?:customtransfer\..+\.path|extension\..+\.(?:clean|smudge))$/u, "a program Git LFS runs"],
  [/^merge\..+\.driver$/u, "a merge driver Git runs"]
]);
const NETWORK_OPERATIONS = new Set(["fetch", "ls-remote", "push", "remote"]);
const GIT_FALSE = /^(?:false|no|off|0|)$/iu;
const BUILTIN_MERGE_STRATEGIES = new Set(["octopus", "ort", "ours", "recursive", "resolve", "subtree"]);

const CONFIG_READ_ARGS = Object.freeze(["config", "--list", "--includes", "--show-scope", "--show-origin", "-z"]);
const REPOSITORY_SCOPES = new Set(["local", "worktree"]);
// The repository's own config file, which Git names from its top folder, not a file it includes.
const REPOSITORY_CONFIG_FILE = /(?:^|\/)config(?:\.worktree)?$/u;

function tokenRefusal(message) {
  return commandFailure(message, TOKEN_REFUSED_CODE, { statusCode: 403 });
}

/**
 * Why config would hand the token to a program, or "".
 * @param {string} key as Git lists it
 * @param {string | null} value null for a key given without one
 * @param {{ networkOnly?: boolean }} [options] for a command that only talks to the remote
 */
function configRefusalReason(key, value, { networkOnly = false } = {}) {
  const name = key.toLowerCase();
  const refused = [...NETWORK_REFUSED_CONFIG, ...(networkOnly ? [] : WORK_TREE_REFUSED_CONFIG)]
    .find(([pattern]) => pattern.test(name));
  if (refused) return refused[1];
  if (/^http\.(?:.+\.)?sslverify$/u.test(name) && value !== null && GIT_FALSE.test(value.trim())) return TLS_SETTING;
  if (!networkOnly && /^pull\.(?:octopus|twohead)$/u.test(name) &&
      String(value ?? "").split(/\s+/u).some((strategy) => strategy && !BUILTIN_MERGE_STRATEGIES.has(strategy))) {
    return "a merge strategy, a program Git runs";
  }
  return "";
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
 * there, and refuses the command when its own config names a program the
 * command could run, or a TLS setting. The person's and the host's own config
 * (global, system) are theirs. A read that timed out is returned as it is, for
 * the command's own result.
 * @param {object} request
 * @param {string[]} request.args
 * @param {string} request.command git, or another program (gh, Save's operation) that runs Git where it starts
 * @param {(args: string[]) => Promise<object>} request.readConfig runs plain Git, with no token, where the command runs
 */
async function githubTokenConfigRefusal({ args, command, readConfig }) {
  const invocation = command === "git" ? parseGitInvocation(args) : { operation: "", operationIndex: 0 };
  // A clone makes its repository; the one it runs in has no say.
  if (invocation.operation === "clone") return null;
  const networkOnly = command === "git" && NETWORK_OPERATIONS.has(invocation.operation);
  const result = await readConfig([...args.slice(0, invocation.operationIndex), ...CONFIG_READ_ARGS]);
  if (result?.timedOut) return result;
  if (result?.ok !== true) {
    return tokenRefusal("Vibe64 could not read this repository's Git config, so Git that carries the session's " +
      `GitHub token did not run: ${normalizeText(resultText(result, "stderr") || result?.error)}`);
  }
  for (const { key, origin, scope, value } of configEntries(resultText(result))) {
    const reason = REPOSITORY_SCOPES.has(scope) ? configRefusalReason(key, value, { networkOnly }) : "";
    if (reason) {
      const file = REPOSITORY_CONFIG_FILE.test(origin) ? `--${scope}` : `--file ${origin}`;
      return tokenRefusal(`This repository's Git config sets ${key} (${origin}), ${reason}. ${TOKEN_RULE} Remove it ` +
        `(git config ${file} --unset-all ${key}) and try again.`);
    }
  }
  return null;
}

export {
  configRefusalReason,
  GITHUB_TOKEN_COMMAND_ENV,
  githubTokenConfigRefusal,
  TOKEN_RULE,
  tokenRefusal
};
