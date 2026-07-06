import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  createVibe64AdapterRegistry
} from "@local/vibe64-adapters/server/adapters/registry";
import {
  CPP_VIBE64_COMMANDS,
  createCppSetupDoctorPlugin,
  createCppTargetAdapter,
  seedCppProjectScript
} from "@local/vibe64-adapters/server/adapters/cpp/index";
import { withTemporaryRoot, sourceMetadata } from "./vibe64TestHelpers.js";

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createCppProject(root) {
  await Promise.all([
    writeProjectFile(root, "CMakeLists.txt", [
      "cmake_minimum_required(VERSION 3.25)",
      "project(cpp_demo LANGUAGES CXX)",
      "",
      "add_executable(cpp_demo src/main.cpp)",
      "enable_testing()",
      "add_test(NAME cpp_demo_runs COMMAND cpp_demo)"
    ].join("\n")),
    writeProjectFile(root, "include/cpp_demo.hpp", "#pragma once\n\nint answer();\n"),
    writeProjectFile(root, "src/main.cpp", [
      "#include \"cpp_demo.hpp\"",
      "",
      "int answer() {",
      "  return 42;",
      "}",
      "",
      "int main() {",
      "  return answer() == 42 ? 0 : 1;",
      "}"
    ].join("\n"))
  ]);
}

function commandIds() {
  return CPP_VIBE64_COMMANDS
    .map((command) => command.id)
    .sort((left, right) => left.localeCompare(right));
}

test("cpp adapter is registered as an implemented project type", async () => {
  const registry = createVibe64AdapterRegistry();
  const projectTypes = registry.availableProjectTypes();
  const cppProjectType = projectTypes.find((type) => type.id === "cpp");

  assert.equal(cppProjectType.disabledReason, "");
  assert.equal(cppProjectType.enabled, true);
  assert.equal(cppProjectType.id, "cpp");
  assert.equal(cppProjectType.label, "C++");
  assert.match(cppProjectType.description, /CMake, Make, Meson/u);
  assert.match(cppProjectType.outcome, /C\+\+17\/C\+\+20\/C\+\+23/u);
  assert.equal(cppProjectType.projectUrl, "https://isocpp.org");
  assert.ok(cppProjectType.techStack.includes("C++"));
  assert.equal((await registry.createAdapter("cpp")).id, "cpp");
});

test("cpp adapter exposes project facts, commands, defaults, and prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCppProject(targetRoot);
    const adapter = createCppTargetAdapter();

    const facts = await adapter.inspect({
      targetRoot
    });
    const promptContext = await adapter.getPromptContext({
      targetRoot
    });

    assert.equal(facts.summary, "C++ project type selected.");
    assert.equal(Object.hasOwn(facts, "promptContext"), false);
    assert.equal(promptContext.adapter, "cpp");
    assert.equal(promptContext.build_system, "cmake");
    assert.equal(promptContext.build_type, "debug");
    assert.equal(promptContext.build_type_cmake, "Debug");
    assert.equal(promptContext.cmake_project_name, "cpp_demo");
    assert.equal(promptContext.cmake_targets, "executable:cpp_demo");
    assert.equal(promptContext.cpp_standard, "C++20");
    assert.equal(promptContext.cpp_standard_number, "20");
    assert.equal(promptContext.detected_build_system, "cmake");
    assert.equal(promptContext.project_kind, "executable");
    assert.equal(promptContext.testing, "enabled");
    assert.equal(promptContext.valid_cpp_markers, "true");
    assert.match(promptContext.header_files, /include\/cpp_demo\.hpp/u);
    assert.match(promptContext.source_files, /src\/main\.cpp/u);
    assert.match(promptContext.environment_blueprint, /Build system: CMake/u);
    assert.match(promptContext.environment_blueprint, /C\+\+ standard: C\+\+20/u);
    assert.match(promptContext.environment_blueprint, /Project kind: executable/u);
    assert.match(promptContext.environment_blueprint, /Testing: enabled/u);
    assert.deepEqual(facts.commands.map((command) => command.id), commandIds());
    assert.equal(facts.capabilities.create_source, true);
    assert.equal(facts.capabilities.install_dependencies, true);
    assert.equal(facts.capabilities.run_automated_checks, true);
    assert.equal(facts.capabilities.update_code_index, true);

    const defaults = await adapter.getDefaultConfig();
    assert.deepEqual(defaults, {
      cpp_build_system: "cmake",
      cpp_build_type: "debug",
      cpp_cxx_standard: "cpp20",
      cpp_project_kind: "executable",
      cpp_testing: "enabled"
    });
  });
});

test("cpp adapter composes prompt blueprints from independent config choices", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCppProject(targetRoot);
    const adapter = createCppTargetAdapter();

    const promptContext = await adapter.getPromptContext({
      config: {
        values: {
          cpp_build_system: "make",
          cpp_build_type: "release",
          cpp_cxx_standard: "cpp23",
          cpp_project_kind: "library",
          cpp_testing: "none"
        }
      },
      targetRoot
    });

    assert.equal(promptContext.build_system, "make");
    assert.equal(promptContext.build_type, "release");
    assert.equal(promptContext.build_type_cmake, "Release");
    assert.equal(promptContext.cpp_standard, "C++23");
    assert.equal(promptContext.cpp_standard_number, "23");
    assert.equal(promptContext.project_kind, "library");
    assert.equal(promptContext.testing, "none");
    assert.match(promptContext.environment_blueprint, /Build system: Make/u);
    assert.match(promptContext.environment_blueprint, /C\+\+ standard: C\+\+23/u);
    assert.match(promptContext.environment_blueprint, /Project kind: library/u);
    assert.match(promptContext.environment_blueprint, /Testing: none/u);
    assert.match(promptContext.environment_blueprint, /Use Release for Studio-managed/u);
  });
});

test("cpp prompt actions use the C++ prompt pack", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCppProject(targetRoot);
    const runtime = new Vibe64SessionRuntime({
      adapter: createCppTargetAdapter(),
      projectConfig: {
        values: {
          cpp_cxx_standard: "cpp23"
        }
      },
      targetRoot
    });
    await runtime.createSession({
      initialStep: "plan_and_execute",
      metadata: sourceMetadata(targetRoot, "cpp_prompt"),
      sessionId: "cpp_prompt"
    });

    const afterPrompt = await runtime.runAction("cpp_prompt", "make_plan");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "cpp");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.cpp_standard, "C++23");
    assert.match(afterPrompt.actionResult.prompt, /Vibe64 standard planning instructions/u);
    assert.match(afterPrompt.actionResult.prompt, /Create the implementation plan for this C\+\+ project/u);
    assert.match(afterPrompt.actionResult.prompt, /C\+\+ selected blueprint:/u);
    assert.match(afterPrompt.actionResult.prompt, /C\+\+ standard: C\+\+23/u);
    assert.match(afterPrompt.actionResult.prompt, /ownership\/lifetime/u);
    assert.doesNotMatch(afterPrompt.actionResult.prompt, /\{\{adapter\.promptContext\.environment_blueprint\}\}/u);
    assert.match(afterPrompt.actionResult.prompt, /cpp_demo/u);
  });
});

test("cpp current-app scripts describe CMake commands and use the C++ host command", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCppProject(targetRoot);
    const adapter = createCppTargetAdapter();

    const scripts = await adapter.listCurrentAppTargetScripts({
      targetRoot
    });
    const scriptNames = scripts.scripts.map((script) => script.name);
    assert.equal(scripts.ok, true);
    assert.ok(scriptNames.includes("cmake:configure"));
    assert.ok(scriptNames.includes("cmake:build"));
    assert.ok(scriptNames.includes("ctest"));
    assert.ok(scriptNames.includes("run:cpp_demo"));

    const spec = await adapter.createCurrentAppTargetScriptTerminalSpec({
      input: {
        scriptId: "adapter:cmake:build"
      },
      targetRoot
    });

    assert.equal(spec.ok, true);
    assert.equal(spec.command, "bash");
    assert.equal(spec.commandPreview, "cmake --build build");
    assert.equal(spec.metadata.command, "cmake --build build");
    assert.deepEqual(spec.args({
      id: "cpp-script"
    }).slice(0, 1), ["-lc"]);
  });
});

test("cpp setup checks the full C++ host command on the host", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createCppProject(targetRoot);
    const commandCalls = [];
    const plugin = createCppSetupDoctorPlugin({
      runCommand: async (command, args) => {
        commandCalls.push({
          args,
          command
        });
        return {
          ok: true,
          output: "tool-ready",
          stdout: "tool-ready"
        };
      },
      targetRoot
    });
    const context = {
      config: {
        values: {}
      },
      targetRoot
    };
    const checks = plugin.checks(context);

    for (const checkId of [
      "cpp-compiler-host-command",
      "cpp-cmake-host-command",
      "cpp-ninja-host-command",
      "cpp-make-host-command",
      "cpp-meson-host-command",
      "cpp-build-manifest",
      "cpp-source-files"
    ]) {
      const result = await checks.find((check) => check.id === checkId).run(context);
      assert.equal(result.status, "pass", checkId);
    }

    assert.ok(commandCalls.some((call) => call.command === "c++" && call.args.includes("--version")));
    assert.ok(commandCalls.some((call) => call.command === "cmake" && call.args.includes("--version")));
    assert.ok(commandCalls.some((call) => call.command === "ninja" && call.args.includes("--version")));
    assert.ok(commandCalls.some((call) => call.command === "make" && call.args.includes("--version")));
    assert.ok(commandCalls.some((call) => call.command === "meson" && call.args.includes("--version")));
  });
});

test("cpp setup seeds empty targets without overwriting existing app files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const plugin = createCppSetupDoctorPlugin({
      targetRoot
    });
    const buildManifestCheck = plugin.checks({
      targetRoot
    }).find((check) => check.id === "cpp-build-manifest");

    const emptyResult = await buildManifestCheck.run({
      targetRoot
    });
    assert.equal(emptyResult.status, "blocked");
    assert.equal(emptyResult.repair.actionId, "terminal-seed-cpp-project");

    await writeProjectFile(targetRoot, "README.md", "Existing project file.\n");
    const occupiedBuildManifestCheck = plugin.checks({
      nonGitEntries: [
        "README.md"
      ],
      targetRoot
    }).find((check) => check.id === "cpp-build-manifest");
    const occupiedResult = await occupiedBuildManifestCheck.run();
    assert.equal(occupiedResult.status, "hard-stop");
    assert.equal(occupiedResult.repair, null);
  });
});

test("cpp seed script reflects selected project shape, standard, and test runner", () => {
  const script = seedCppProjectScript({
    values: {
      cpp_build_system: "cmake",
      cpp_build_type: "release",
      cpp_cxx_standard: "cpp23",
      cpp_project_kind: "library",
      cpp_testing: "enabled"
    }
  });

  assert.match(script, /add_library\(cpp_starter src\/cpp_starter\.cpp\)/u);
  assert.match(script, /set\(CMAKE_CXX_STANDARD 23\)/u);
  assert.match(script, /-DCMAKE_BUILD_TYPE=Release/u);
  assert.match(script, /include\/cpp_starter\.hpp/u);
  assert.match(script, /tests\/cpp_starter_test\.cpp/u);
  assert.match(script, /ctest --test-dir build --output-on-failure/u);
});

test("cpp seed script can create Make and Meson starters from config", () => {
  const makeScript = seedCppProjectScript({
    values: {
      cpp_build_system: "make",
      cpp_cxx_standard: "cpp17",
      cpp_project_kind: "executable",
      cpp_testing: "enabled"
    }
  });
  const mesonScript = seedCppProjectScript({
    values: {
      cpp_build_system: "meson",
      cpp_build_type: "relwithdebinfo",
      cpp_cxx_standard: "cpp20",
      cpp_project_kind: "library",
      cpp_testing: "enabled"
    }
  });

  assert.match(makeScript, /cat > Makefile/u);
  assert.match(makeScript, /-std=c\+\+17/u);
  assert.match(makeScript, /make test/u);
  assert.match(mesonScript, /cat > meson\.build/u);
  assert.match(mesonScript, /cpp_std=c\+\+20/u);
  assert.match(mesonScript, /library\('cpp_starter'/u);
  assert.match(mesonScript, /meson setup build --buildtype=debugoptimized/u);
  assert.match(mesonScript, /meson test -C build --print-errorlogs/u);
});
