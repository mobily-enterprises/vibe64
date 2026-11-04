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
  ...baseConfig,
  ...vueConfig,
  ...clientFeaturesConfig(CLIENT_SOURCES),
  ...webConfig,
  ...nodeConfig,
  ...typedFeaturesConfig(SERVER_SOURCES),
  ...sizeLimitsConfig(HAND_WRITTEN_SOURCES),
  // JSKIT's one formatter config over server and shared code; published state-upgrade scripts are immutable.
  ...formatterConfig([...SERVER_SOURCES, "server/**", "server.js"], {
    ignores: ["packages/vibe64-core/src/server/stateUpgrades/**"]
  })
];
