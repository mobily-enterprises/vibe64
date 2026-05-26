import {
  deepFreeze
} from "@local/ai-studio-core/server/deepFreeze";
import {
  AI_STUDIO_APPLICATION_TYPE_WEB
} from "../../applicationTypes.js";
import {
  createGenericNodeWebTargetAdapter
} from "./index.js";

const GENERIC_NODE_WEB_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "Existing package.json-based web applications when the exact JavaScript framework is unknown, mixed, custom, or not worth specializing.",
      id: AI_STUDIO_APPLICATION_TYPE_WEB,
      priority: 40
    }
  ],
  bestFor: "Existing package.json-based web apps where the exact framework is unknown, mixed, custom, or not worth modeling with a framework-specific adapter.",
  createAdapter: createGenericNodeWebTargetAdapter,
  description: "Generic Node web app support for package-managed JavaScript and TypeScript applications. The adapter inspects package managers, scripts, dependencies, client-library hints, common config files, source locations, and launch/check commands without seeding or migrating the target.",
  enabled: true,
  id: "node-web",
  label: "Generic Node web app",
  outcome: "Studio can inspect an existing Node web app, expose package scripts, detect likely client libraries such as React, Vue, Svelte, Lit, Preact, Solid, or Angular, then drive Codex with deliberately framework-neutral prompts.",
  projectUrl: "https://nodejs.org",
  projectUrlLabel: "Open Node.js project",
  summary: "A flexible adapter for unknown or custom Node web applications.",
  techStack: [
    "Node.js",
    "JavaScript",
    "TypeScript",
    "React/Vue/Svelte/Lit",
    "package.json scripts"
  ]
});

export {
  GENERIC_NODE_WEB_ADAPTER_MANIFEST
};
