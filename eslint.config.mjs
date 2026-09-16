import { baseConfig, nodeConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

export default [
  {
    ignores: [
      "dist/**",
      ".vibe64-release/**",
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
      ".ai[-]studio/runtime/**"
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
  ...nodeConfig
];
