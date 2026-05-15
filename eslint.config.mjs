import { baseConfig, nodeConfig, vueConfig, webConfig } from "@jskit-ai/config-eslint/server";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".jskit/sessions/**", ".jskit/verification/**"]
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
