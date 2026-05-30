import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  title: "vibe64",
  description: "AI coding with real development workflow.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["meta", { name: "theme-color", content: "#fff8ef" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "vibe64" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Vibe64 turns AI coding into isolated worktrees, best-practice prompts, review gates, validation, and safer delivery."
      }
    ]
  ],
  themeConfig: {
    siteTitle: "vibe64",
    nav: [
      { text: "Why Vibe64", link: "/" },
      { text: "Supported tech", link: "/supported-tech" },
      { text: "Pricing", link: "/pricing" },
      { text: "Start Building", link: "/start-building" }
    ],
    outline: {
      level: [2, 3]
    },
    footer: {
      message: "AI coding with real development workflow.",
      copyright: "Copyright 2026 Mobily Enterprises"
    }
  }
});
