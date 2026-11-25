import {
  baseConfig,
  clientFeaturesConfig,
  formatterConfig,
  nodeConfig,
  sizeLimitsConfig,
  typedFeaturesConfig,
  vueConfig,
  webConfig
} from "@jskit-ai/config-eslint/server";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// The browser specs and their support files are TypeScript that Playwright only transpiles, never
// type-checks, so lint is the one check they get. They take the rules and globals JSKIT gives the
// JavaScript beside them, read by the TypeScript parser with the types tests/e2e/tsconfig.json
// names (the browser's among them). typescript-eslint's no-unused-vars, with JSKIT's options, stands in
// for ESLint's, which takes the parameter names of a function type for unused variables, and
// no-floating-promises reports a Playwright call left without await, which Playwright's own guidance
// names as the check for that mistake: the step runs after the test has moved on, or never.
const BROWSER_SPECS = "tests/e2e/**/*.ts";
const JSKIT_SOURCE_FILES = "**/*.{js,mjs,cjs,vue}";

function jskitSourceEntries(name, configs) {
  const entries = configs.filter((config) => config.files?.includes(JSKIT_SOURCE_FILES));
  if (entries.length === 0) {
    throw new Error(`${name} no longer selects ${JSKIT_SOURCE_FILES}, so ${BROWSER_SPECS} would lose its rules.`);
  }
  return entries;
}

function withBrowserSpecs(name, configs) {
  const entries = jskitSourceEntries(name, configs);
  return configs.map((config) => (entries.includes(config) ? { ...config, files: [...config.files, BROWSER_SPECS] } : config));
}

const jskitUnusedVars = jskitSourceEntries("baseConfig", baseConfig).find((config) => config.rules?.["no-unused-vars"])
  ?.rules["no-unused-vars"];
if (!jskitUnusedVars) {
  throw new Error(`baseConfig no longer sets no-unused-vars for ${JSKIT_SOURCE_FILES}, which ${BROWSER_SPECS} takes.`);
}

// The checks of https://mobily-enterprises.github.io/jskit-ai/guide/framework/typed-features and
// https://mobily-enterprises.github.io/jskit-ai/guide/framework/client-features, as errors.
const SERVER_SOURCES = ["packages/*/src/server/**", "packages/*/src/shared/**"];
const CLIENT_SOURCES = ["packages/*/src/client/**", "src/**"];
// JSKIT's file and function size limits over all hand-written code, client and host scripts included.
const HAND_WRITTEN_SOURCES = [
  "packages/*/src/**",
  "packages/*/bin/**",
  "packages/*/runtime/**",
  "src/**",
  "server/**",
  "server.js",
  "bin/**",
  "config/**",
  "tooling/**",
  "docs/site/**",
  "examples/**",
  "*.config.mjs"
];

export default [
  {
    ignores: [
      "dist/**",
      ".vibe64-release/**",
      ".vibe64-local/**",
      "server.static.mjs",
      "server.bundle.mjs",
      ".jskit/static-server-provider-registry.mjs",
      "docs/site/.vitepress/dist/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      ".vibe64/sessions/**",
      ".vibe64/runtime/**",
      ".ai[-]studio/sessions/**",
      ".ai[-]studio/runtime/**",
      // Practical-lesson starter apps are deliberately incomplete learner code.
      "tests/fixtures/training/*/app/**"
    ]
  },
  {
    files: ["src/pages/**/*.vue"],
    languageOptions: {
      globals: {
        definePage: "readonly"
      }
    }
  },
  ...withBrowserSpecs("baseConfig", baseConfig),
  ...withBrowserSpecs("vueConfig", vueConfig),
  ...clientFeaturesConfig(CLIENT_SOURCES),
  ...withBrowserSpecs("webConfig", webConfig),
  ...withBrowserSpecs("nodeConfig", nodeConfig),
  {
    files: [BROWSER_SPECS],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": jskitUnusedVars,
      "@typescript-eslint/no-floating-promises": "error"
    }
  },
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  // JSKIT's one formatter config over server and shared code; published state-upgrade scripts are immutable.
  ...formatterConfig([...SERVER_SOURCES, "server/**", "server.js"], {
    ignores: ["packages/vibe64-core/src/server/stateUpgrades/**"]
  })
];
