import {
  blockedDoctorCheck as blockedCheck,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/ai-studio-core/server/doctorCheckItems";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  adapterToolchainBuildRepair,
  adapterToolchainBuildScript,
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
} from "../../adapterToolchains.js";
import {
  seedCppProjectCommandPreview,
  seedCppProjectScript
} from "./seedProject.js";
import {
  findCppFiles
} from "./projectFiles.js";
import {
  CPP_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const CPP_TOOLCHAIN_DOCKERFILE = "tooling/adapters/cpp/Dockerfile";
const CPP_TOOLCHAIN_CONTEXT = "tooling/adapters/cpp";

function cppToolchainBuildRepair() {
  return adapterToolchainBuildRepair({
    actionId: "build-cpp-toolchain",
    context: CPP_TOOLCHAIN_CONTEXT,
    dockerfile: CPP_TOOLCHAIN_DOCKERFILE,
    image: CPP_TOOLCHAIN_IMAGE,
    label: "Build C++ toolchain"
  });
}

function cppToolchainBuildTerminalScript() {
  return adapterToolchainBuildScript({
    context: CPP_TOOLCHAIN_CONTEXT,
    dockerfile: CPP_TOOLCHAIN_DOCKERFILE,
    image: CPP_TOOLCHAIN_IMAGE
  });
}

function seedCppProjectRepair(config = {}) {
  return {
    actionId: "terminal-seed-cpp-project",
    autoRun: true,
    commandPreview: seedCppProjectCommandPreview(config),
    kind: "terminal",
    label: "Create C++ project"
  };
}

async function checkCppBuildManifest(toolkit, targetRoot, context = {}) {
  const [cmakeLists, makefile, gnumakefile, mesonBuild] = await Promise.all([
    toolkit.targetFileExists("CMakeLists.txt", {
      targetRoot
    }),
    toolkit.targetFileExists("Makefile", {
      targetRoot
    }),
    toolkit.targetFileExists("GNUmakefile", {
      targetRoot
    }),
    toolkit.targetFileExists("meson.build", {
      targetRoot
    })
  ]);
  if (cmakeLists || makefile || gnumakefile || mesonBuild) {
    return passCheck({
      id: "cpp-build-manifest",
      label: "Build manifest",
      expected: "A C++ build manifest exists.",
      observed: cmakeLists
        ? "CMakeLists.txt"
        : makefile
          ? "Makefile"
          : gnumakefile
            ? "GNUmakefile"
            : "meson.build",
      explanation: "Studio can identify how to configure, build, and test this C++ target."
    });
  }
  const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "build");
  if (nonGitEntries.length) {
    return hardStopCheck({
      id: "cpp-build-manifest",
      label: "Build manifest",
      expected: "A C++ build manifest exists or the target has no app-owned files.",
      observed: `No C++ build manifest was found, but files exist:\n${nonGitEntries.join("\n")}`,
      explanation: "Studio will not generate a C++ starter over existing files because it cannot know their ownership."
    });
  }
  return blockedCheck({
    id: "cpp-build-manifest",
    label: "Build manifest",
    expected: "A C++ build manifest exists in the target project.",
    observed: "CMakeLists.txt, Makefile, GNUmakefile, and meson.build are missing.",
    explanation: "Seed a C++ project before installing dependencies or running workflow commands.",
    repair: seedCppProjectRepair(context.config || {})
  });
}

async function checkCppSources(targetRoot) {
  const cppFiles = await findCppFiles(targetRoot);
  if (cppFiles.all.length > 0) {
    return passCheck({
      id: "cpp-source-files",
      label: "C++ files",
      expected: "At least one C++ source or header file exists.",
      observed: cppFiles.all.slice(0, 12).join("\n"),
      explanation: "Studio can include project files in C++ prompts and code indexing."
    });
  }
  return failCheck({
    id: "cpp-source-files",
    label: "C++ files",
    expected: "At least one C++ source or header file exists.",
    observed: "No C++ source or header files were found.",
    explanation: "Add files under src/, include/, tests/, test/, lib/, or app/, or seed a starter project."
  });
}

function createToolchainCommandCheck(toolkit, {
  commandArgs = [],
  expected = "",
  id = "",
  label = ""
} = {}) {
  return toolkit.toolchainCommandCheck({
    commandArgs,
    expected: expected || `${label} runs inside the C++ toolchain.`,
    explanation: `C++ setup, build, target scripts, and automated checks require ${label}.`,
    id,
    image: CPP_TOOLCHAIN_IMAGE,
    label
  });
}

function cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
  commandArgs = [],
  expected = "",
  id = "",
  label = ""
} = {}) {
  return {
    expected,
    id,
    label,
    run: () => isToolchainReady()
      ? createToolchainCommandCheck(toolkit, {
          commandArgs,
          expected,
          id,
          label
        }).run(context)
      : missingAdapterToolchainCheck({
          buildRepair: cppToolchainBuildRepair(),
          expected,
          id,
          label
        })
  };
}

function cppToolchainCommandChecks(toolkit, context, isToolchainReady) {
  return [
    cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
      commandArgs: ["c++", "--version"],
      expected: "A C++ compiler runs inside the C++ toolchain.",
      id: "cpp-compiler-toolchain",
      label: "C++ compiler"
    }),
    cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
      commandArgs: ["cmake", "--version"],
      expected: "CMake runs inside the C++ toolchain.",
      id: "cpp-cmake-toolchain",
      label: "CMake"
    }),
    cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
      commandArgs: ["ninja", "--version"],
      expected: "Ninja runs inside the C++ toolchain.",
      id: "cpp-ninja-toolchain",
      label: "Ninja"
    }),
    cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
      commandArgs: ["make", "--version"],
      expected: "Make runs inside the C++ toolchain.",
      id: "cpp-make-toolchain",
      label: "Make"
    }),
    cppToolchainCommandCheckItem(toolkit, context, isToolchainReady, {
      commandArgs: ["meson", "--version"],
      expected: "Meson runs inside the C++ toolchain.",
      id: "cpp-meson-toolchain",
      label: "Meson"
    })
  ];
}

function createCppSetupDoctorPlugin({
  configEnvironment = {},
  runCommand,
  startTerminalSession,
  studioRoot = "",
  targetRoot = "",
  terminalNamespace = ""
} = {}) {
  const toolkit = createDoctorPluginToolkit({
    startTerminalSession,
    runCommand,
    studioRoot,
    targetRoot,
    terminalEnv: configEnvironment,
    terminalNamespace
  });
  const buildToolchainTerminal = toolkit.shellTerminalAction({
    actionId: "build-cpp-toolchain",
    autoRun: true,
    commandPreview: () => cppToolchainBuildRepair().commandPreview,
    cwd: studioRoot,
    label: "Build C++ toolchain",
    script: cppToolchainBuildTerminalScript
  });
  const seedProjectTerminal = toolkit.toolchainTerminalAction({
    actionId: "terminal-seed-cpp-project",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", seedCppProjectScript(context.config || {})],
    commandPreview: (context = {}) => seedCppProjectCommandPreview(context.config || {}),
    image: CPP_TOOLCHAIN_IMAGE,
    label: "Create C++ project",
    targetRoot: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot
  });

  return toolkit.plugin({
    id: "cpp-target-runtime",
    label: "C++ target runtime",
    checks(context = {}) {
      let toolchainReady = false;
      const checkTargetRoot = context.targetRoot || targetRoot;
      return [
        {
          expected: `${CPP_TOOLCHAIN_IMAGE} exists locally.`,
          id: "cpp-toolchain-image",
          label: "C++ toolchain image",
          run: async () => {
            const result = await checkAdapterToolchainImage(toolkit, {
              buildRepair: cppToolchainBuildRepair(),
              explanation: "Build the C++ adapter toolchain before running compiler, CMake, Make, Meson, target scripts, or workflow checks.",
              id: "cpp-toolchain-image",
              image: CPP_TOOLCHAIN_IMAGE,
              label: "C++ toolchain image"
            });
            toolchainReady = result.status === "pass";
            return result;
          }
        },
        ...cppToolchainCommandChecks(toolkit, context, () => toolchainReady),
        {
          expected: "A C++ build manifest exists in the target project.",
          id: "cpp-build-manifest",
          label: "Build manifest",
          run: () => checkCppBuildManifest(toolkit, checkTargetRoot, context)
        },
        {
          expected: "At least one C++ source or header file exists.",
          id: "cpp-source-files",
          label: "C++ files",
          run: () => checkCppSources(checkTargetRoot)
        }
      ];
    },
    terminalActions: [
      buildToolchainTerminal,
      seedProjectTerminal
    ]
  });
}

export {
  createCppSetupDoctorPlugin,
  cppToolchainBuildRepair
};
