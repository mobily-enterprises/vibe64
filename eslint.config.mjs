import { baseConfig, nodeConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

export default [
  {
    ignores: [
      "dist/**",
      "docs/site/.vitepress/dist/**",
      "node_modules/**",
      "coverage/**",
      "test-results/**",
      ".jskit/**",
      ".vibe64/sessions/**",
      ".vibe64/runtime/**",
      ".vibe64-local/**",
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
