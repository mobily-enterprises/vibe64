const JAVASCRIPT_SOURCE_EXTENSIONS = Object.freeze([
  ".astro",
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".mdx",
  ".mjs",
  ".scss",
  ".svelte",
  ".ts",
  ".tsx",
  ".vue"
]);

const NEXT_CAMPUSES = Object.freeze([
  Object.freeze({
    description: "Filesystem routes and layouts owned by the App Router.",
    executionSide: "shared",
    id: "app-router",
    roots: ["app", "src/app"],
    title: "App Router"
  }),
  Object.freeze({
    description: "Filesystem routes owned by the Pages Router.",
    executionSide: "shared",
    id: "pages-router",
    roots: ["pages", "src/pages"],
    title: "Pages Router"
  }),
  Object.freeze({
    description: "Project tests and executable specifications.",
    executionSide: "unknown",
    id: "tests",
    roots: ["test", "tests", "__tests__"],
    title: "Tests"
  })
]);

const GENERIC_SYSTEM_ADAPTER_PROFILES = Object.freeze({
  cpp: Object.freeze({
    adapterId: "cpp",
    campuses: Object.freeze([
      Object.freeze({
        description: "Native implementation sources.",
        executionSide: "unknown",
        id: "source",
        roots: ["src", "source"],
        title: "Source"
      }),
      Object.freeze({
        description: "Published and internal native headers.",
        executionSide: "shared",
        id: "headers",
        roots: ["include"],
        title: "Headers"
      }),
      Object.freeze({
        description: "Native test programs and fixtures.",
        executionSide: "unknown",
        id: "tests",
        roots: ["test", "tests"],
        title: "Tests"
      }),
      Object.freeze({
        description: "Example programs and integration samples.",
        executionSide: "unknown",
        id: "examples",
        roots: ["example", "examples"],
        title: "Examples"
      })
    ]),
    extensions: Object.freeze([
      ".c",
      ".cc",
      ".cmake",
      ".cpp",
      ".cxx",
      ".h",
      ".hh",
      ".hpp",
      ".hxx",
      ".m",
      ".mm"
    ]),
    excludedPaths: Object.freeze([]),
    label: "C++",
    specialFiles: Object.freeze(["CMakeLists.txt"]),
    version: 2
  }),
  laravel: Object.freeze({
    adapterId: "laravel",
    campuses: Object.freeze([
      Object.freeze({
        description: "Laravel application classes and domain behavior.",
        executionSide: "server",
        id: "application",
        roots: ["app"],
        title: "Application"
      }),
      Object.freeze({
        description: "HTTP, console, channel, and API route registrations.",
        executionSide: "server",
        id: "routes",
        roots: ["routes"],
        title: "Routes"
      }),
      Object.freeze({
        description: "Blade templates and browser application sources.",
        executionSide: "client",
        id: "resources",
        roots: ["resources"],
        title: "Resources"
      }),
      Object.freeze({
        description: "Migrations, factories, and seeders.",
        executionSide: "server",
        id: "database",
        roots: ["database"],
        title: "Database"
      }),
      Object.freeze({
        description: "Laravel application and feature tests.",
        executionSide: "unknown",
        id: "tests",
        roots: ["tests"],
        title: "Tests"
      })
    ]),
    extensions: Object.freeze([
      ".blade.php",
      ".css",
      ".js",
      ".jsx",
      ".php",
      ".scss",
      ".ts",
      ".tsx",
      ".vue"
    ]),
    excludedPaths: Object.freeze(["bootstrap/cache", "storage"]),
    label: "Laravel",
    specialFiles: Object.freeze([]),
    version: 2
  }),
  nextjs: Object.freeze({
    adapterId: "nextjs",
    campuses: NEXT_CAMPUSES,
    extensions: JAVASCRIPT_SOURCE_EXTENSIONS,
    excludedPaths: Object.freeze([]),
    label: "Next.js",
    specialFiles: Object.freeze([]),
    version: 2
  }),
  "node-web": Object.freeze({
    adapterId: "node-web",
    campuses: Object.freeze([
      Object.freeze({
        description: "Primary application source tree.",
        executionSide: "shared",
        id: "source",
        roots: ["src"],
        title: "Source"
      }),
      Object.freeze({
        description: "Server entrypoints and runtime implementation.",
        executionSide: "server",
        id: "server",
        roots: ["server"],
        title: "Server"
      }),
      Object.freeze({
        description: "Top-level filesystem routes.",
        executionSide: "shared",
        id: "routes",
        roots: ["routes", "pages"],
        title: "Routes"
      }),
      Object.freeze({
        description: "Server-rendered templates and browser views.",
        executionSide: "client",
        id: "views",
        roots: ["views"],
        title: "Views"
      }),
      Object.freeze({
        description: "Automated tests and fixtures.",
        executionSide: "unknown",
        id: "tests",
        roots: ["test", "tests", "__tests__"],
        title: "Tests"
      })
    ]),
    extensions: JAVASCRIPT_SOURCE_EXTENSIONS,
    excludedPaths: Object.freeze([]),
    label: "Generic Node web app",
    specialFiles: Object.freeze([]),
    version: 2
  }),
  vinext: Object.freeze({
    adapterId: "vinext",
    campuses: Object.freeze([
      ...NEXT_CAMPUSES,
      Object.freeze({
        description: "Cloudflare Worker entrypoints and runtime support.",
        executionSide: "server",
        id: "worker",
        roots: ["worker", "workers"],
        title: "Worker Runtime"
      })
    ]),
    extensions: JAVASCRIPT_SOURCE_EXTENSIONS,
    excludedPaths: Object.freeze([]),
    label: "Vinext",
    specialFiles: Object.freeze([]),
    version: 2
  })
});

function genericSystemAdapterProfiles() {
  return Object.values(GENERIC_SYSTEM_ADAPTER_PROFILES);
}

export {
  GENERIC_SYSTEM_ADAPTER_PROFILES,
  genericSystemAdapterProfiles
};
