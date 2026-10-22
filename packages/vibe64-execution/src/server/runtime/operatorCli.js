import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { runtimePackRoot } from "./runtimePacks.js";

// Official one-line installers, checked 2026-10-22: a macOS/Linux shell line
// and a Windows PowerShell line (opencode publishes no PowerShell installer,
// so Windows uses its official npm package). Only someone using their own
// tools is shown them; a host with runtime packs installs its own.
const OPERATOR_CLIS = Object.freeze({
  claude: Object.freeze({ name: "Claude Code", provider: "Claude", guideUrl: "https://code.claude.com/docs/en/setup",
    install: Object.freeze({ unix: "curl -fsSL https://claude.ai/install.sh | bash", win32: "irm https://claude.ai/install.ps1 | iex" }) }),
  codex: Object.freeze({ name: "Codex", provider: "ChatGPT", guideUrl: "https://github.com/openai/codex",
    install: Object.freeze({ unix: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      win32: "powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"" }) }),
  opencode: Object.freeze({ name: "opencode", provider: "your API-key providers", guideUrl: "https://opencode.ai/docs/",
    install: Object.freeze({ unix: "curl -fsSL https://opencode.ai/install | bash", win32: "npm install -g opencode-ai" }) })
});

function executable(file = "") {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// PATH plus the official installers' own locations: a server started outside
// a login shell may lack these on PATH.
function operatorCliSearchDirs(env = process.env) {
  const home = String(env.HOME || os.homedir() || "");
  const homeDirs = home ? [".local/bin", ".claude/local", ".opencode/bin"].map((dir) => path.join(home, dir)) : [];
  const dirs = [...String(env.PATH || "").split(path.delimiter), ...homeDirs, "/opt/homebrew/bin", "/usr/local/bin"]
    .filter((dir) => path.isAbsolute(dir));
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
  // An override with a path is used as given; a bare name is looked up like the tool itself.
  if (override.includes(path.sep)) return { command: override, installed: executable(override), searched: [override] };
  const searched = operatorCliSearchDirs(env);
  const found = searched.map((dir) => path.join(dir, override || tool)).find(executable);
  return { command: found || override || tool, installed: Boolean(found), searched };
}

/**
 * True when a person's own CLI could not be executed at all (126/127, or the
 * spawn itself failed), as opposed to running and reporting a problem. A host
 * with runtime packs installs its own CLIs, so its results are never read
 * this way.
 */
function operatorCliStartFailed(result = {}) {
  if (runtimePackRoot() || result?.ok === true) return false;
  return [126, 127].includes(result?.exitCode) || /\bspawn \S+ (?:ENOENT|EACCES)\b/u.test(String(result?.error || ""));
}

function operatorCliCommand(tool = "", options = {}) {
  return resolveOperatorCli(tool, options).command;
}

// The official install line for this server's operating system.
function operatorCliInstall(tool = "", platform = process.platform) {
  return OPERATOR_CLIS[tool].install[platform === "win32" ? "win32" : "unix"];
}

/**
 * Plain wording for a person's own CLI that is missing or did not start, with
 * the install line for the computer this server runs on (where the CLI runs,
 * whatever the browser's). A host with runtime packs always has its CLIs, so
 * this never applies there.
 */
function operatorCliProblem(tool = "", { installed = false, platform = process.platform } = {}) {
  const { name, provider, guideUrl } = OPERATOR_CLIS[tool];
  const install = operatorCliInstall(tool, platform);
  const problem = installed
    ? { code: "vibe64_cli_unavailable", status: "unavailable", title: `${name} didn't start`,
        detail: `${name} is installed but didn't start. Choose Check again; if it keeps failing, reinstall it.` }
    : { code: "vibe64_cli_not_installed", status: "not_installed", title: `${name} isn't installed on this computer`,
        detail: `Vibe64 uses it to work with ${provider}. Install it, then choose Check again.` };
  // `message` reads on its own; the install notice shows `title` above `detail`.
  return { ...problem, message: installed ? problem.detail : `${problem.title}. ${problem.detail}`,
    install: { command: install, guideUrl } };
}

export {
  OPERATOR_CLIS,
  operatorCliCommand,
  operatorCliInstall,
  operatorCliProblem,
  operatorCliStartFailed,
  resolveOperatorCli
};
