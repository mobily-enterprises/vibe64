import assert from "node:assert/strict";
import test from "node:test";

import {
  LARAVEL_CONFIG_FIELDS,
  selectedLaravelPackageManager
} from "@local/vibe64-adapters/server/adapters/laravel/config";
import {
  NEXTJS_PACKAGE_MANAGER_CONFIG
} from "@local/vibe64-adapters/server/adapters/nextjs/constants";
import {
  NEXTJS_CONFIG_FIELDS,
  selectedNextjsPackageManager
} from "@local/vibe64-adapters/server/adapters/nextjs/config";
import {
  normalizePackageManager,
  packageManagerDisplayName
} from "@local/vibe64-adapters/server/nodePackageDoctor";
import {
  NODE_PACKAGE_MANAGER_OPTIONS,
  nodePackageManagerDisplayName,
  normalizeNodePackageManager,
  normalizeNodePackageManagerSpec
} from "@local/vibe64-adapters/server/nodePackageManagers";

function configField(fields = [], id = "") {
  return fields.find((field) => field.id === id);
}

test("node package manager vocabulary exposes shared values, labels, and normalization", () => {
  assert.deepEqual(NODE_PACKAGE_MANAGER_OPTIONS, [
    {
      description: "Use npm, the default Node package manager included with Node.js.",
      label: "npm",
      value: "npm"
    },
    {
      description: "Use pnpm when the project expects pnpm workspaces or a pnpm lockfile.",
      label: "pnpm",
      value: "pnpm"
    },
    {
      description: "Use Yarn when the project is built around Yarn commands or a yarn.lock file.",
      label: "Yarn",
      value: "yarn"
    },
    {
      description: "Use Bun when the project already uses Bun lockfiles or scripts.",
      label: "Bun",
      value: "bun"
    }
  ]);
  assert.equal(normalizeNodePackageManager("YARN", "npm"), "yarn");
  assert.equal(normalizeNodePackageManager("pnpm@9", "npm"), "npm");
  assert.equal(normalizeNodePackageManagerSpec("pnpm@9.12.1"), "pnpm");
  assert.equal(normalizeNodePackageManagerSpec("unknown@1.0.0"), "");
  assert.equal(nodePackageManagerDisplayName("bun"), "Bun");
  assert.equal(nodePackageManagerDisplayName("unknown"), "npm");
});

test("node package doctor reuses shared package manager normalization and display names", () => {
  assert.equal(normalizePackageManager("BUN"), "bun");
  assert.equal(normalizePackageManager("bun@1.2.3"), "npm");
  assert.equal(packageManagerDisplayName("yarn"), "Yarn");
  assert.equal(packageManagerDisplayName("unknown"), "npm");
});

test("adapter package manager config fields derive from shared node package manager options", () => {
  assert.strictEqual(
    configField(NEXTJS_CONFIG_FIELDS, NEXTJS_PACKAGE_MANAGER_CONFIG).options,
    NODE_PACKAGE_MANAGER_OPTIONS
  );
  assert.equal(configField(LARAVEL_CONFIG_FIELDS, "laravel_package_manager"), undefined);
  assert.equal(selectedNextjsPackageManager({
    values: {
      [NEXTJS_PACKAGE_MANAGER_CONFIG]: "bun"
    }
  }), "bun");
  assert.equal(selectedLaravelPackageManager({
    values: {
      laravel_package_manager: "pnpm"
    }
  }), "npm");
  assert.equal(selectedNextjsPackageManager({
    values: {
      [NEXTJS_PACKAGE_MANAGER_CONFIG]: "bun@1.2.3"
    }
  }), "npm");
});
