import path from "node:path";

import {
  normalizeAbsolutePath,
  normalizeText
} from "../normalize.js";
import { vibe64Host } from "../hostProfile.js";

const RUNTIME_PACKS = Object.freeze({
  "awsebcli": {
    binDirs: ["awsebcli/bin"],
    managedCommands: ["eb"]
  },
  "bubblewrap": {
    binDirs: ["bubblewrap/bin"],
    managedCommands: []
  },
  "bun": {
    binDirs: ["bun/bin"],
    dependencyFiles: ["package.json", "bun.lock", "bun.lockb", "package-lock.json"],
    managedCommands: ["bun"]
  },
  "composer": {
    binDirs: ["composer/bin"],
    dependencyFiles: ["composer.json", "composer.lock"],
    managedCommands: ["composer"]
  },
  "cpp": {
    binDirs: ["cpp/bin"],
    dependencyFiles: ["CMakeLists.txt", "vcpkg.json", "vcpkg-configuration.json", "conanfile.py", "conan.lock"],
    managedCommands: [
      "addr2line",
      "ar",
      "as",
      "c++",
      "c++filt",
      "cc",
      "clang",
      "clang++",
      "cmake",
      "cpack",
      "cpp",
      "ctest",
      "g++",
      "gcc",
      "gcore",
      "gdb",
      "gdb-add-index",
      "gdbserver",
      "gprof",
      "gstack",
      "ld",
      "ld.bfd",
      "ld.gold",
      "ld.lld",
      "ld64.lld",
      "lld",
      "lld-link",
      "lldb",
      "lldb-dap",
      "lldb-server",
      "make",
      "ninja",
      "nm",
      "objcopy",
      "objdump",
      "pkg-config",
      "ranlib",
      "readelf",
      "size",
      "strings",
      "strip",
      "wasm-ld"
    ]
  },
  "python": {
    binDirs: ["python/bin"],
    dependencyFiles: ["pyproject.toml", "requirements.txt", "requirements.lock", "uv.lock", "poetry.lock", "Pipfile", "Pipfile.lock"],
    managedCommands: ["python", "python3", "pip", "pip3", "virtualenv"]
  },
  "ruby": {
    binDirs: ["ruby/bin"],
    dependencyFiles: ["Gemfile", "Gemfile.lock"],
    managedCommands: ["ruby", "gem", "rake", "irb", "erb", "ri", "rdoc", "bundle", "bundler"]
  },
  "go": {
    binDirs: ["go/bin"],
    dependencyFiles: ["go.mod", "go.sum", "go.work", "go.work.sum"],
    managedCommands: ["go", "gofmt"]
  },
  "java": {
    binDirs: ["java/bin"],
    dependencyFiles: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradle.properties"],
    managedCommands: ["java", "javac", "jar", "javap", "javadoc", "jshell", "jlink", "jmod", "jdeps", "jpackage", "jcmd", "jconsole", "jdb", "jfr", "jhsdb", "jinfo", "jmap", "jps", "jrunscript", "jstack", "jstat", "jstatd", "keytool", "rmiregistry", "serialver", "mvn", "mvnDebug", "gradle"]
  },
  "kotlin": {
    binDirs: ["kotlin/bin"],
    dependencyFiles: ["build.gradle.kts", "settings.gradle.kts", "gradle.properties"],
    managedCommands: ["kotlin", "kotlinc", "kotlinc-jvm", "kotlinc-js", "kapt"]
  },
  "csharp": {
    binDirs: ["csharp/bin"],
    dependencyFiles: ["global.json", "Directory.Build.props", "Directory.Packages.props", "packages.lock.json", "NuGet.Config"],
    managedCommands: ["dotnet"]
  },
  "rust": {
    binDirs: ["rust/bin"],
    dependencyFiles: ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml"],
    managedCommands: ["rustc", "rustdoc", "cargo", "rustfmt", "cargo-fmt", "clippy-driver", "cargo-clippy"]
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
    dependencyFiles: ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"],
    managedCommands: ["node", "npm", "npx", "corepack", "pnpm", "yarn"]
  },
  "operator-clis": {
    binDirs: ["managed-bin", "operator-clis/bin"],
    identityPaths: [
      "operator-clis/lib/node_modules/@anthropic-ai/claude-code/package.json",
      "operator-clis/lib/node_modules/@openai/codex/package.json",
      "operator-clis/lib/node_modules/opencode-ai/package.json"
    ],
    managedCommands: ["claude", "codex", "opencode"]
  },
  "php": {
    binDirs: ["php/bin"],
    managedCommands: ["php"]
  },
  "playwright": {
    binDirs: ["playwright/bin"],
    identityPaths: ["playwright/runtime.env", "playwright/browsers"],
    managedCommands: ["playwright"]
  },
  "postgresql": {
    binDirs: ["postgresql/bin"],
    managedCommands: ["initdb", "pg_ctl", "pg_isready", "postgres", "psql"]
  },
  "ripgrep": {
    binDirs: ["ripgrep/bin"],
    managedCommands: []
  },
  "sqlite": {
    binDirs: ["sqlite/bin"],
    managedCommands: ["sqlite3"]
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
  "sqlite",
  "ripgrep",
  "bubblewrap",
  "bun",
  "php",
  "composer",
  "awsebcli",
  "cpp",
  "python",
  "ruby",
  "go",
  "java",
  "kotlin",
  "csharp",
  "rust",
  "playwright"
]);

// "" when the host has no packs: commands then come from the person's PATH.
function runtimePackRoot({ root = "" } = {}) {
  return normalizeAbsolutePath(root || vibe64Host().runtimePackRoot);
}

function runtimePackBinPaths(runtime = "") {
  const root = runtimePackRoot();
  const entries = root ? RUNTIME_PACKS[normalizeText(runtime)]?.binDirs || [] : [];
  return entries.map((entry) => path.join(root, entry));
}

function runtimePackGuardBinPaths() {
  const root = runtimePackRoot();
  return root ? [path.join(root, "guard-bin")] : [];
}

function runtimePackPolicyBinPaths() {
  const root = runtimePackRoot();
  return root ? [path.join(root, "policy-bin")] : [];
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

export {
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  managedCommandRuntimeEntries,
  runtimePackBinPaths,
  runtimePackGuardBinPaths,
  runtimePackPolicyBinPaths,
  runtimePackManagedCommands,
  runtimePackRoot
};
