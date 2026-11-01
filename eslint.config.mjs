import { baseConfig, nodeConfig, typedFeaturesConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

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
  ...webConfig,
  ...nodeConfig,
  // Server packages converted to typed features; the base config warns for the rest.
  ...typedFeaturesConfig([
    "packages/current-app/src/server/**",
    "packages/studio-health/src/server/**",
    "packages/studio-terminal-core/src/server/**",
    "packages/vibe64-accounts/src/server/**",
    "packages/vibe64-colleague/src/server/**",
    "packages/vibe64-core/src/server/**",
    "packages/vibe64-database-tools/src/server/**",
    "packages/vibe64-execution/src/server/**",
    "packages/vibe64-genesis/src/server/**",
    "packages/vibe64-packaging/src/server/**",
    "packages/vibe64-project/src/server/**",
    "packages/vibe64-publishing/src/server/**",
    "packages/vibe64-runtime/src/server/**",
    "packages/vibe64-source-editor/src/server/**",
    "packages/vibe64-system-graph/src/server/**",
    "packages/vibe64-training/src/server/**",
    "packages/vibe64-usage-recording/src/server/**",
    "packages/vibe64-voice/src/server/**"
  ]),
  {
    // Over 750 lines, with a factory over 600 whose concerns share mutable state.
    files: [
      "packages/vibe64-runtime/src/server/sessionStore.js"
    ],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off"
    }
  }
];
