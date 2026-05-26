import {
  normalizeText
} from "@local/ai-studio-core/server/core";
import { deepFreeze } from "@local/ai-studio-core/server/deepFreeze";

const DEFAULT_NODE_PACKAGE_MANAGER = "npm";
const NODE_PACKAGE_MANAGER_VALUES = deepFreeze(["npm", "pnpm", "yarn", "bun"]);
const NODE_PACKAGE_MANAGER_LABELS = deepFreeze({
  bun: "Bun",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn"
});
const NODE_PACKAGE_MANAGER_DESCRIPTIONS = deepFreeze({
  bun: "Use Bun when the project already uses Bun lockfiles or scripts.",
  npm: "Use npm, the default Node package manager included with Node.js.",
  pnpm: "Use pnpm when the project expects pnpm workspaces or a pnpm lockfile.",
  yarn: "Use Yarn when the project is built around Yarn commands or a yarn.lock file."
});
const NODE_PACKAGE_MANAGER_OPTIONS = deepFreeze(NODE_PACKAGE_MANAGER_VALUES.map((value) => ({
  description: NODE_PACKAGE_MANAGER_DESCRIPTIONS[value],
  label: NODE_PACKAGE_MANAGER_LABELS[value],
  value
})));
const NODE_PACKAGE_MANAGER_LOOKUP = new Set(NODE_PACKAGE_MANAGER_VALUES);

function isSupportedNodePackageManager(value = "") {
  return NODE_PACKAGE_MANAGER_LOOKUP.has(normalizeText(value).toLowerCase());
}

function nodePackageManagerValueSet() {
  return new Set(NODE_PACKAGE_MANAGER_VALUES);
}

function normalizeNodePackageManager(value = "", fallback = "") {
  const name = normalizeText(value).toLowerCase();
  return isSupportedNodePackageManager(name) ? name : fallback;
}

function normalizeNodePackageManagerSpec(value = "", fallback = "") {
  const normalized = normalizeText(value).toLowerCase();
  const candidate = normalized.split("@")[0].split(" ")[0].split("/")[0];
  return normalizeNodePackageManager(candidate, fallback);
}

function nodePackageManagerDisplayName(value = DEFAULT_NODE_PACKAGE_MANAGER) {
  const name = normalizeNodePackageManager(value, DEFAULT_NODE_PACKAGE_MANAGER);
  return NODE_PACKAGE_MANAGER_LABELS[name];
}

export {
  DEFAULT_NODE_PACKAGE_MANAGER,
  NODE_PACKAGE_MANAGER_OPTIONS,
  NODE_PACKAGE_MANAGER_VALUES,
  isSupportedNodePackageManager,
  nodePackageManagerDisplayName,
  nodePackageManagerValueSet,
  normalizeNodePackageManager,
  normalizeNodePackageManagerSpec
};
