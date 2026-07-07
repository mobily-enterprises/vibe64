import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  vibe64Error
} from "./core.js";
import {
  deepFreeze
} from "./deepFreeze.js";

const VIBE64_RUNTIME_CATALOG_VERSION = "2026-07-06.v1";
const VIBE64_RUNTIME_LOCK_FILE = "runtime.lock.json";
const VIBE64_RUNTIME_LOCK_SCHEMA = "vibe64.runtime-lock";
const VIBE64_RUNTIME_LOCK_SCHEMA_VERSION = 1;
const VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX = "nix";
const VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM = "system";
const VIBE64_NIX_COMMAND = "nix";
const VIBE64_NIX_EXPERIMENTAL_FEATURES = "nix-command flakes";
const VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE_ENV = "VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE";
const VIBE64_NIXPKGS_PIN = deepFreeze({
  flakeRef: "github:NixOS/nixpkgs/50ab793786d9de88ee30ec4e4c24fb4236fc2674",
  id: "nixpkgs-24.11-20250630",
  lastModified: 1751274312,
  narHash: "sha256-/bVBlRpECLVzjV19t5KMdMFWSwKLtb5RyXdjz3LJT+g=",
  originalRef: "github:NixOS/nixpkgs/nixos-24.11",
  rev: "50ab793786d9de88ee30ec4e4c24fb4236fc2674"
});

const VIBE64_SHARED_RUNTIME_PACK_PACKAGE_IDS = deepFreeze(new Set([
  "bubblewrap",
  "composer",
  "git",
  "mysql-8.0",
  "nodejs-22",
  "php-8.3",
  "playwright",
  "ripgrep"
]));

const VIBE64_RUNTIME_CATALOG = deepFreeze({
  "nodejs-22": {
    family: "node",
    id: "nodejs-22",
    label: "Node.js 22",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "project-runtime",
    nix: {
      attr: "nodejs_22",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      corepack: {
        command: "corepack",
        expected: "Corepack from Node.js 22 is available.",
        label: "Corepack",
        versionArgs: ["--version"],
        versionPattern: "^\\d+\\."
      },
      node: {
        command: "node",
        expected: "Node.js 22 is available.",
        label: "Node.js",
        versionArgs: ["--version"],
        versionPattern: "^v22\\."
      },
      npm: {
        command: "npm",
        expected: "npm from Node.js 22 is available.",
        label: "npm",
        versionArgs: ["--version"],
        versionPattern: "^\\d+\\."
      }
    },
    version: "22.16.0"
  },
  "mysql-8.0": {
    family: "mysql",
    id: "mysql-8.0",
    label: "MySQL 8.0",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "runtime-service",
    nix: {
      attr: "mysql80",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      mysql: {
        command: "mysql",
        expected: "MySQL 8.0 client is available.",
        label: "MySQL client",
        versionArgs: ["--version"],
        versionPattern: "\\b8\\.0\\."
      },
      mysqld: {
        command: "mysqld",
        expected: "MySQL 8.0 server is available.",
        label: "MySQL server",
        versionArgs: ["--version"],
        versionPattern: "\\b8\\.0\\."
      }
    },
    version: "8.0.42"
  },
  "php-8.3": {
    family: "php",
    id: "php-8.3",
    label: "PHP 8.3",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "project-runtime",
    nix: {
      attr: "php83",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      php: {
        command: "php",
        expected: "PHP 8.3 is available.",
        label: "PHP",
        versionArgs: ["--version"],
        versionPattern: "^PHP 8\\.3\\."
      }
    },
    version: "8.3.22"
  },
  composer: {
    family: "composer",
    id: "composer",
    label: "Composer",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "project-runtime",
    nix: {
      attr: "php83Packages.composer",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      composer: {
        command: "composer",
        expected: "Composer is available.",
        label: "Composer",
        versionArgs: ["--version"],
        versionPattern: "\\b2\\.8\\."
      }
    },
    version: "2.8.5"
  },
  git: {
    family: "git",
    id: "git",
    label: "git",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "base-tool",
    nix: {
      attr: "git",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      git: {
        command: "git",
        expected: "git is available.",
        label: "git",
        versionArgs: ["--version"],
        versionPattern: "git version"
      }
    },
    version: "2.47.2"
  },
  gh: {
    family: "gh",
    id: "gh",
    label: "GitHub CLI",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "base-tool",
    nix: {
      attr: "gh",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      gh: {
        command: "gh",
        expected: "GitHub CLI is available.",
        label: "GitHub CLI",
        versionArgs: ["--version"],
        versionPattern: "gh version"
      }
    },
    version: "2.63.0"
  },
  ripgrep: {
    family: "ripgrep",
    id: "ripgrep",
    label: "ripgrep",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "base-tool",
    nix: {
      attr: "ripgrep",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      rg: {
        command: "rg",
        expected: "ripgrep is available.",
        label: "ripgrep",
        versionArgs: ["--version"],
        versionPattern: "ripgrep 14\\.1\\."
      }
    },
    version: "14.1.1"
  },
  bubblewrap: {
    family: "bubblewrap",
    id: "bubblewrap",
    label: "bubblewrap",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "base-tool",
    nix: {
      attr: "bubblewrap",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      bwrap: {
        command: "bwrap",
        expected: "bubblewrap is available.",
        label: "bubblewrap",
        versionArgs: ["--version"],
        versionPattern: "\\b0\\.11\\.0\\b"
      }
    },
    version: "0.11.0"
  },
  playwright: {
    family: "playwright",
    id: "playwright",
    label: "Playwright",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "base-tool",
    nix: {
      attr: "playwright",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      playwright: {
        command: "playwright",
        expected: "Playwright is available.",
        label: "Playwright",
        versionArgs: ["--version"],
        versionPattern: "Version 1\\.50\\."
      }
    },
    version: "1.50.0"
  },
  bun: {
    family: "bun",
    id: "bun",
    label: "Bun",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
    role: "project-runtime",
    nix: {
      attr: "bun",
      flakeRef: VIBE64_NIXPKGS_PIN.flakeRef,
      pin: VIBE64_NIXPKGS_PIN.id
    },
    tools: {
      bun: {
        command: "bun",
        expected: "Bun is available.",
        label: "Bun",
        versionArgs: ["--version"],
        versionPattern: "^1\\.1\\."
      }
    },
    version: "1.1.31"
  },
  codex: {
    family: "codex",
    id: "codex",
    label: "Codex CLI",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM,
    role: "base-tool",
    tools: {
      codex: {
        command: "codex",
        expected: "Codex CLI is installed on the host.",
        label: "Codex CLI",
        versionArgs: ["--version"],
        versionPattern: ".+"
      }
    }
  },
  opencode: {
    family: "opencode",
    id: "opencode",
    label: "opencode",
    provider: VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM,
    role: "base-tool",
    tools: {
      opencode: {
        command: "opencode",
        expected: "opencode is installed on the host.",
        label: "opencode",
        versionArgs: ["--version"],
        versionPattern: ".+"
      }
    }
  }
});

function normalizeRuntimePackageId(id = "") {
  return String(id || "").trim();
}

function runtimePackage(id = "") {
  return VIBE64_RUNTIME_CATALOG[normalizeRuntimePackageId(id)] || null;
}

function runtimePackages(ids = []) {
  return (Array.isArray(ids) ? ids : [])
    .map(runtimePackage)
    .filter(Boolean);
}

function listRuntimePackages({
  provider = "",
  role = ""
} = {}) {
  return Object.values(VIBE64_RUNTIME_CATALOG)
    .filter((entry) => !provider || entry.provider === provider)
    .filter((entry) => !role || entry.role === role);
}

function runtimePackageTool(packageId = "", toolId = "") {
  const entry = runtimePackage(packageId);
  if (!entry) {
    return null;
  }
  const normalizedToolId = String(toolId || "").trim();
  return entry.tools?.[normalizedToolId] || null;
}

function runtimePackageDefaultTool(packageId = "") {
  const entry = runtimePackage(packageId);
  if (!entry) {
    return null;
  }
  const [tool] = Object.values(entry.tools || {});
  return tool || null;
}

function runtimePackageInstallable(entry = {}) {
  if (entry?.provider !== VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX || !entry?.nix?.attr) {
    return "";
  }
  return `${entry.nix.flakeRef || VIBE64_NIXPKGS_PIN.flakeRef}#${entry.nix.attr}`;
}

function nixShellArgs(packageIds = [], commandArgs = []) {
  const installables = runtimePackages(packageIds)
    .filter((entry) => entry.provider === VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX)
    .map(runtimePackageInstallable)
    .filter(Boolean);
  return [
    "--extra-experimental-features",
    VIBE64_NIX_EXPERIMENTAL_FEATURES,
    "shell",
    ...installables,
    "-c",
    ...commandArgs.map((arg) => String(arg))
  ];
}

function runtimeShellCommandArgs(packageIds = [], script = "", options = {}) {
  if (sharedRuntimePacksCoverPackageIds(packageIds) && sharedRuntimePacksPreferred(options)) {
    return [
      "bash",
      "-lc",
      String(script || "")
    ];
  }
  return [
    VIBE64_NIX_COMMAND,
    ...nixShellArgs(packageIds, [
      "bash",
      "-lc",
      String(script || "")
    ])
  ];
}

function runtimeLockNixPackageIds(lock = {}, {
  includeServices = true
} = {}) {
  const records = [
    ...(Array.isArray(lock?.selected?.tools) ? lock.selected.tools : []),
    ...(includeServices && Array.isArray(lock?.selected?.services) ? lock.selected.services : [])
  ];
  return records
    .filter((entry) => entry?.provider === VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX)
    .map((entry) => String(entry?.id || "").trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function runtimeLockShellCommandArgs(lock = {}, script = "", options = {}) {
  return runtimeShellCommandArgs(runtimeLockNixPackageIds(lock, options), script, options);
}

function runtimeToolCommandArgs(packageId = "", toolId = "", options = {}) {
  const entry = runtimePackage(packageId);
  const tool = runtimePackageTool(packageId, toolId) || runtimePackageDefaultTool(packageId);
  if (!entry || !tool) {
    return [];
  }
  const commandArgs = [
    tool.command,
    ...(Array.isArray(tool.versionArgs) ? tool.versionArgs : [])
  ];
  if (entry.provider === VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX) {
    if (sharedRuntimePacksCoverPackageIds([entry.id]) && sharedRuntimePacksPreferred(options)) {
      return commandArgs;
    }
    return [
      VIBE64_NIX_COMMAND,
      ...nixShellArgs([entry.id], commandArgs)
    ];
  }
  return commandArgs;
}

function sharedRuntimePacksPreferred(options = {}) {
  if (options.preferSharedRuntimePacks !== undefined) {
    return options.preferSharedRuntimePacks === true;
  }
  return ["1", "true", "yes"].includes(String(process.env[VIBE64_SKIP_BASE_TOOLCHAIN_REALIZE_ENV] || "").trim().toLowerCase());
}

function sharedRuntimePacksCoverPackageIds(packageIds = []) {
  const normalizedPackageIds = (Array.isArray(packageIds) ? packageIds : [])
    .map(normalizeRuntimePackageId)
    .filter(Boolean);
  const packages = runtimePackages(normalizedPackageIds);
  if (packages.length !== normalizedPackageIds.length) {
    return false;
  }
  return packages
    .filter((entry) => entry.provider === VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX)
    .every((entry) => VIBE64_SHARED_RUNTIME_PACK_PACKAGE_IDS.has(entry.id));
}

function runtimeToolVersionPattern(packageId = "", toolId = "") {
  const tool = runtimePackageTool(packageId, toolId) || runtimePackageDefaultTool(packageId);
  return String(tool?.versionPattern || "");
}

function runtimeToolVersionMatches(output = "", packageId = "", toolId = "") {
  const pattern = runtimeToolVersionPattern(packageId, toolId);
  if (!pattern) {
    return String(output || "").trim().length > 0;
  }
  return new RegExp(pattern, "iu").test(String(output || ""));
}

function runtimeRequirement(packageId = "", {
  tool = ""
} = {}) {
  const entry = runtimePackage(packageId);
  if (!entry) {
    return null;
  }
  const selectedTool = runtimePackageTool(packageId, tool) || runtimePackageDefaultTool(packageId);
  return {
    expected: selectedTool?.expected || `${entry.label} is available.`,
    id: entry.id,
    label: selectedTool?.label || entry.label,
    package: entry,
    tool: selectedTool || null
  };
}

function stablePlainValue(value) {
  if (Array.isArray(value)) {
    return value.map(stablePlainValue);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => [key, stablePlainValue(entryValue)]));
}

function stableRuntimeJson(value) {
  return `${JSON.stringify(stablePlainValue(value), null, 2)}\n`;
}

function runtimeLockPath({
  projectSharedRoot = ""
} = {}) {
  const normalizedRoot = String(projectSharedRoot || "").trim();
  if (!normalizedRoot) {
    throw vibe64Error("Runtime lock requires projectSharedRoot.", "vibe64_runtime_lock_root_required");
  }
  return path.join(path.resolve(normalizedRoot), VIBE64_RUNTIME_LOCK_FILE);
}

function runtimeToolIdForEntry(entry = {}, tool = null) {
  if (!tool) {
    return Object.keys(entry.tools || {}).sort()[0] || "";
  }
  const match = Object.entries(entry.tools || {})
    .find(([, candidate]) => candidate === tool || candidate.command === tool.command);
  return match?.[0] || Object.keys(entry.tools || {}).sort()[0] || "";
}

function runtimeLockCommands(entry = {}) {
  return Object.fromEntries(Object.entries(entry.tools || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([toolId, tool]) => [toolId, {
      command: tool.command,
      expected: tool.expected,
      label: tool.label,
      versionArgs: Array.isArray(tool.versionArgs) ? tool.versionArgs : [],
      versionPattern: tool.versionPattern
    }]));
}

function runtimeLockPackageRecord(requirement = {}) {
  const packageId = normalizeRuntimePackageId(requirement.id);
  const entry = runtimePackage(packageId);
  if (!entry) {
    throw vibe64Error(`Unsupported Vibe64 runtime package: ${packageId || "(empty)"}.`, "vibe64_runtime_package_unsupported");
  }
  const selectedTool = runtimeToolIdForEntry(entry, requirement.tool);
  const record = {
    commands: runtimeLockCommands(entry),
    family: entry.family || entry.id,
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    role: entry.role,
    selectedTool,
    version: entry.version || ""
  };
  if (entry.provider === VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX) {
    record.nix = {
      attr: entry.nix.attr,
      flakeRef: entry.nix.flakeRef || VIBE64_NIXPKGS_PIN.flakeRef,
      narHash: VIBE64_NIXPKGS_PIN.narHash,
      nixpkgsPin: entry.nix.pin || VIBE64_NIXPKGS_PIN.id,
      originalRef: VIBE64_NIXPKGS_PIN.originalRef,
      rev: VIBE64_NIXPKGS_PIN.rev
    };
  }
  return stablePlainValue(record);
}

function normalizeRuntimeRequirementList(runtimeRequirements = []) {
  const requirements = Array.isArray(runtimeRequirements) ? runtimeRequirements : [];
  const records = requirements.map(runtimeLockPackageRecord);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw vibe64Error(`Duplicate Vibe64 runtime requirement: ${record.id}.`, "vibe64_runtime_requirement_duplicate");
    }
    seen.add(record.id);
  }
  return records.sort((left, right) => {
    const roleComparison = String(left.role || "").localeCompare(String(right.role || ""));
    return roleComparison || String(left.id || "").localeCompare(String(right.id || ""));
  });
}

function buildRuntimeLock({
  adapterId = "",
  createdAt = "",
  projectType = "",
  runtimeRequirements = []
} = {}) {
  const packages = normalizeRuntimeRequirementList(runtimeRequirements);
  const tools = packages.filter((entry) => entry.role !== "runtime-service");
  const services = packages.filter((entry) => entry.role === "runtime-service");
  return stablePlainValue({
    adapter: {
      id: String(adapterId || "").trim()
    },
    catalog: {
      nixpkgs: VIBE64_NIXPKGS_PIN,
      version: VIBE64_RUNTIME_CATALOG_VERSION
    },
    createdAt: String(createdAt || new Date().toISOString()),
    project: {
      projectType: String(projectType || "").trim()
    },
    schema: VIBE64_RUNTIME_LOCK_SCHEMA,
    schemaVersion: VIBE64_RUNTIME_LOCK_SCHEMA_VERSION,
    selected: {
      services,
      tools
    }
  });
}

function runtimeLockPackageIds(lock = {}) {
  return [
    ...(Array.isArray(lock?.selected?.tools) ? lock.selected.tools : []),
    ...(Array.isArray(lock?.selected?.services) ? lock.selected.services : [])
  ].map((entry) => String(entry?.id || "").trim()).filter(Boolean).sort((left, right) => left.localeCompare(right));
}

function validateRuntimeLock(lock = {}, {
  adapterId = "",
  projectType = "",
  runtimeRequirements = []
} = {}) {
  if (!isPlainObject(lock)) {
    return {
      error: "Runtime lock is not a JSON object.",
      ok: false
    };
  }
  if (lock.schema !== VIBE64_RUNTIME_LOCK_SCHEMA || lock.schemaVersion !== VIBE64_RUNTIME_LOCK_SCHEMA_VERSION) {
    return {
      error: "Runtime lock schema is not supported by this Vibe64 version.",
      ok: false
    };
  }
  const expected = buildRuntimeLock({
    adapterId,
    createdAt: lock.createdAt,
    projectType,
    runtimeRequirements
  });
  const actualJson = stableRuntimeJson(lock);
  const expectedJson = stableRuntimeJson(expected);
  if (actualJson !== expectedJson) {
    return {
      error: "Runtime lock does not match the current Vibe64 catalog, adapter, or project config.",
      expectedPackageIds: runtimeLockPackageIds(expected),
      observedPackageIds: runtimeLockPackageIds(lock),
      ok: false
    };
  }
  return {
    expectedPackageIds: runtimeLockPackageIds(expected),
    ok: true
  };
}

async function readRuntimeLock({
  projectSharedRoot = ""
} = {}) {
  const filePath = runtimeLockPath({
    projectSharedRoot
  });
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

async function writeRuntimeLock({
  lock = {},
  projectSharedRoot = ""
} = {}) {
  const filePath = runtimeLockPath({
    projectSharedRoot
  });
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const normalizedLock = stablePlainValue(lock);
  await writeFile(filePath, stableRuntimeJson(normalizedLock), "utf8");
  return normalizedLock;
}

export {
  VIBE64_NIX_COMMAND,
  VIBE64_NIX_EXPERIMENTAL_FEATURES,
  VIBE64_NIXPKGS_PIN,
  VIBE64_RUNTIME_CATALOG_VERSION,
  VIBE64_RUNTIME_CATALOG,
  VIBE64_RUNTIME_LOCK_FILE,
  VIBE64_RUNTIME_LOCK_SCHEMA,
  VIBE64_RUNTIME_LOCK_SCHEMA_VERSION,
  VIBE64_RUNTIME_PACKAGE_PROVIDER_NIX,
  VIBE64_RUNTIME_PACKAGE_PROVIDER_SYSTEM,
  buildRuntimeLock,
  listRuntimePackages,
  nixShellArgs,
  normalizeRuntimePackageId,
  readRuntimeLock,
  runtimePackage,
  runtimePackageDefaultTool,
  runtimePackageInstallable,
  runtimeLockPackageIds,
  runtimeLockNixPackageIds,
  runtimeLockPath,
  runtimeLockShellCommandArgs,
  runtimePackageTool,
  runtimePackages,
  runtimeRequirement,
  runtimeShellCommandArgs,
  runtimeToolCommandArgs,
  runtimeToolVersionMatches,
  runtimeToolVersionPattern,
  stableRuntimeJson,
  validateRuntimeLock,
  writeRuntimeLock
};
