import {
  configOptionValues,
  defaultConfigFromFields,
  selectedConfigValue
} from "../../configValues.js";
import { deepFreeze } from "../../deepFreeze.js";
import {
  CPP_BUILD_SYSTEM_CONFIG,
  CPP_BUILD_TYPE_CONFIG,
  CPP_CXX_STANDARD_CONFIG,
  CPP_PROJECT_KIND_CONFIG,
  CPP_TESTING_CONFIG
} from "./constants.js";

const CPP_BUILD_SYSTEM_OPTIONS = deepFreeze([
  {
    description: "Use CMake project files, targets, and CTest conventions.",
    label: "CMake",
    value: "cmake"
  },
  {
    description: "Use Makefile-based build and test commands.",
    label: "Make",
    value: "make"
  },
  {
    description: "Use Meson setup, compile, and test commands.",
    label: "Meson",
    value: "meson"
  }
]);

const CPP_CXX_STANDARD_OPTIONS = deepFreeze([
  {
    description: "Use C++17 language settings in generated project files.",
    label: "C++17",
    value: "cpp17"
  },
  {
    description: "Use C++20 language settings in generated project files.",
    label: "C++20",
    value: "cpp20"
  },
  {
    description: "Use C++23 language settings in generated project files.",
    label: "C++23",
    value: "cpp23"
  }
]);

const CPP_BUILD_TYPE_OPTIONS = deepFreeze([
  {
    description: "Build with debug symbols and no release optimization.",
    label: "Debug",
    value: "debug"
  },
  {
    description: "Build with release optimization while keeping debug information.",
    label: "RelWithDebInfo",
    value: "relwithdebinfo"
  },
  {
    description: "Build with release optimization.",
    label: "Release",
    value: "release"
  }
]);

const CPP_PROJECT_KIND_OPTIONS = deepFreeze([
  {
    description: "Seed and prompt for an application that produces a runnable binary.",
    label: "Executable",
    value: "executable"
  },
  {
    description: "Seed and prompt for reusable library code.",
    label: "Library",
    value: "library"
  }
]);

const CPP_TESTING_OPTIONS = deepFreeze([
  {
    description: "Use the selected build system's native test command.",
    label: "Build-system tests",
    value: "enabled"
  },
  {
    description: "Do not add test runner assumptions to seeded projects.",
    label: "None",
    value: "none"
  }
]);

const CPP_BUILD_SYSTEMS = configOptionValues(CPP_BUILD_SYSTEM_OPTIONS);
const CPP_BUILD_TYPES = configOptionValues(CPP_BUILD_TYPE_OPTIONS);
const CPP_PROJECT_KINDS = configOptionValues(CPP_PROJECT_KIND_OPTIONS);
const CPP_STANDARDS = configOptionValues(CPP_CXX_STANDARD_OPTIONS);
const CPP_TESTING_VALUES = configOptionValues(CPP_TESTING_OPTIONS);

const CPP_CONFIG_FIELDS = deepFreeze([
  {
    defaultValue: "cmake",
    description: "Build system Studio uses when seeding, configuring, building, testing, and prompting for this C++ target.",
    id: CPP_BUILD_SYSTEM_CONFIG,
    label: "Build system",
    options: CPP_BUILD_SYSTEM_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "cpp20",
    description: "Default C++ language standard used by generated CMake files and prompt guidance.",
    id: CPP_CXX_STANDARD_CONFIG,
    label: "C++ standard",
    options: CPP_CXX_STANDARD_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "debug",
    description: "Default local build type for configure, build, test, and target-script commands.",
    id: CPP_BUILD_TYPE_CONFIG,
    label: "Build type",
    options: CPP_BUILD_TYPE_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "executable",
    description: "Project shape Studio uses when seeding an empty C++ target.",
    id: CPP_PROJECT_KIND_CONFIG,
    label: "Project kind",
    options: CPP_PROJECT_KIND_OPTIONS,
    type: "select"
  },
  {
    defaultValue: "enabled",
    description: "Whether seeded projects and automated-check guidance should use the build system's native test entry point.",
    id: CPP_TESTING_CONFIG,
    label: "Testing",
    options: CPP_TESTING_OPTIONS,
    type: "select"
  }
]);

const CPP_DEFAULT_CONFIG = deepFreeze(defaultConfigFromFields(CPP_CONFIG_FIELDS));

function selectedCppBuildSystem(config = {}) {
  return selectedConfigValue(config, CPP_BUILD_SYSTEM_CONFIG, CPP_BUILD_SYSTEMS, "cmake");
}

function selectedCppBuildType(config = {}) {
  return selectedConfigValue(config, CPP_BUILD_TYPE_CONFIG, CPP_BUILD_TYPES, "debug");
}

function selectedCppProjectKind(config = {}) {
  return selectedConfigValue(config, CPP_PROJECT_KIND_CONFIG, CPP_PROJECT_KINDS, "executable");
}

function selectedCppStandard(config = {}) {
  return selectedConfigValue(config, CPP_CXX_STANDARD_CONFIG, CPP_STANDARDS, "cpp20");
}

function selectedCppTesting(config = {}) {
  return selectedConfigValue(config, CPP_TESTING_CONFIG, CPP_TESTING_VALUES, "enabled");
}

function cppBuildTypeValue(config = {}) {
  return {
    debug: "Debug",
    release: "Release",
    relwithdebinfo: "RelWithDebInfo"
  }[selectedCppBuildType(config)] || "Debug";
}

function cppStandardLabel(config = {}) {
  return {
    cpp17: "C++17",
    cpp20: "C++20",
    cpp23: "C++23"
  }[selectedCppStandard(config)] || "C++20";
}

function cppStandardNumber(config = {}) {
  return {
    cpp17: "17",
    cpp20: "20",
    cpp23: "23"
  }[selectedCppStandard(config)] || "20";
}

export {
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
};
