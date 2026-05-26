import {
  deepFreeze
} from "@local/ai-studio-core/server/deepFreeze";
import {
  AI_STUDIO_APPLICATION_TYPE_SYSTEM
} from "../../applicationTypes.js";
import {
  createCppTargetAdapter
} from "./index.js";

const CPP_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "Native command-line tools, libraries, and systems programs built with CMake, Make, or Meson.",
      id: AI_STUDIO_APPLICATION_TYPE_SYSTEM,
      priority: 100
    }
  ],
  bestFor: "Native libraries, command-line tools, systems software, and existing CMake or Make based C++ codebases.",
  createAdapter: createCppTargetAdapter,
  description: "C++ projects are native codebases built around compilers, build manifests, source/header organization, and local test binaries. The adapter understands CMake, Make, Meson, generated starter projects, target scripts, and C++-specific workflow prompts.",
  enabled: true,
  id: "cpp",
  label: "C++",
  outcome: "Studio can seed or inspect a C++ project, configure C++17/C++20/C++23 builds, run CMake/Make/Meson commands in a managed C++ toolchain, update a code index, and guide Codex with prompts focused on native code quality.",
  projectUrl: "https://isocpp.org",
  projectUrlLabel: "Open ISO C++",
  summary: "Native C++ projects using CMake, Make, or Meson.",
  techStack: [
    "C++",
    "CMake",
    "Make",
    "Meson",
    "CTest"
  ]
});

export {
  CPP_ADAPTER_MANIFEST
};
