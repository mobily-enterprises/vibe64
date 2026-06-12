import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repoName ? `/${repoName}/` : "/";

const vibeNav = [
  { text: "Why Vibe64", link: "/" },
  { text: "Supported tech", link: "/supported-tech" },
  { text: "Pricing", link: "/pricing" },
  { text: "Dev Site", link: "/dev/" },
  { text: "Start Building", link: "/start-building" }
];

const devNav = [
  { text: "Why Vibe64", link: "/dev/" },
  { text: "Supported tech", link: "/dev/supported-tech" },
  { text: "Technical reference", link: "/dev/technical-reference" },
  { text: "Pricing", link: "/dev/pricing" },
  { text: "Vibe Site", link: "/" },
  { text: "Start Building", link: "/dev/start-building" }
];

export default defineConfig({
  title: "Vibe64",
  description: "AI coding without the usual mess.",
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["meta", { name: "theme-color", content: "#fff8ef" }],
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}vibe64-logo.svg` }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "Vibe64" }],
    [
      "meta",
      {
        property: "og:description",
        content: "Vibe64 helps AI coding happen in a safe place first, with clear tasks, checks, review notes, and repeatable project tools."
      }
    ]
  ],
  themeConfig: {
    siteTitle: "Vibe64",
    logo: "/vibe64-logo.svg",
    nav: vibeNav,
    outline: {
      level: [2, 3]
    },
    footer: {
      message: "AI coding with real development workflow.",
      copyright: "Copyright 2026 Mobily Enterprises"
    }
  },
  locales: {
    root: {
      label: "Vibe Site",
      lang: "en",
      title: "Vibe64",
      description: "AI coding without the usual mess.",
      themeConfig: {
        nav: vibeNav
      }
    },
    dev: {
      label: "Dev Site",
      lang: "en",
      link: "/dev/",
      title: "Vibe64",
      description: "AI coding with real development workflow.",
      themeConfig: {
        nav: devNav
      }
    }
  }
});
