import path from "node:path";
import {
  readdir
} from "node:fs/promises";

import {
  dependencyNames,
  hasDependency,
  packageScript,
  packageScripts,
  readPackageJson,
  scriptNames
} from "../../nodePackage.js";

const MARKER_ROLE = Object.freeze({
  CONFIG: "config",
  ENTRYPOINT: "entrypoint",
  SOURCE: "source",
  TEST: "test"
});

const COMMON_MARKERS = Object.freeze([
  { currentId: "packageJson", id: "package_json", kind: "file", label: "package.json", relativePath: "package.json" },
  { currentId: "indexHtml", id: "index_html", kind: "file", label: "index.html", relativePath: "index.html", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "src", id: "src", kind: "directory", label: "src/", relativePath: "src", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "app", id: "app", kind: "directory", label: "app/", relativePath: "app", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcApp", id: "src_app", kind: "directory", label: "src/app/", relativePath: "src/app", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "pages", id: "pages", kind: "directory", label: "pages/", relativePath: "pages", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcPages", id: "src_pages", kind: "directory", label: "src/pages/", relativePath: "src/pages", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "routes", id: "routes", kind: "directory", label: "routes/", relativePath: "routes", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcRoutes", id: "src_routes", kind: "directory", label: "src/routes/", relativePath: "src/routes", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "server", id: "server", kind: "directory", label: "server/", relativePath: "server", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "api", id: "api", kind: "directory", label: "api/", relativePath: "api", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "public", id: "public", kind: "directory", label: "public/", relativePath: "public", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "static", id: "static", kind: "directory", label: "static/", relativePath: "static", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "components", id: "components", kind: "directory", label: "components/", relativePath: "components", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcComponents", id: "src_components", kind: "directory", label: "src/components/", relativePath: "src/components", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "views", id: "views", kind: "directory", label: "views/", relativePath: "views", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcViews", id: "src_views", kind: "directory", label: "src/views/", relativePath: "src/views", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "layouts", id: "layouts", kind: "directory", label: "layouts/", relativePath: "layouts", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcLayouts", id: "src_layouts", kind: "directory", label: "src/layouts/", relativePath: "src/layouts", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "lib", id: "lib", kind: "directory", label: "lib/", relativePath: "lib", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "srcLib", id: "src_lib", kind: "directory", label: "src/lib/", relativePath: "src/lib", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "client", id: "client", kind: "directory", label: "client/", relativePath: "client", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "frontend", id: "frontend", kind: "directory", label: "frontend/", relativePath: "frontend", roles: [MARKER_ROLE.SOURCE] },
  { currentId: "test", id: "test", kind: "directory", label: "test/", relativePath: "test", roles: [MARKER_ROLE.TEST] },
  { currentId: "tests", id: "tests", kind: "directory", label: "tests/", relativePath: "tests", roles: [MARKER_ROLE.TEST] },
  { currentId: "storybook", id: "storybook", kind: "directory", label: ".storybook/", relativePath: ".storybook", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "srcMainJs", id: "src_main_js", kind: "file", label: "src/main.js", relativePath: "src/main.js", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcMainTs", id: "src_main_ts", kind: "file", label: "src/main.ts", relativePath: "src/main.ts", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcMainJsx", id: "src_main_jsx", kind: "file", label: "src/main.jsx", relativePath: "src/main.jsx", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcMainTsx", id: "src_main_tsx", kind: "file", label: "src/main.tsx", relativePath: "src/main.tsx", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcAppJsx", id: "src_app_jsx", kind: "file", label: "src/App.jsx", relativePath: "src/App.jsx", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcAppTsx", id: "src_app_tsx", kind: "file", label: "src/App.tsx", relativePath: "src/App.tsx", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "srcAppVue", id: "src_app_vue", kind: "file", label: "src/App.vue", relativePath: "src/App.vue", roles: [MARKER_ROLE.ENTRYPOINT] },
  { currentId: "viteConfigTs", id: "vite_config_ts", kind: "file", label: "vite.config.ts", relativePath: "vite.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "viteConfigJs", id: "vite_config_js", kind: "file", label: "vite.config.js", relativePath: "vite.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "viteConfigMjs", id: "vite_config_mjs", kind: "file", label: "vite.config.mjs", relativePath: "vite.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "nextConfigTs", id: "next_config_ts", kind: "file", label: "next.config.ts", relativePath: "next.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "nextConfigJs", id: "next_config_js", kind: "file", label: "next.config.js", relativePath: "next.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "nextConfigMjs", id: "next_config_mjs", kind: "file", label: "next.config.mjs", relativePath: "next.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "nuxtConfigTs", id: "nuxt_config_ts", kind: "file", label: "nuxt.config.ts", relativePath: "nuxt.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "nuxtConfigJs", id: "nuxt_config_js", kind: "file", label: "nuxt.config.js", relativePath: "nuxt.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "vueConfig", id: "vue_config", kind: "file", label: "vue.config.js", relativePath: "vue.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "svelteConfig", id: "svelte_config", kind: "file", label: "svelte.config.js", relativePath: "svelte.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "astroConfigJs", id: "astro_config_js", kind: "file", label: "astro.config.js", relativePath: "astro.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "astroConfigMjs", id: "astro_config_mjs", kind: "file", label: "astro.config.mjs", relativePath: "astro.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "astroConfigTs", id: "astro_config_ts", kind: "file", label: "astro.config.ts", relativePath: "astro.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "angularJson", id: "angular_json", kind: "file", label: "angular.json", relativePath: "angular.json", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "webpackConfig", id: "webpack_config", kind: "file", label: "webpack.config.js", relativePath: "webpack.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "rollupConfig", id: "rollup_config", kind: "file", label: "rollup.config.js", relativePath: "rollup.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "tsconfig", id: "tsconfig", kind: "file", label: "tsconfig.json", relativePath: "tsconfig.json", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "jsconfig", id: "jsconfig", kind: "file", label: "jsconfig.json", relativePath: "jsconfig.json", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "tailwindConfigJs", id: "tailwind_config_js", kind: "file", label: "tailwind.config.js", relativePath: "tailwind.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "tailwindConfigMjs", id: "tailwind_config_mjs", kind: "file", label: "tailwind.config.mjs", relativePath: "tailwind.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "tailwindConfigTs", id: "tailwind_config_ts", kind: "file", label: "tailwind.config.ts", relativePath: "tailwind.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "eslintConfigJs", id: "eslint_config_js", kind: "file", label: "eslint.config.js", relativePath: "eslint.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "eslintConfigMjs", id: "eslint_config_mjs", kind: "file", label: "eslint.config.mjs", relativePath: "eslint.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "eslintrcJs", id: "eslintrc_js", kind: "file", label: ".eslintrc.js", relativePath: ".eslintrc.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "eslintrcCjs", id: "eslintrc_cjs", kind: "file", label: ".eslintrc.cjs", relativePath: ".eslintrc.cjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "eslintrcJson", id: "eslintrc_json", kind: "file", label: ".eslintrc.json", relativePath: ".eslintrc.json", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "biomeConfigJson", id: "biome_config_json", kind: "file", label: "biome.json", relativePath: "biome.json", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "biomeConfigJsonc", id: "biome_config_jsonc", kind: "file", label: "biome.jsonc", relativePath: "biome.jsonc", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "playwrightConfigJs", id: "playwright_config_js", kind: "file", label: "playwright.config.js", relativePath: "playwright.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "playwrightConfigMjs", id: "playwright_config_mjs", kind: "file", label: "playwright.config.mjs", relativePath: "playwright.config.mjs", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "playwrightConfigTs", id: "playwright_config_ts", kind: "file", label: "playwright.config.ts", relativePath: "playwright.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "vitestConfigJs", id: "vitest_config_js", kind: "file", label: "vitest.config.js", relativePath: "vitest.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "vitestConfigTs", id: "vitest_config_ts", kind: "file", label: "vitest.config.ts", relativePath: "vitest.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "jestConfigJs", id: "jest_config_js", kind: "file", label: "jest.config.js", relativePath: "jest.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "jestConfigTs", id: "jest_config_ts", kind: "file", label: "jest.config.ts", relativePath: "jest.config.ts", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "cypressConfigJs", id: "cypress_config_js", kind: "file", label: "cypress.config.js", relativePath: "cypress.config.js", roles: [MARKER_ROLE.CONFIG] },
  { currentId: "cypressConfigTs", id: "cypress_config_ts", kind: "file", label: "cypress.config.ts", relativePath: "cypress.config.ts", roles: [MARKER_ROLE.CONFIG] }
]);

const DIRECTORY_MARKER_IDS = new Set(COMMON_MARKERS
  .filter((marker) => marker.kind === "directory")
  .map((marker) => marker.currentId));

const CLIENT_LIBRARY_DEFINITIONS = Object.freeze([
  {
    dependencies: ["react", "react-dom"],
    id: "react",
    label: "React",
    markerPaths: ["src/App.jsx", "src/App.tsx", "src/main.jsx", "src/main.tsx"]
  },
  {
    dependencies: ["vue", "@vitejs/plugin-vue"],
    id: "vue",
    label: "Vue",
    markerPaths: ["src/App.vue", "vue.config.js", "nuxt.config.js", "nuxt.config.ts"]
  },
  {
    dependencies: ["svelte", "@sveltejs/kit"],
    id: "svelte",
    label: "Svelte",
    markerPaths: ["svelte.config.js"]
  },
  {
    dependencies: ["lit", "lit-html", "lit-element"],
    id: "lit",
    label: "Lit",
    markerPaths: []
  },
  {
    dependencies: ["preact"],
    id: "preact",
    label: "Preact",
    markerPaths: []
  },
  {
    dependencies: ["solid-js"],
    id: "solid",
    label: "Solid",
    markerPaths: []
  },
  {
    dependencies: ["@angular/core"],
    id: "angular",
    label: "Angular",
    markerPaths: ["angular.json"]
  }
]);

const FRAMEWORK_DEFINITIONS = Object.freeze([
  {
    dependencies: ["next"],
    id: "nextjs",
    label: "Next.js",
    markerPaths: ["next.config.js", "next.config.mjs", "next.config.ts"],
    scriptPattern: /\bnext\b/u
  },
  {
    dependencies: ["nuxt"],
    id: "nuxt",
    label: "Nuxt",
    markerPaths: ["nuxt.config.js", "nuxt.config.ts"],
    scriptPattern: /\bnuxt\b/u
  },
  {
    dependencies: ["@sveltejs/kit"],
    id: "sveltekit",
    label: "SvelteKit",
    markerPaths: ["svelte.config.js"],
    scriptPattern: /\bsvelte-kit\b/u
  },
  {
    dependencies: ["vite"],
    id: "vite",
    label: "Vite",
    markerPaths: ["vite.config.js", "vite.config.mjs", "vite.config.ts"],
    scriptPattern: /\bvite\b/u
  },
  {
    dependencies: ["astro"],
    id: "astro",
    label: "Astro",
    markerPaths: ["astro.config.js", "astro.config.mjs", "astro.config.ts"],
    scriptPattern: /\bastro\b/u
  },
  {
    dependencies: ["@remix-run/dev", "@remix-run/node", "@remix-run/react"],
    id: "remix",
    label: "Remix",
    markerPaths: [],
    scriptPattern: /\bremix\b/u
  },
  {
    dependencies: ["gatsby"],
    id: "gatsby",
    label: "Gatsby",
    markerPaths: [],
    scriptPattern: /\bgatsby\b/u
  },
  {
    dependencies: ["express"],
    id: "express",
    label: "Express",
    markerPaths: [],
    scriptPattern: /\bexpress\b/u
  },
  {
    dependencies: ["fastify"],
    id: "fastify",
    label: "Fastify",
    markerPaths: [],
    scriptPattern: /\bfastify\b/u
  },
  {
    dependencies: ["@nestjs/core", "@nestjs/cli"],
    id: "nestjs",
    label: "NestJS",
    markerPaths: [],
    scriptPattern: /\bnest\b/u
  },
  {
    dependencies: ["hono"],
    id: "hono",
    label: "Hono",
    markerPaths: [],
    scriptPattern: /\bhono\b/u
  },
  {
    dependencies: ["koa"],
    id: "koa",
    label: "Koa",
    markerPaths: [],
    scriptPattern: /\bkoa\b/u
  },
  {
    dependencies: ["@angular/core", "@angular/cli"],
    id: "angular",
    label: "Angular",
    markerPaths: ["angular.json"],
    scriptPattern: /\bng\b/u
  }
]);

const TOOLING_DEFINITIONS = Object.freeze([
  {
    dependencies: ["typescript"],
    id: "typescript",
    label: "TypeScript",
    markerPaths: ["tsconfig.json"],
    scriptPattern: /\btsc\b/u
  },
  {
    dependencies: ["tailwindcss"],
    id: "tailwind",
    label: "Tailwind CSS",
    markerPaths: ["tailwind.config.js", "tailwind.config.mjs", "tailwind.config.ts"]
  },
  {
    dependencies: ["eslint"],
    id: "eslint",
    label: "ESLint",
    markerPaths: ["eslint.config.js", "eslint.config.mjs", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json"],
    scriptPattern: /\beslint\b/u
  },
  {
    dependencies: ["@biomejs/biome"],
    id: "biome",
    label: "Biome",
    markerPaths: ["biome.json", "biome.jsonc"],
    scriptPattern: /\bbiome\b/u
  },
  {
    dependencies: ["vitest"],
    id: "vitest",
    label: "Vitest",
    markerPaths: ["vitest.config.js", "vitest.config.ts"],
    scriptPattern: /\bvitest\b/u
  },
  {
    dependencies: ["jest"],
    id: "jest",
    label: "Jest",
    markerPaths: ["jest.config.js", "jest.config.ts"],
    scriptPattern: /\bjest\b/u
  },
  {
    dependencies: ["@playwright/test", "playwright"],
    id: "playwright",
    label: "Playwright",
    markerPaths: ["playwright.config.js", "playwright.config.mjs", "playwright.config.ts"],
    scriptPattern: /\bplaywright\b/u
  },
  {
    dependencies: ["cypress"],
    id: "cypress",
    label: "Cypress",
    markerPaths: ["cypress.config.js", "cypress.config.ts"],
    scriptPattern: /\bcypress\b/u
  },
  {
    dependencies: ["storybook", "@storybook/react", "@storybook/vue3", "@storybook/svelte"],
    id: "storybook",
    label: "Storybook",
    markerPaths: [".storybook"],
    scriptPattern: /\bstorybook\b/u
  }
]);

function genericNodeWebMarkers() {
  return COMMON_MARKERS.map((marker) => ({
    id: marker.id,
    label: marker.label,
    relativePath: marker.relativePath,
    roles: Array.isArray(marker.roles) ? marker.roles : []
  }));
}

function genericNodeWebCurrentAppMarkers() {
  return COMMON_MARKERS.map((marker) => ({
    id: marker.currentId,
    kind: marker.kind,
    label: marker.label,
    relativePath: marker.relativePath,
    roles: Array.isArray(marker.roles) ? marker.roles : []
  }));
}

function genericNodeWebCurrentAppDirectories() {
  return COMMON_MARKERS
    .filter((marker) => DIRECTORY_MARKER_IDS.has(marker.currentId))
    .map((marker) => ({
      id: marker.currentId,
      label: marker.label.replace(/\/$/u, ""),
      relativePath: marker.relativePath
    }));
}

function existingMarkerPaths(markers = []) {
  return new Set(markers
    .filter((marker) => marker.exists)
    .map((marker) => marker.relativePath));
}

function markerPathExists(markers = [], markerPaths = [], existingPaths = null) {
  const paths = existingPaths || existingMarkerPaths(markers);
  return markerPaths.some((markerPath) => paths.has(markerPath));
}

function packageHasAnyDependency(packageJson = {}, dependencies = []) {
  return dependencies.some((dependency) => hasDependency(packageJson || {}, dependency));
}

function packageScriptText(packageJson = {}) {
  return Object.values(packageScripts(packageJson || {})).join("\n");
}

function definitionMatches(definition, {
  existingPaths = new Set(),
  markers = [],
  packageJson = {}
} = {}) {
  return packageHasAnyDependency(packageJson || {}, definition.dependencies || []) ||
    markerPathExists(markers, definition.markerPaths || [], existingPaths) ||
    Boolean(definition.scriptPattern?.test(packageScriptText(packageJson || {})));
}

function detectDefinitions(definitions = [], context = {}) {
  const existingPaths = existingMarkerPaths(context.markers);
  return definitions
    .filter((definition) => definitionMatches(definition, {
      ...context,
      existingPaths
    }))
    .map(({ id, label }) => ({ id, label }));
}

function detectClientLibraries(context = {}) {
  return detectDefinitions(CLIENT_LIBRARY_DEFINITIONS, context);
}

function detectFrameworkHints(context = {}) {
  return detectDefinitions(FRAMEWORK_DEFINITIONS, context);
}

function detectTooling(context = {}) {
  return detectDefinitions(TOOLING_DEFINITIONS, context);
}

function labelForClientLibrary(value = "") {
  if (value === "auto") {
    return "Auto-detect";
  }
  if (value === "none") {
    return "None or unknown";
  }
  return CLIENT_LIBRARY_DEFINITIONS.find((definition) => definition.id === value)?.label || value;
}

function resolveClientLibrary({
  configured = "auto",
  detected = []
} = {}) {
  if (configured && configured !== "auto") {
    return {
      id: configured,
      label: labelForClientLibrary(configured),
      source: "configured"
    };
  }
  const firstDetected = detected[0];
  if (firstDetected) {
    return {
      ...firstDetected,
      source: "auto-detected"
    };
  }
  return {
    id: "none",
    label: labelForClientLibrary("none"),
    source: "auto-detected"
  };
}

function existingMarkerRelativePaths(markers = [], predicate = () => true) {
  return markers
    .filter((marker) => marker.exists && predicate(marker))
    .map((marker) => marker.relativePath)
    .sort((left, right) => left.localeCompare(right));
}

function commaList(values = []) {
  return values.filter(Boolean).join(", ");
}

function definitionList(definitions = []) {
  return commaList(definitions.map((definition) => definition.label || definition.id));
}

function packageJsonExists(markers = []) {
  return markers.some((marker) => ["package_json", "packageJson"].includes(marker.id) && marker.exists);
}

function markerHasRole(marker = {}, role = "") {
  return Array.isArray(marker.roles) && marker.roles.includes(role);
}

function genericRouterMode(markers = []) {
  const paths = existingMarkerPaths(markers);
  const hasApp = paths.has("app") || paths.has("src/app");
  const hasPages = paths.has("pages") || paths.has("src/pages");
  const hasRoutes = paths.has("routes") || paths.has("src/routes");
  if (hasApp && hasPages) {
    return "app+pages";
  }
  if (hasApp) {
    return "app";
  }
  if (hasPages) {
    return "pages";
  }
  if (hasRoutes) {
    return "routes";
  }
  return "unknown";
}

function sourceLocations(markers = []) {
  return existingMarkerRelativePaths(markers, (marker) => markerHasRole(marker, MARKER_ROLE.SOURCE));
}

function entrypointFiles(markers = []) {
  return existingMarkerRelativePaths(markers, (marker) => markerHasRole(marker, MARKER_ROLE.ENTRYPOINT));
}

function configFiles(markers = []) {
  return existingMarkerRelativePaths(markers, (marker) => markerHasRole(marker, MARKER_ROLE.CONFIG));
}

function testLocations(markers = []) {
  return existingMarkerRelativePaths(markers, (marker) => markerHasRole(marker, MARKER_ROLE.TEST));
}

function packageWorkspaces(packageJson = {}) {
  const workspaces = packageJson?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.map(String).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }
  if (Array.isArray(workspaces?.packages)) {
    return workspaces.packages.map(String).filter(Boolean).sort((left, right) => left.localeCompare(right));
  }
  return [];
}

function packageScriptSummary(packageJson = {}) {
  return scriptNames(packageJson || {}).join(", ");
}

function packageDependencySummary(packageJson = {}) {
  return dependencyNames(packageJson || {}).join(", ");
}

function packageScriptIsPlaceholder(command = "") {
  return /no test specified|echo ['"]?error:/iu.test(String(command || ""));
}

function preferredAutomatedCheckScriptName(packageJson = {}) {
  const candidates = [
    "vibe64:verify",
    "verify",
    "check",
    "test",
    "build",
    "lint",
    "typecheck"
  ];
  return candidates.find((scriptName) => {
    const command = packageScript(packageJson || {}, scriptName);
    return command && !packageScriptIsPlaceholder(command);
  }) || "";
}

function preferredLaunchScriptNames(packageJson = {}) {
  const scripts = packageScripts(packageJson || {});
  return {
    build: scripts.build ? "build" : "",
    dev: scripts.dev ? "dev" : scripts.serve ? "serve" : "",
    preview: scripts.preview ? "preview" : "",
    start: scripts.start ? "start" : scripts.preview ? "preview" : scripts.serve ? "serve" : ""
  };
}

function workspacePatternIsSafe(pattern = "") {
  return Boolean(pattern) && !path.isAbsolute(pattern) && !pattern.includes("..") && !pattern.startsWith("!");
}

async function readWorkspacePackageEntry(packageRoot = "", relativePath = "") {
  try {
    const packageJson = await readPackageJson(packageRoot);
    if (!packageJson) {
      return null;
    }
    return {
      name: String(packageJson.name || ""),
      path: packageRoot,
      relativePath
    };
  } catch {
    return {
      name: "",
      path: packageRoot,
      relativePath
    };
  }
}

async function readWorkspaceGlobPackages(targetRoot = "", pattern = "") {
  if (!pattern.endsWith("/*")) {
    return [];
  }
  const parentRelativePath = pattern.slice(0, -2);
  const parentPath = path.join(targetRoot, parentRelativePath);
  let entries = [];
  try {
    entries = await readdir(parentPath, {
      withFileTypes: true
    });
  } catch {
    return [];
  }

  const packageEntries = await Promise.all(entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packageRoot = path.join(parentPath, entry.name);
      const relativePath = path.join(parentRelativePath, entry.name);
      return readWorkspacePackageEntry(packageRoot, relativePath);
    }));
  return packageEntries.filter(Boolean);
}

async function readDirectWorkspacePackage(targetRoot = "", pattern = "") {
  if (pattern.includes("*")) {
    return [];
  }
  const entry = await readWorkspacePackageEntry(path.join(targetRoot, pattern), pattern);
  return entry ? [entry] : [];
}

async function readWorkspacePackages(targetRoot = "", patterns = []) {
  const packageEntries = [];
  for (const pattern of patterns) {
    const normalizedPattern = String(pattern || "");
    if (!workspacePatternIsSafe(normalizedPattern)) {
      continue;
    }
    packageEntries.push(
      ...await readWorkspaceGlobPackages(targetRoot, normalizedPattern),
      ...await readDirectWorkspacePackage(targetRoot, normalizedPattern)
    );
  }
  return packageEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export {
  commaList,
  configFiles,
  definitionList,
  detectClientLibraries,
  detectFrameworkHints,
  detectTooling,
  entrypointFiles,
  genericRouterMode,
  genericNodeWebCurrentAppDirectories,
  genericNodeWebCurrentAppMarkers,
  genericNodeWebMarkers,
  packageDependencySummary,
  packageJsonExists,
  packageScriptSummary,
  packageWorkspaces,
  preferredAutomatedCheckScriptName,
  preferredLaunchScriptNames,
  readWorkspacePackages,
  resolveClientLibrary,
  sourceLocations,
  testLocations
};
