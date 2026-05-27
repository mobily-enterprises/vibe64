import path from "node:path";
import process from "node:process";

import {
  pathExists
} from "@local/vibe64-core/server/core";
import {
  inspectDescribedCurrentApp
} from "../../currentAppInspection.js";
import {
  createVibe64TargetScriptTerminalSpec,
  targetScriptError
} from "@local/studio-terminal-core/server/targetScriptTerminal";
import {
  cppBuildTypeValue,
  cppStandardNumber
} from "./config.js";
import {
  detectCppBuildSystem,
  findCppFiles,
  readCmakeProject,
  readMakeTargets
} from "./projectFiles.js";
import {
  CPP_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "cmake:configure",
  "cmake:build",
  "ctest",
  "make",
  "make:test",
  "meson:compile",
  "meson:test"
]);

const CPP_CURRENT_APP_MARKERS = Object.freeze([
  { id: "cmakeLists", label: "CMakeLists.txt", relativePath: "CMakeLists.txt", kind: "file" },
  { id: "makefile", label: "Makefile", relativePath: "Makefile", kind: "file" },
  { id: "gnumakefile", label: "GNUmakefile", relativePath: "GNUmakefile", kind: "file" },
  { id: "mesonBuild", label: "meson.build", relativePath: "meson.build", kind: "file" },
  { id: "vcpkgManifest", label: "vcpkg.json", relativePath: "vcpkg.json", kind: "file" },
  { id: "conanfileText", label: "conanfile.txt", relativePath: "conanfile.txt", kind: "file" },
  { id: "conanfilePy", label: "conanfile.py", relativePath: "conanfile.py", kind: "file" }
]);

const CPP_PROJECT_DIRECTORIES = Object.freeze([
  { id: "src", label: "src", relativePath: "src" },
  { id: "include", label: "include", relativePath: "include" },
  { id: "tests", label: "tests", relativePath: "tests" },
  { id: "cmake", label: "cmake", relativePath: "cmake" },
  { id: "build", label: "build", relativePath: "build" }
]);

function currentAppBuildSystemFromMarkers(markers = []) {
  const normalizedMarkers = markers.map((marker) => ({
    ...marker,
    id: {
      cmakeLists: "cmake_lists",
      gnumakefile: "gnumakefile",
      makefile: "makefile",
      mesonBuild: "meson_build"
    }[marker.id] || marker.id
  }));
  return detectCppBuildSystem(normalizedMarkers);
}

function cppMarkersReady(markers = []) {
  return currentAppBuildSystemFromMarkers(markers) !== "unknown";
}

function cmakeConfigureCommand(config = {}) {
  return [
    "cmake -S . -B build -G Ninja",
    `-DCMAKE_BUILD_TYPE=${cppBuildTypeValue(config)}`,
    `-DCMAKE_CXX_STANDARD=${cppStandardNumber(config)}`,
    "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"
  ].join(" ");
}

function cmakeBuildCommand() {
  return "cmake --build build";
}

function ctestCommand() {
  return "ctest --test-dir build --output-on-failure";
}

function scriptEntry(name = "", command = "", {
  starredByDefault = DEFAULT_TARGET_SCRIPT_NAMES.includes(name)
} = {}) {
  return {
    command,
    id: `adapter:${name}`,
    label: name,
    name,
    source: "adapter",
    starredByDefault
  };
}

function cmakeRunScriptEntries(targets = []) {
  return targets
    .filter((target) => target.kind === "executable")
    .slice(0, 8)
    .map((target) => scriptEntry(`run:${target.name}`, `./build/${target.name}`, {
      starredByDefault: false
    }));
}

async function cmakeScriptEntries(appRoot, config = {}) {
  const cmakeProject = await readCmakeProject(appRoot);
  return [
    scriptEntry("cmake:configure", cmakeConfigureCommand(config)),
    scriptEntry("cmake:build", cmakeBuildCommand()),
    scriptEntry("ctest", ctestCommand()),
    scriptEntry("cmake:clean", "rm -rf build", {
      starredByDefault: false
    }),
    ...cmakeRunScriptEntries(cmakeProject.targets)
  ];
}

async function makeScriptEntries(appRoot) {
  const targets = await readMakeTargets(appRoot);
  const entries = [
    scriptEntry("make", "make"),
    targets.includes("test") ? scriptEntry("make:test", "make test") : null,
    targets.includes("check") ? scriptEntry("make:check", "make check") : null,
    targets.includes("clean") ? scriptEntry("make:clean", "make clean", {
      starredByDefault: false
    }) : null
  ].filter(Boolean);
  for (const target of targets.filter((name) => !["all", "check", "clean", "test"].includes(name)).slice(0, 8)) {
    entries.push(scriptEntry(`make:${target}`, `make ${target}`, {
      starredByDefault: false
    }));
  }
  return entries;
}

function mesonScriptEntries(config = {}) {
  const buildType = cppBuildTypeValue(config) === "Debug" ? "debug" : "debugoptimized";
  return [
    scriptEntry("meson:setup", `meson setup build --buildtype=${buildType}`),
    scriptEntry("meson:compile", "meson compile -C build"),
    scriptEntry("meson:test", "meson test -C build --print-errorlogs"),
    scriptEntry("meson:clean", "rm -rf build", {
      starredByDefault: false
    })
  ];
}

async function readCppTargetScripts(appRoot, config = {}) {
  const [cmakeExists, makefileExists, gnumakefileExists, mesonExists] = await Promise.all([
    pathExists(path.join(appRoot, "CMakeLists.txt")),
    pathExists(path.join(appRoot, "Makefile")),
    pathExists(path.join(appRoot, "GNUmakefile")),
    pathExists(path.join(appRoot, "meson.build"))
  ]);
  if (cmakeExists) {
    return {
      ok: true,
      scripts: await cmakeScriptEntries(appRoot, config)
    };
  }
  if (makefileExists || gnumakefileExists) {
    return {
      ok: true,
      scripts: await makeScriptEntries(appRoot)
    };
  }
  if (mesonExists) {
    return {
      ok: true,
      scripts: mesonScriptEntries(config)
    };
  }
  return targetScriptError("cpp_manifest_missing", `Cannot find a C++ build manifest in ${appRoot}.`, {
    scripts: []
  });
}

async function inspectConfig(appRoot, {
  markers = []
} = {}) {
  const [cmakeProject, cppFiles, makeTargets] = await Promise.all([
    readCmakeProject(appRoot),
    findCppFiles(appRoot),
    readMakeTargets(appRoot)
  ]);
  return {
    buildSystem: currentAppBuildSystemFromMarkers(markers),
    cmakeProjectName: cmakeProject.projectName,
    cmakeTargets: cmakeProject.targets,
    headerFiles: cppFiles.headers,
    makeTargets,
    sourceFiles: cppFiles.sources
  };
}

async function inspectCppCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter: "cpp",
    appPath: "/",
    config: inspectConfig,
    directories: CPP_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const cmakeProject = await readCmakeProject(appRoot);
      return {
        appPackageName: cmakeProject.projectName,
        packages: cmakeProject.targets.map((target) => target.name)
      };
    },
    markers: CPP_CURRENT_APP_MARKERS,
    ready: cppMarkersReady
  });
}

async function inspectCppTargetScripts(appRoot, {
  config = {}
} = {}) {
  const result = await readCppTargetScripts(path.resolve(appRoot || process.cwd()), config);
  if (result.ok === false) {
    return result;
  }
  const scripts = result.scripts.sort((left, right) => left.name.localeCompare(right.name));
  return {
    ok: true,
    scriptCount: scripts.length,
    scripts
  };
}

async function createCppTargetScriptTerminalSpec(targetRoot, input = {}, {
  config = {}
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readCppTargetScripts(normalizedTargetRoot, config);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  return createVibe64TargetScriptTerminalSpec({
    adapterId: "cpp",
    image: CPP_TOOLCHAIN_IMAGE,
    input,
    scripts: scriptsResult.scripts,
    targetRoot: normalizedTargetRoot
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  cmakeBuildCommand,
  cmakeConfigureCommand,
  createCppTargetScriptTerminalSpec,
  ctestCommand,
  inspectCppCurrentApp,
  inspectCppTargetScripts
};
