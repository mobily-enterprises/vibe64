import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_APPLICATION_TYPE_WEB
} from "../../applicationTypes.js";
import {
  createVinextTargetAdapter
} from "./index.js";

const VINEXT_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "Next.js-compatible React web apps that should target Cloudflare with Vite-powered Vinext workflows.",
      id: VIBE64_APPLICATION_TYPE_WEB,
      priority: 65
    }
  ],
  bestFor: "Next.js-style apps that want Cloudflare-oriented runtime behavior, Vite ergonomics, and a migration path that keeps the existing app shape understandable.",
  createAdapter: createVinextTargetAdapter,
  description: "Vinext is Cloudflare's Vite-powered framework for Next.js-compatible applications. The adapter understands Vinext commands, migration state, runtime launch modes, and compatibility checks.",
  enabled: true,
  id: "vinext",
  label: "Vinext",
  outcome: "Studio guides a Vinext-ready app or migration candidate, adds Vinext-aware setup checks, runs vinext check/build flows, and frames Codex prompts around the app router and Cloudflare runtime model.",
  projectUrl: "https://github.com/cloudflare/vinext",
  projectUrlLabel: "Open Vinext project",
  summary: "A Cloudflare-focused Vite runtime for Next.js-compatible applications.",
  techStack: [
    "Vinext",
    "Vite",
    "React",
    "Next.js compatibility",
    "Cloudflare Workers"
  ]
});

export {
  VINEXT_ADAPTER_MANIFEST
};
