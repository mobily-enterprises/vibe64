import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repoName ? `/${repoName}/` : "/";

export default defineConfig({
  title: "vibe64",
  description: "A local checklist-driven AI coding studio for serious product work.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["meta", { name: "theme-color", content: "#111827" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "vibe64" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Checklist-driven AI coding sessions with durable state, adapters, setup doctors, terminals, and prompt handoff."
      }
    ]
  ],
  themeConfig: {
    siteTitle: "vibe64",
    nav: [
      { text: "Workflow", link: "/workflow" },
      { text: "Adapters", link: "/adapters" },
      { text: "Setup", link: "/setup" },
      { text: "GitHub", link: "https://github.com/mobily-enterprises/vibe64" }
    ],
    search: {
      provider: "local"
    },
    outline: {
      level: [2, 3]
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/mobily-enterprises/vibe64" }
    ],
    footer: {
      message: "vibe64 product site",
      copyright: "Copyright 2026 Mobily Enterprises"
    }
  }
});
