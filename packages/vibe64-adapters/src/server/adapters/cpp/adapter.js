import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dockerCommand,
  hostUserDockerArgs,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";
import {
  buildDoctorToolchainArgs
} from "@local/setup-doctor-core/server/doctorToolchain";
import {
  targetRuntimeNetworkEnsureCommand
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  adapterProjectFacts
} from "../../adapter.js";
import {
  createAdapterBlueprintReader
} from "../../adapterBlueprints.js";
import {
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  Vibe64DescribedWorkflowTargetAdapter,
  inspectDescribedProject
} from "../../workflowAdapter.js";
import {
  DEFAULT_CODE_INDEX_RELATIVE_PATH
} from "../../codeIndexCommands.js";
import {
  studioCommandScript
} from "../../nodeWebProject.js";
import {
  CPP_CONFIG_FIELDS,
  CPP_DEFAULT_CONFIG,
  cppBuildTypeValue,
  cppStandardLabel,
  cppStandardNumber,
  selectedCppBuildSystem,
  selectedCppBuildType,
  selectedCppProjectKind,
  selectedCppStandard,
  selectedCppTesting
} from "./config.js";
import {
  CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH
} from "./constants.js";
import {
  cmakeBuildCommand,
  cmakeConfigureCommand,
  createCppTargetScriptTerminalSpec,
  ctestCommand,
  inspectCppCurrentApp,
  inspectCppTargetScripts
} from "./currentApp.js";
import {
  createCppSetupDoctorPlugin
} from "./setupDoctorPlugin.js";
import {
  buildManifestExists,
  cppProjectReady,
  detectCppBuildSystem,
  findCppFiles,
  markerExists,
  readCmakeProject,
  readMakeTargets
} from "./projectFiles.js";
import {
  CPP_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const CPP_BLUEPRINT_ROOT = fileURLToPath(new URL("./blueprints", import.meta.url));
const CPP_PROMPT_PACK_ROOT = fileURLToPath(new URL("./prompts", import.meta.url));
const blueprintFile = createAdapterBlueprintReader(CPP_BLUEPRINT_ROOT);

const CPP_MARKERS = deepFreeze([
  {
    id: "cmake_lists",
    label: "CMakeLists.txt",
    relativePath: "CMakeLists.txt"
  },
  {
    id: "makefile",
    label: "Makefile",
    relativePath: "Makefile"
  },
  {
    id: "gnumakefile",
    label: "GNUmakefile",
    relativePath: "GNUmakefile"
  },
  {
    id: "meson_build",
    label: "meson.build",
    relativePath: "meson.build"
  },
  {
    id: "vcpkg_manifest",
    label: "vcpkg.json",
    relativePath: "vcpkg.json"
  },
  {
    id: "conanfile_txt",
    label: "conanfile.txt",
    relativePath: "conanfile.txt"
  },
  {
    id: "conanfile_py",
    label: "conanfile.py",
    relativePath: "conanfile.py"
  },
  {
    id: "src",
    label: "src/",
    relativePath: "src"
  },
  {
    id: "include",
    label: "include/",
    relativePath: "include"
  },
  {
    id: "tests",
    label: "tests/",
    relativePath: "tests"
  }
]);

async function cppBlueprintSections(config = {}) {
  return [
    await blueprintFile("build-system", selectedCppBuildSystem(config)),
    await blueprintFile("standard", selectedCppStandard(config)),
    await blueprintFile("project-kind", selectedCppProjectKind(config)),
    await blueprintFile("testing", selectedCppTesting(config)),
    [
      "Local build profile",
      "",
      `Use ${cppBuildTypeValue(config)} for Studio-managed configure/build/test commands.`,
      "Keep generated build outputs under build/ and keep compile_commands.json enabled for tooling."
    ].join("\n")
  ];
}

async function cppEnvironmentBlueprint(config = {}) {
  return (await cppBlueprintSections(config))
    .map((section) => String(section || "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function dependencyManifestSummary(markers = []) {
  return [
    markerExists(markers, "vcpkg_manifest") ? "vcpkg.json" : "",
    markerExists(markers, "conanfile_txt") ? "conanfile.txt" : "",
    markerExists(markers, "conanfile_py") ? "conanfile.py" : ""
  ].filter(Boolean).join(", ");
}

function setupSummary({
  cppFiles = {},
  markers = []
} = {}) {
  if (cppProjectReady({
    cppFiles,
    markers
  })) {
    return "C++ project type selected.";
  }
  if (!buildManifestExists(markers)) {
    return "C++ project type selected. Missing build manifest.";
  }
  return "C++ project type selected. Missing C++ source or header files.";
}

async function cppPromptContext({
  cmakeProject = {},
  config = {},
  cppFiles = {},
  makeTargets = [],
  markers = [],
  targetRoot = ""
} = {}) {
  const knowledgePath = targetRoot
    ? path.join(targetRoot, CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH)
    : CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH;
  const detectedBuildSystem = detectCppBuildSystem(markers);
  const selectedBuildSystem = selectedCppBuildSystem(config);
  return {
    adapter: "cpp",
    automated_check_command: automatedChecksPreview({
      detectedBuildSystem,
      config,
      makeTargets
    }),
    build_system: selectedBuildSystem,
    build_type: selectedCppBuildType(config),
    build_type_cmake: cppBuildTypeValue(config),
    cmake_project_name: normalizeText(cmakeProject.projectName),
    cmake_targets: (cmakeProject.targets || []).map((target) => `${target.kind}:${target.name}`).join(", "),
    cpp_standard: cppStandardLabel(config),
    cpp_standard_number: cppStandardNumber(config),
    dependency_manifests: dependencyManifestSummary(markers),
    detected_build_system: detectedBuildSystem,
    environment_blueprint: await cppEnvironmentBlueprint(config),
    header_files: (cppFiles.headers || []).join(", "),
    make_targets: makeTargets.join(", "),
    project_kind: selectedCppProjectKind(config),
    project_knowledge_path: knowledgePath,
    project_knowledge_relative_path: CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH,
    source_files: (cppFiles.sources || []).join(", "),
    target_root: normalizeText(targetRoot),
    testing: selectedCppTesting(config),
    valid_cpp_markers: String(cppProjectReady({
      cppFiles,
      markers
    }))
  };
}

async function cppFacts({
  adapter = null,
  commands = [],
  cppFiles = {},
  markers = []
} = {}) {
  return adapterProjectFacts({
    capabilities: adapter?.workflowCapabilities() || {},
    commands,
    summary: setupSummary({
      cppFiles,
      markers
    })
  });
}

async function inspectCppProject(targetRoot) {
  return inspectDescribedProject(targetRoot, {
    extra: async ({ targetRoot: resolvedTargetRoot }) => {
      const [cmakeProject, cppFiles, makeTargets] = await Promise.all([
        readCmakeProject(resolvedTargetRoot),
        findCppFiles(resolvedTargetRoot),
        readMakeTargets(resolvedTargetRoot)
      ]);
      return {
        cmakeProject,
        cppFiles,
        makeTargets
      };
    },
    markers: CPP_MARKERS,
    packageJson: {
      defaultValue: null,
      invalidJsonCode: "vibe64_invalid_cpp_package_json",
      invalidJsonMessage: (filePath) => `Invalid JSON in optional C++ package file: ${filePath}`
    }
  });
}

function dockerToolchainScript(command = "", {
  targetRoot = ""
} = {}) {
  const dockerRun = dockerCommand(buildDoctorToolchainArgs(["bash", "-lc", command], {
    extraArgs: [
      ...hostUserDockerArgs(),
      "-e",
      "HOME=/tmp/studio-home"
    ],
    image: CPP_TOOLCHAIN_IMAGE,
    targetRoot
  }));
  return targetRoot
    ? `${targetRuntimeNetworkEnsureCommand(targetRoot)}\n${dockerRun}`
    : dockerRun;
}

function buildSystemCommand({
  cmake = "",
  make = "",
  meson = "",
  selected = "unknown"
} = {}) {
  if (selected === "cmake") {
    return cmake;
  }
  if (selected === "make") {
    return make;
  }
  if (selected === "meson") {
    return meson;
  }
  return "";
}

async function detectedBuildSystemForRoot(root = "", config = {}) {
  if (await pathExists(path.join(root, "CMakeLists.txt"))) {
    return "cmake";
  }
  if (await pathExists(path.join(root, "Makefile")) || await pathExists(path.join(root, "GNUmakefile"))) {
    return "make";
  }
  if (await pathExists(path.join(root, "meson.build"))) {
    return "meson";
  }
  return selectedCppBuildSystem(config);
}

function configureCommandForBuildSystem(buildSystem = "", config = {}) {
  return buildSystemCommand({
    cmake: cmakeConfigureCommand(config),
    make: "printf '[studio] Make projects do not require a separate configure step.\\n'",
    meson: "meson setup build || meson setup --reconfigure build",
    selected: buildSystem
  });
}

function automatedChecksPreview({
  config = {},
  detectedBuildSystem = "",
  makeTargets = []
} = {}) {
  const buildSystem = detectedBuildSystem === "unknown" ? selectedCppBuildSystem(config) : detectedBuildSystem;
  if (buildSystem === "make") {
    return makeTargets.includes("test")
      ? "make && make test"
      : "make";
  }
  if (buildSystem === "meson") {
    return [
      "meson setup build || meson setup --reconfigure build",
      "meson compile -C build",
      selectedCppTesting(config) === "enabled" ? "meson test -C build --print-errorlogs" : ""
    ].filter(Boolean).join(" && ");
  }
  return selectedCppTesting(config) === "enabled"
    ? `${cmakeConfigureCommand(config)} && ${cmakeBuildCommand()} && ${ctestCommand()}`
    : `${cmakeConfigureCommand(config)} && ${cmakeBuildCommand()}`;
}

async function automatedChecksCommandForRoot(root = "", config = {}) {
  const buildSystem = await detectedBuildSystemForRoot(root, config);
  if (buildSystem === "make") {
    const makeTargets = await readMakeTargets(root);
    return makeTargets.includes("test")
      ? "make && make test"
      : "make";
  }
  if (buildSystem === "meson") {
    return [
      "meson setup build || meson setup --reconfigure build",
      "meson compile -C build",
      selectedCppTesting(config) === "enabled" ? "meson test -C build --print-errorlogs" : ""
    ].filter(Boolean).join(" && ");
  }
  return [
    cmakeConfigureCommand(config),
    cmakeBuildCommand(),
    selectedCppTesting(config) === "enabled" ? ctestCommand() : ""
  ].filter(Boolean).join(" && ");
}

async function cppInstallWorkflowHook({
  context = {},
  worktreePath = ""
} = {}) {
  const config = context.config || {};
  const buildSystem = await detectedBuildSystemForRoot(worktreePath, config);
  const command = configureCommandForBuildSystem(buildSystem, config);
  const commandPreview = buildSystem === "make"
    ? "No separate dependency install step for Make projects"
    : command;
  return {
    command,
    commandPreview,
    metadata: {
      dependencies_build_system: buildSystem
    },
    script: studioCommandScript({
      command: dockerToolchainScript(command, {
        targetRoot: worktreePath
      }),
      commandPreview,
      intro: "Preparing C++ build directory."
    })
  };
}

async function cppAutomatedChecksHook({
  context = {},
  worktreePath = ""
} = {}) {
  const config = context.config || {};
  const command = await automatedChecksCommandForRoot(worktreePath, config);
  return {
    command,
    commandPreview: command,
    metadata: {
      automated_checks_build_system: await detectedBuildSystemForRoot(worktreePath, config)
    },
    script: studioCommandScript({
      command: dockerToolchainScript(command, {
        targetRoot: worktreePath
      }),
      commandPreview: command,
      intro: "Running C++ configure, build, and test checks."
    })
  };
}

function cppCodeIndexShellCommand() {
  return [
    "mkdir -p .vibe64",
    "{",
    "  printf '# C++ code index\\n\\n'",
    "  printf '## Build manifests\\n'",
    "  find . -maxdepth 2 \\( -name CMakeLists.txt -o -name Makefile -o -name GNUmakefile -o -name meson.build -o -name vcpkg.json -o -name conanfile.txt -o -name conanfile.py \\) -print | sort",
    "  printf '\\n## Headers and sources\\n'",
    "  for dir in src include tests test lib app; do",
    "    [ -d \"$dir\" ] || continue",
    "    find \"$dir\" -type f \\( -name '*.c' -o -name '*.cc' -o -name '*.cpp' -o -name '*.cxx' -o -name '*.h' -o -name '*.hh' -o -name '*.hpp' -o -name '*.hxx' \\) -print",
    "  done | sort",
    "  printf '\\n## CMake targets\\n'",
    "  if [ -f CMakeLists.txt ]; then",
    "    grep -En 'add_(executable|library)[[:space:]]*\\(' CMakeLists.txt cmake/*.cmake 2>/dev/null || true",
    "  fi",
    `} > ${shellQuote(DEFAULT_CODE_INDEX_RELATIVE_PATH)}`
  ].join("\n");
}

async function cppCodeIndexHook({
  worktreePath = ""
} = {}) {
  const command = cppCodeIndexShellCommand();
  const commandPreview = `bash # writes ${DEFAULT_CODE_INDEX_RELATIVE_PATH}`;
  return {
    command,
    commandPreview,
    metadata: {
      code_index_command_source: "cpp-indexer",
      code_index_path: DEFAULT_CODE_INDEX_RELATIVE_PATH
    },
    script: studioCommandScript({
      command: dockerToolchainScript(command, {
        targetRoot: worktreePath
      }),
      commandPreview,
      intro: "Updating C++ code index."
    })
  };
}

class CppTargetAdapter extends Vibe64DescribedWorkflowTargetAdapter {
  constructor({
    commandTerminalSpecFactory = null,
    commands = []
  } = {}) {
    super({
      commandTerminalSpecFactory,
      commands,
      configFields: CPP_CONFIG_FIELDS,
      currentAppInspector: inspectCppCurrentApp,
      defaultConfig: () => ({ ...CPP_DEFAULT_CONFIG }),
      id: "cpp",
      terminalToolchain: {
        image: CPP_TOOLCHAIN_IMAGE,
        label: "C++ toolchain"
      },
      label: "C++ target adapter",
      projectFacts: cppFacts,
      projectInspection: inspectCppProject,
      promptContext: cppPromptContext,
      promptPackRoot: CPP_PROMPT_PACK_ROOT,
      setupDoctorPlugins: (context) => [
        createCppSetupDoctorPlugin(context)
      ],
      targetScriptTerminalSpecFactory: createCppTargetScriptTerminalSpec,
      targetScriptsInspector: inspectCppTargetScripts,
      workflowCommandHooks: {
        automatedChecks: cppAutomatedChecksHook,
        installDependencies: cppInstallWorkflowHook,
        updateCodeIndex: cppCodeIndexHook
      }
    });
  }

  async worktreeArchiveExclusions() {
    return [
      "build",
      "cmake-build-*"
    ];
  }

  async sourceEditorPreloadDirectories() {
    return [
      "src",
      "include",
      "tests",
      "test"
    ];
  }

  async sourceEditorPreexpandedDirectories() {
    return [
      "src",
      "include"
    ];
  }
}

export {
  CPP_CONFIG_FIELDS,
  CPP_MARKERS,
  CPP_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  CPP_PROMPT_PACK_ROOT,
  CppTargetAdapter,
  cppEnvironmentBlueprint,
  cppPromptContext,
  inspectCppProject,
  setupSummary
};
