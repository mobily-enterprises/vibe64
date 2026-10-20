import { accessSync, constants, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { runtimePackRoot } from "./runtimePacks.js";

// Official one-line installers, checked 2026-10-21. Only someone using their
// own tools is shown them; a host with runtime packs installs its own.
const OPERATOR_CLIS = Object.freeze({
  claude: Object.freeze({ name: "Claude Code", provider: "Claude",
    install: "curl -fsSL https://claude.ai/install.sh | bash", guideUrl: "https://code.claude.com/docs/en/setup" }),
  codex: Object.freeze({ name: "Codex", provider: "ChatGPT",
    install: "curl -fsSL https://chatgpt.com/codex/install.sh | sh", guideUrl: "https://github.com/openai/codex" }),
  opencode: Object.freeze({ name: "opencode", provider: "your API-key providers",
    install: "curl -fsSL https://opencode.ai/install | bash", guideUrl: "https://opencode.ai/docs/" })
});

function executable(file = "") {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function nvmBinDirs(home = "") {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    return readdirSync(root)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => path.join(root, version, "bin"));
  } catch {
    return [];
  }
}

// Where the official installers and npm put a person's own CLI. A server
// started outside a login shell may lack these on PATH.
function operatorCliSearchDirs(env = process.env) {
  const home = String(env.HOME || os.homedir() || "");
  const homeDirs = home
    ? [".local/bin", ".claude/local", ".opencode/bin", ".npm-global/bin", ".bun/bin", ".volta/bin"]
      .map((dir) => path.join(home, dir)).concat(nvmBinDirs(home))
    : [];
  const dirs = [
    ...String(env.PATH || "").split(path.delimiter),
    ...homeDirs,
    path.dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin"
  ].filter((dir) => path.isAbsolute(dir));
  return [...new Set(dirs)];
}

/**
 * The Claude Code, Codex or opencode executable Vibe64 runs. A host with
 * runtime packs uses its pinned launchers; otherwise the person's own
 * installation (and its existing login) is found again on every call, so
 * "Check again" sees a CLI installed a moment ago.
 */
function resolveOperatorCli(tool = "", { env = process.env } = {}) {
  if (!Object.hasOwn(OPERATOR_CLIS, tool)) throw new TypeError(`Unknown operator CLI: ${tool}`);
  const override = tool === "claude" ? String(env.VIBE64_CLAUDE_COMMAND || "").trim() : "";
  const root = runtimePackRoot();
  if (root) {
    const command = override || (tool === "opencode" ? "opencode" : path.join(root, "managed-bin", tool));
    return { command, installed: true, searched: [] };
  }
  if (override) return { command: override, installed: executable(override), searched: [override] };
  const searched = operatorCliSearchDirs(env);
  const found = searched.map((dir) => path.join(dir, tool)).find(executable);
  return { command: found || tool, installed: Boolean(found), searched };
}

function operatorCliCommand(tool = "", options = {}) {
  return resolveOperatorCli(tool, options).command;
}

/**
 * Plain wording for a CLI that is missing or did not start. `install` is
 * present only when the person installs their own tools.
 */
function operatorCliProblem(tool = "", { installed = false } = {}) {
  const { name, provider, install, guideUrl } = OPERATOR_CLIS[tool];
  const ownTools = !runtimePackRoot();
  const message = !installed
    ? `${name} isn't installed on this computer. Vibe64 uses it to work with ${provider}. Install it, then choose Check again.`
    : ownTools
      ? `${name} is installed but didn't start. Choose Check again; if it keeps failing, reinstall it.`
      : `${name} didn't start. Choose Check again; if it keeps failing, contact whoever runs this Vibe64.`;
  return {
    code: installed ? "vibe64_cli_unavailable" : "vibe64_cli_not_installed",
    status: installed ? "unavailable" : "not_installed",
    message,
    ...(ownTools ? { install: { command: install, guideUrl } } : {})
  };
}

export {
  OPERATOR_CLIS,
  operatorCliCommand,
  operatorCliProblem,
  resolveOperatorCli
};
