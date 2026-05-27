import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_APPLICATION_TYPE_PHONE,
  VIBE64_APPLICATION_TYPE_WEB
} from "../../applicationTypes.js";
import {
  createNextjsTargetAdapter
} from "./index.js";

const NEXTJS_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "React web apps and full-stack products built around the standard Next.js ecosystem.",
      id: VIBE64_APPLICATION_TYPE_WEB,
      priority: 90
    },
    {
      explanation: "Mobile-first React web apps that can be wrapped with Capacitor when native packaging is needed.",
      id: VIBE64_APPLICATION_TYPE_PHONE,
      priority: 80
    }
  ],
  bestFor: "General-purpose React products, SaaS apps, dashboards, content sites, and greenfield projects that should stay close to the standard Next.js ecosystem.",
  createAdapter: createNextjsTargetAdapter,
  description: "Next.js is the React framework for App Router and Pages Router applications. The adapter understands package managers, router layout, database/runtime choices, seed options, launch modes, and framework checks.",
  enabled: true,
  id: "nextjs",
  label: "Next.js",
  outcome: "Studio can seed or inspect a Next.js app, configure TypeScript or JavaScript, Tailwind, Prisma or Drizzle, PostgreSQL or MySQL, then drive Codex with prompts tailored to that stack.",
  projectUrl: "https://nextjs.org",
  projectUrlLabel: "Open Next.js project",
  summary: "The mainstream React framework for full-stack web applications.",
  techStack: [
    "React",
    "Next.js",
    "App Router",
    "TypeScript",
    "Tailwind CSS",
    "Prisma or Drizzle"
  ]
});

export {
  NEXTJS_ADAPTER_MANIFEST
};
