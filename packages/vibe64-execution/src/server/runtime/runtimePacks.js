import path from "node:path";

import {
  normalizeAbsolutePath,
  normalizeText
} from "../normalize.js";

const VIBE64_RUNTIME_PACK_ROOT_ENV = "VIBE64_RUNTIME_PACK_ROOT";
const DEFAULT_RUNTIME_PACK_ROOT = "/opt/vibe64/runtime-packs";

const RUNTIME_PACKS = Object.freeze({
  "bubblewrap": {
    binDirs: ["bubblewrap/bin"],
    managedCommands: []
  },
  "bun": {
    binDirs: ["bun/bin"],
    managedCommands: ["bun"]
  },
  "composer": {
    binDirs: ["composer/bin"],
    managedCommands: ["composer"]
  },
  "gh": {
    binDirs: ["gh/bin"],
    managedCommands: ["gh"]
  },
  "git": {
    binDirs: ["git/bin"],
    managedCommands: ["git"]
  },
  "mariadb": {
    binDirs: ["mariadb/bin"],
    managedCommands: ["mariadb", "mysql"]
  },
  "mysql": {
    binDirs: ["mariadb/bin"],
    managedCommands: ["mariadb", "mysql"]
  },
  "node26": {
    binDirs: ["node26/bin"],
    managedCommands: ["node", "npm", "npx", "corepack", "pnpm", "yarn"]
  },
  "operator-clis": {
    binDirs: ["managed-bin", "operator-clis/bin"],
    managedCommands: ["codex", "opencode"]
  },
  "php": {
    binDirs: ["php/bin"],
    managedCommands: ["php"]
  },
  "playwright": {
    binDirs: ["playwright/bin"],
    managedCommands: ["playwright"]
  },
  "postgresql": {
    binDirs: ["postgresql/bin"],
    managedCommands: ["initdb", "pg_ctl", "pg_isready", "postgres", "psql"]
  },
  "ripgrep": {
    binDirs: ["ripgrep/bin"],
    managedCommands: []
  }
});

const VIBE64_INTERACTIVE_RUNTIME_PACKS = Object.freeze([
  "operator-clis",
  "node26",
  "git",
  "gh",
  "mysql",
  "mariadb",
  "postgresql",
  "ripgrep",
  "bubblewrap",
  "bun",
  "php",
  "composer",
  "playwright"
]);

function runtimePackRoot({
  env = process.env,
  root = ""
} = {}) {
  return normalizeAbsolutePath(root || env?.[VIBE64_RUNTIME_PACK_ROOT_ENV] || DEFAULT_RUNTIME_PACK_ROOT);
}

function runtimePackBinPaths(runtime = "", options = {}) {
  const packName = normalizeText(runtime);
  const entries = RUNTIME_PACKS[packName]?.binDirs || [];
  const root = runtimePackRoot(options);
  return entries.map((entry) => path.join(root, entry));
}

function runtimePackGuardBinPath(options = {}) {
  return path.join(runtimePackRoot(options), "guard-bin");
}

function runtimePackPolicyBinPath(options = {}) {
  return path.join(runtimePackRoot(options), "policy-bin");
}

function runtimePackManagedCommands(runtime = "") {
  const packName = normalizeText(runtime);
  return [...(RUNTIME_PACKS[packName]?.managedCommands || [])];
}

function managedCommandRuntimeEntries() {
  const entries = new Map();
  for (const [runtime, pack] of Object.entries(RUNTIME_PACKS)) {
    for (const command of pack.managedCommands || []) {
      const runtimes = entries.get(command) || [];
      runtimes.push(runtime);
      entries.set(command, runtimes);
    }
  }
  return [...entries.entries()].map(([command, runtimes]) => ({
    command,
    runtimes
  }));
}

function managedCommandsForRuntimePacks() {
  return managedCommandRuntimeEntries().map((entry) => entry.command);
}

export {
  DEFAULT_RUNTIME_PACK_ROOT,
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  VIBE64_RUNTIME_PACK_ROOT_ENV,
  managedCommandRuntimeEntries,
  managedCommandsForRuntimePacks,
  runtimePackBinPaths,
  runtimePackGuardBinPath,
  runtimePackPolicyBinPath,
  runtimePackManagedCommands,
  runtimePackRoot
};
