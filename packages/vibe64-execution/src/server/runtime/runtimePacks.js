import path from "node:path";

import {
  normalizeAbsolutePath,
  normalizeText
} from "../normalize.js";

const VIBE64_RUNTIME_PACK_ROOT_ENV = "VIBE64_RUNTIME_PACK_ROOT";
const DEFAULT_RUNTIME_PACK_ROOT = "/opt/vibe64/runtime-packs";

const RUNTIME_PACKS = Object.freeze({
  "bubblewrap": ["bubblewrap/bin"],
  "bun": ["bun/bin"],
  "composer": ["composer/bin"],
  "gh": ["gh/bin"],
  "git": ["git/bin"],
  "mariadb": ["mariadb/bin"],
  "mysql": ["mariadb/bin"],
  "node20": ["node20/bin"],
  "node22": ["node22/bin"],
  "operator-clis": ["managed-bin", "operator-clis/bin"],
  "php": ["php/bin"],
  "playwright": ["playwright/bin"],
  "ripgrep": ["ripgrep/bin"]
});

const VIBE64_INTERACTIVE_RUNTIME_PACKS = Object.freeze([
  "operator-clis",
  "node22",
  "node20",
  "git",
  "gh",
  "mysql",
  "mariadb",
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
  const entries = RUNTIME_PACKS[packName] || [];
  const root = runtimePackRoot(options);
  return entries.map((entry) => path.join(root, entry));
}

export {
  DEFAULT_RUNTIME_PACK_ROOT,
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  VIBE64_RUNTIME_PACK_ROOT_ENV,
  runtimePackBinPaths,
  runtimePackRoot
};
