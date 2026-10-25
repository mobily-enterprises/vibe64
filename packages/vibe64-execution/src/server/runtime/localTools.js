import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { DEFAULT_SYSTEM_PATH } from "./resolveRuntimePath.js";

/**
 * Install lines for the tools a person supplies on their own computer, keyed
 * by the Stack runtime ids and the AI tool ids. Only lines for Debian/Ubuntu
 * (apt), macOS (Homebrew) and mise live here; every other way is behind the
 * tool's "Other ways" link. Each line was checked on CHECKED_ON.
 *
 * `run` lists the commands that prove the tool works: each group needs one
 * entry that runs `--version` (or the tool's own `version` argument).
 * Language runtimes install with mise, which needs no administrator password.
 */
const CHECKED_ON = "2026-10-23";
const SUDO_NOTE = "You'll be asked for your computer password. Nothing shows while you type.";
const MISE_INSTALL = "curl -fsSL https://mise.run | sh";
// The step-by-step guides for this computer, per operating system. Tools with
// a `setup` section link there; the rest link to their own project's page.
const SETUP_GUIDES = Object.freeze({
  linux: "https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/set-up-linux.md",
  darwin: "https://github.com/mobily-enterprises/vibe64/blob/main/docs/colleague-usage/set-up-macos.md"
});

const LOCAL_TOOLS = Object.freeze({
  claude: { name: "Claude Code", run: [["claude"]], guideUrl: "https://code.claude.com/docs/en/setup",
    any: "curl -fsSL https://claude.ai/install.sh | bash" },
  codex: { name: "Codex", run: [["codex"]], guideUrl: "https://github.com/openai/codex",
    any: "curl -fsSL https://chatgpt.com/codex/install.sh | sh" },
  opencode: { name: "opencode", run: [["opencode"]], guideUrl: "https://opencode.ai/docs/",
    any: "curl -fsSL https://opencode.ai/install | bash" },
  node: { name: "Node.js", setup: "nodejs-and-mise", run: [["node"]], guideUrl: "https://nodejs.org/en/download", mise: "node@26" },
  git: { name: "Git", setup: "git", run: [["git"]], guideUrl: "https://git-scm.com/downloads",
    apt: "sudo apt install git", brew: "xcode-select --install" },
  gh: { name: "GitHub CLI", setup: "extras", run: [["gh"]], guideUrl: "https://github.com/cli/cli#installation",
    mise: "gh", brew: "brew install gh" },
  ripgrep: { name: "ripgrep", setup: "extras", run: [["rg"]], guideUrl: "https://github.com/BurntSushi/ripgrep#installation",
    apt: "sudo apt install ripgrep", brew: "brew install ripgrep" },
  playwright: { name: "Playwright browser", guideUrl: "https://playwright.dev/docs/browsers",
    apt: "npx playwright install --with-deps chromium", brew: "npx playwright install chromium" },
  python: { name: "Python", setup: "project-languages", run: [["python3", "python"]], guideUrl: "https://mise.jdx.dev/lang/python.html",
    mise: "python@3.13" },
  ruby: { name: "Ruby", setup: "project-languages", run: [["ruby"]], guideUrl: "https://mise.jdx.dev/lang/ruby.html", mise: "ruby@3.4" },
  java: { name: "Java", setup: "project-languages", run: [["java"]], guideUrl: "https://mise.jdx.dev/lang/java.html", mise: "java@temurin-25",
    version: "-version" },
  go: { name: "Go", setup: "project-languages", run: [["go"]], guideUrl: "https://go.dev/doc/install", mise: "go", version: "version" },
  kotlin: { name: "Kotlin", run: [["kotlin"]], guideUrl: "https://kotlinlang.org/docs/command-line.html", mise: "kotlin",
    version: "-version" },
  rust: { name: "Rust", run: [["rustc"], ["cargo"]], guideUrl: "https://rustup.rs/",
    any: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" },
  bun: { name: "Bun", run: [["bun"]], guideUrl: "https://bun.sh/docs/installation", any: "curl -fsSL https://bun.sh/install | bash" },
  csharp: { name: ".NET", run: [["dotnet"]], guideUrl: "https://dotnet.microsoft.com/download" },
  php: { name: "PHP", setup: "project-languages", run: [["php"], ["composer"]], guideUrl: "https://php.new/",
    apt: "/bin/bash -c \"$(curl -fsSL https://php.new/install/linux)\"",
    brew: "/bin/bash -c \"$(curl -fsSL https://php.new/install/mac)\"" },
  cpp: { name: "Build tools", setup: "build-tools", run: [["cc", "gcc", "clang"], ["make"]], guideUrl: "https://guides.rubyonrails.org/install_ruby_on_rails.html",
    detail: "Some packages compile native code, so they need a compiler and a few libraries.",
    apt: "sudo apt install build-essential pkg-config libyaml-dev libssl-dev zlib1g-dev libpq-dev default-libmysqlclient-dev libgmp-dev",
    brew: "brew install pkg-config libyaml openssl@3 gmp" }
});

// Runtime ids that share another tool's line, and ids Vibe64 itself satisfies.
const LOCAL_TOOL_ALIASES = Object.freeze({ composer: "php" });
const SATISFIED_BY_VIBE64 = new Set(["node26", "nodejs", "operator-clis", "playwright-runtime", "bubblewrap"]);

function localToolId(id = "") {
  const value = String(id || "").trim();
  return LOCAL_TOOL_ALIASES[value] || value;
}

/** The tool ids worth a row for a list of Stack runtime ids, without duplicates. */
function localToolIds(runtimes = []) {
  return [...new Set((Array.isArray(runtimes) ? runtimes : []).map(localToolId))]
    .filter((id) => !SATISFIED_BY_VIBE64.has(id) && Object.hasOwn(LOCAL_TOOLS, id));
}

/** "apt" on Debian, Ubuntu and WSL, "brew" on macOS, otherwise "". */
function localToolFamily({ platform = process.platform, aptGet = false } = {}) {
  if (platform === "darwin") return "brew";
  return aptGet ? "apt" : "";
}

// Commands run with the system folders after the person's PATH, so apt-get is
// looked up the same way.
function aptGetOnPath(env = process.env, systemPath = DEFAULT_SYSTEM_PATH) {
  return [...String(env.PATH || "").split(path.delimiter), ...String(systemPath || "").split(path.delimiter)]
    .some((directory) => path.isAbsolute(directory) && existsSync(path.join(directory, "apt-get")));
}

/** This computer's install-line family: "apt", "brew" or "". */
function thisComputerToolFamily({ env = process.env, platform = process.platform, systemPath } = {}) {
  return localToolFamily({ platform, aptGet: platform !== "darwin" && aptGetOnPath(env, systemPath) });
}

/**
 * The one command to show for a tool on this computer, or null when only
 * "Other ways" can help. `mise` says whether mise already runs here.
 */
function localToolInstall(id = "", { family = "", mise = false, xcode = true } = {}) {
  const tool = LOCAL_TOOLS[localToolId(id)];
  if (!tool) return null;
  // Apple's command line tools come first: without them compilers, Git and Make are stubs.
  if (family === "brew" && !xcode && ["git", "cpp"].includes(localToolId(id))) {
    return { command: "xcode-select --install", sudo: false, note: "" };
  }
  let command = tool.any || tool[family] || "";
  if (!command && tool.mise) {
    command = mise ? `mise use -g ${tool.mise}` : `${MISE_INSTALL} && ~/.local/bin/mise use -g ${tool.mise}`;
  }
  if (!command) return null;
  const sudo = command.startsWith("sudo ") || (family === "apt" && command.includes("--with-deps"));
  return { command, sudo, note: sudo ? SUDO_NOTE : "" };
}

/** Where "Other ways" goes for a tool: this computer's setup guide when it covers the tool. */
function localToolGuideUrl(id = "", { platform = process.platform } = {}) {
  const tool = LOCAL_TOOLS[localToolId(id)];
  if (!tool) return "";
  if (!tool.setup) return tool.guideUrl;
  return `${SETUP_GUIDES[platform === "darwin" ? "darwin" : "linux"]}#${tool.setup}`;
}

export {
  CHECKED_ON,
  LOCAL_TOOLS,
  SUDO_NOTE,
  localToolFamily,
  localToolGuideUrl,
  localToolId,
  localToolIds,
  localToolInstall,
  thisComputerToolFamily
};
