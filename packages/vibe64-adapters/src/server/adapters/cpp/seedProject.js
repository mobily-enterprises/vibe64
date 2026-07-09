import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  cppBuildTypeValue,
  cppStandardNumber,
  selectedCppBuildSystem,
  selectedCppProjectKind,
  selectedCppTesting
} from "./config.js";

function testingEnabled(config = {}) {
  return selectedCppTesting(config) === "enabled";
}

function cppStandardCompilerFlag(config = {}) {
  return `-std=c++${cppStandardNumber(config)}`;
}

function mesonBuildTypeValue(config = {}) {
  return {
    Debug: "debug",
    Release: "release",
    RelWithDebInfo: "debugoptimized"
  }[cppBuildTypeValue(config)] || "debug";
}

function cmakeSeedProject(config = {}) {
  const standard = cppStandardNumber(config);
  if (selectedCppProjectKind(config) === "library") {
    return [
      "cmake_minimum_required(VERSION 3.25)",
      "project(cpp_starter LANGUAGES CXX)",
      "",
      `set(CMAKE_CXX_STANDARD ${standard})`,
      "set(CMAKE_CXX_STANDARD_REQUIRED ON)",
      "set(CMAKE_CXX_EXTENSIONS OFF)",
      "",
      "add_library(cpp_starter src/cpp_starter.cpp)",
      "target_include_directories(cpp_starter PUBLIC include)",
      "",
      ...(testingEnabled(config) ? [
        "enable_testing()",
        "add_executable(cpp_starter_tests tests/cpp_starter_test.cpp)",
        "target_link_libraries(cpp_starter_tests PRIVATE cpp_starter)",
        "add_test(NAME cpp_starter_tests COMMAND cpp_starter_tests)"
      ] : [])
    ].join("\n");
  }
  return [
    "cmake_minimum_required(VERSION 3.25)",
    "project(cpp_starter LANGUAGES CXX)",
    "",
    `set(CMAKE_CXX_STANDARD ${standard})`,
    "set(CMAKE_CXX_STANDARD_REQUIRED ON)",
    "set(CMAKE_CXX_EXTENSIONS OFF)",
    "",
    "add_executable(cpp_starter src/main.cpp)",
    "",
    ...(testingEnabled(config) ? [
      "enable_testing()",
      "add_test(NAME cpp_starter_runs COMMAND cpp_starter)"
    ] : [])
  ].join("\n");
}

function makePhonyTargets(config = {}) {
  return testingEnabled(config) ? ".PHONY: all clean test" : ".PHONY: all clean";
}

function makeSeedProject(config = {}) {
  if (selectedCppProjectKind(config) === "library") {
    return [
      "CXX ?= c++",
      "AR ?= ar",
      `CXXFLAGS ?= ${cppStandardCompilerFlag(config)} -Wall -Wextra -pedantic -Iinclude -g`,
      "BUILD_DIR := build",
      "TARGET := $(BUILD_DIR)/libcpp_starter.a",
      "SOURCES := src/cpp_starter.cpp",
      "OBJECTS := $(SOURCES:%.cpp=$(BUILD_DIR)/%.o)",
      "TEST_TARGET := $(BUILD_DIR)/cpp_starter_tests",
      "",
      makePhonyTargets(config),
      "",
      "all: $(TARGET)",
      "",
      "$(TARGET): $(OBJECTS)",
      "\tmkdir -p $(dir $@)",
      "\t$(AR) rcs $@ $^",
      "",
      "$(BUILD_DIR)/%.o: %.cpp",
      "\tmkdir -p $(dir $@)",
      "\t$(CXX) $(CXXFLAGS) -c $< -o $@",
      "",
      ...(testingEnabled(config) ? [
        "test: $(TARGET)",
        "\tmkdir -p $(dir $(TEST_TARGET))",
        "\t$(CXX) $(CXXFLAGS) tests/cpp_starter_test.cpp $(TARGET) -o $(TEST_TARGET)",
        "\t./$(TEST_TARGET)",
        ""
      ] : []),
      "clean:",
      "\trm -rf $(BUILD_DIR)"
    ].join("\n");
  }
  return [
    "CXX ?= c++",
    `CXXFLAGS ?= ${cppStandardCompilerFlag(config)} -Wall -Wextra -pedantic -g`,
    "BUILD_DIR := build",
    "TARGET := $(BUILD_DIR)/cpp_starter",
    "SOURCES := src/main.cpp",
    "OBJECTS := $(SOURCES:%.cpp=$(BUILD_DIR)/%.o)",
    "",
    makePhonyTargets(config),
    "",
    "all: $(TARGET)",
    "",
    "$(TARGET): $(OBJECTS)",
    "\tmkdir -p $(dir $@)",
    "\t$(CXX) $(CXXFLAGS) $^ -o $@",
    "",
    "$(BUILD_DIR)/%.o: %.cpp",
    "\tmkdir -p $(dir $@)",
    "\t$(CXX) $(CXXFLAGS) -c $< -o $@",
    "",
    ...(testingEnabled(config) ? [
      "test: $(TARGET)",
      "\t./$(TARGET)",
      ""
    ] : []),
    "clean:",
    "\trm -rf $(BUILD_DIR)"
  ].join("\n");
}

function mesonSeedProject(config = {}) {
  const standard = `c++${cppStandardNumber(config)}`;
  if (selectedCppProjectKind(config) === "library") {
    return [
      `project('cpp_starter', 'cpp', default_options : ['cpp_std=${standard}', 'warning_level=2'])`,
      "",
      "inc = include_directories('include')",
      "cpp_starter = library('cpp_starter', 'src/cpp_starter.cpp', include_directories : inc)",
      "",
      ...(testingEnabled(config) ? [
        "cpp_starter_tests = executable(",
        "  'cpp_starter_tests',",
        "  'tests/cpp_starter_test.cpp',",
        "  include_directories : inc,",
        "  link_with : cpp_starter,",
        ")",
        "test('cpp_starter_tests', cpp_starter_tests)"
      ] : [])
    ].join("\n");
  }
  return [
    `project('cpp_starter', 'cpp', default_options : ['cpp_std=${standard}', 'warning_level=2'])`,
    "",
    "cpp_starter = executable('cpp_starter', 'src/main.cpp')",
    "",
    ...(testingEnabled(config) ? [
      "test('cpp_starter_runs', cpp_starter)"
    ] : [])
  ].join("\n");
}

function starterSourceFiles(config = {}) {
  if (selectedCppProjectKind(config) !== "library") {
    return [
      ["src/main.cpp", [
        "#include <iostream>",
        "",
        "int main() {",
        "  std::cout << \"C++ starter is ready.\\n\";",
        "  return 0;",
        "}"
      ].join("\n")]
    ];
  }
  return [
    ["include/cpp_starter.hpp", [
      "#pragma once",
      "",
      "int add(int left, int right);"
    ].join("\n")],
    ["src/cpp_starter.cpp", [
      "#include \"cpp_starter.hpp\"",
      "",
      "int add(int left, int right) {",
      "  return left + right;",
      "}"
    ].join("\n")],
    ...(testingEnabled(config) ? [
      ["tests/cpp_starter_test.cpp", [
        "#include \"cpp_starter.hpp\"",
        "",
        "#include <cassert>",
        "",
        "int main() {",
        "  assert(add(2, 3) == 5);",
        "  return 0;",
        "}"
      ].join("\n")]
    ] : [])
  ];
}

function seedFiles(config = {}) {
  const manifest = {
    cmake: ["CMakeLists.txt", cmakeSeedProject(config)],
    make: ["Makefile", makeSeedProject(config)],
    meson: ["meson.build", mesonSeedProject(config)]
  }[selectedCppBuildSystem(config)] || ["CMakeLists.txt", cmakeSeedProject(config)];
  return [
    manifest,
    ...starterSourceFiles(config)
  ];
}

function pathDirectory(relativePath = "") {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

function writeSeedFileScript(relativePath = "", contents = "") {
  return [
    `mkdir -p ${shellQuote(pathDirectory(relativePath))}`,
    `cat > ${shellQuote(relativePath)} <<'VIBE64_CPP_FILE'`,
    contents.trim(),
    "VIBE64_CPP_FILE"
  ].join("\n");
}

function loggedCommandScript(command = "") {
  return [
    `printf '[studio] $ %s\\n' ${shellQuote(command)}`,
    command
  ];
}

function cmakeSeedBuildCommands(config = {}) {
  return [
    [
      "cmake -S . -B build -G Ninja",
      `-DCMAKE_BUILD_TYPE=${cppBuildTypeValue(config)}`,
      `-DCMAKE_CXX_STANDARD=${cppStandardNumber(config)}`,
      "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON"
    ].join(" "),
    "cmake --build build",
    testingEnabled(config) ? "ctest --test-dir build --output-on-failure" : ""
  ].filter(Boolean);
}

function makeSeedBuildCommands(config = {}) {
  return [
    "make",
    testingEnabled(config) ? "make test" : ""
  ].filter(Boolean);
}

function mesonSeedBuildCommands(config = {}) {
  return [
    `meson setup build --buildtype=${mesonBuildTypeValue(config)}`,
    "meson compile -C build",
    testingEnabled(config) ? "meson test -C build --print-errorlogs" : ""
  ].filter(Boolean);
}

function seedBuildCommands(config = {}) {
  return {
    cmake: cmakeSeedBuildCommands,
    make: makeSeedBuildCommands,
    meson: mesonSeedBuildCommands
  }[selectedCppBuildSystem(config)]?.(config) || cmakeSeedBuildCommands(config);
}

function seedCppProjectCommandPreview(config = {}) {
  return `create C++ ${selectedCppBuildSystem(config)} starter`;
}

function seedCppProjectScript(config = {}) {
  return [
    "set -e",
    "if [ -e CMakeLists.txt ] || [ -e Makefile ] || [ -e GNUmakefile ] || [ -e meson.build ]; then",
    "  printf '[studio] Refusing to seed over an existing C++ build manifest.\\n' >&2",
    "  exit 1",
    "fi",
    ...seedFiles(config).map(([relativePath, contents]) => writeSeedFileScript(relativePath, contents)),
    ...seedBuildCommands(config).flatMap(loggedCommandScript)
  ].join("\n");
}

export {
  seedCppProjectCommandPreview,
  seedCppProjectScript
};
