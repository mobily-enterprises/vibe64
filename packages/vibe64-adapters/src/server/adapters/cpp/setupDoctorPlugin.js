import {
  blockedDoctorCheck as blockedCheck,
  failDoctorCheck as failCheck,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  createDoctorPluginToolkit
} from "@local/setup-doctor-core/server/doctorPluginToolkit";
import {
  seedCppProjectCommandPreview,
  seedCppProjectScript
} from "./seedProject.js";
import {
  findCppFiles
} from "./projectFiles.js";

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

function createHostCommandCommandCheck(toolkit, {
  commandArgs = [],
  expected = "",
  id = "",
  label = ""
} = {}) {
  return toolkit.hostCommandCheck({
    commandArgs,
    expected: expected || `${label} is available on the host.`,
    explanation: `C++ setup, build, target scripts, and automated checks require ${label}.`,
    id,
    label
  });
}

function cppHostCommandCommandCheckItem(toolkit, context, {
  commandArgs = [],
  expected = "",
  id = "",
  label = ""
} = {}) {
  return {
    expected,
    id,
    label,
    run: () => createHostCommandCommandCheck(toolkit, {
          commandArgs,
          expected,
          id,
          label
        }).run(context)
  };
}

function cppHostCommandCommandChecks(toolkit, context) {
  return [
    cppHostCommandCommandCheckItem(toolkit, context, {
      commandArgs: ["c++", "--version"],
      expected: "A C++ compiler is available on the host.",
      id: "cpp-compiler-host-command",
      label: "C++ compiler"
    }),
    cppHostCommandCommandCheckItem(toolkit, context, {
      commandArgs: ["cmake", "--version"],
      expected: "CMake is available on the host.",
      id: "cpp-cmake-host-command",
      label: "CMake"
    }),
    cppHostCommandCommandCheckItem(toolkit, context, {
      commandArgs: ["ninja", "--version"],
      expected: "Ninja is available on the host.",
      id: "cpp-ninja-host-command",
      label: "Ninja"
    }),
    cppHostCommandCommandCheckItem(toolkit, context, {
      commandArgs: ["make", "--version"],
      expected: "Make is available on the host.",
      id: "cpp-make-host-command",
      label: "Make"
    }),
    cppHostCommandCommandCheckItem(toolkit, context, {
      commandArgs: ["meson", "--version"],
      expected: "Meson is available on the host.",
      id: "cpp-meson-host-command",
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
  const seedProjectTerminal = toolkit.hostCommandTerminalAction({
    actionId: "terminal-seed-cpp-project",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", seedCppProjectScript(context.config || {})],
    commandPreview: (context = {}) => seedCppProjectCommandPreview(context.config || {}),
    label: "Create C++ project",
    targetRoot: ({ targetRoot: contextTargetRoot = "" } = {}) => contextTargetRoot || targetRoot
  });

  return toolkit.plugin({
    id: "cpp-target-runtime",
    label: "C++ target runtime",
    checks(context = {}) {
      const checkTargetRoot = context.targetRoot || targetRoot;
      return [
        ...cppHostCommandCommandChecks(toolkit, context),
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
      seedProjectTerminal
    ]
  });
}

export {
  createCppSetupDoctorPlugin
};
