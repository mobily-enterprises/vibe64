import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  VIBE64_APPLICATION_TYPE_PHONE,
  VIBE64_APPLICATION_TYPE_WEB
} from "../../applicationTypes.js";

async function createJskitAdapter() {
  const adapterModule = await import("./index.js");
  return adapterModule.createJskitTargetAdapter();
}

const JSKIT_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "Web apps written in Vue and Node.js, using JSKIT conventions that are deliberately structured for AI-assisted product work.",
      id: VIBE64_APPLICATION_TYPE_WEB,
      priority: 100
    },
    {
      explanation: "Mobile-first web apps that can be packaged with Capacitor while keeping the JSKIT provider and Vue app structure.",
      id: VIBE64_APPLICATION_TYPE_PHONE,
      priority: 90
    }
  ],
  bestFor: "Production CRUD and operations apps where Vibe64 can lean on JSKIT conventions, providers, commands, generated surfaces, and built-in setup checks.",
  createAdapter: createJskitAdapter,
  description: "JSKIT AI is the full-stack application framework behind JSKIT projects: a structured Node/Vue platform with provider modules, generated CRUD flows, command actions, shared runtime services, and framework-aware project setup.",
  enabled: true,
  id: "jskit",
  label: "JSKIT AI",
  outcome: "Studio prepares a JSKIT application with its provider layout, package scripts, database/runtime expectations, app blueprint, adapter-specific prompts, and verification path ready for Codex-driven work.",
  projectUrl: "https://www.npmjs.com/package/@jskit-ai/jskit-cli",
  projectUrlLabel: "Open JSKIT AI package",
  summary: "A batteries-included full-stack app framework for structured, agent-assisted product work.",
  techStack: [
    "Node.js",
    "Vue",
    "Vuetify",
    "JSKIT providers",
    "JSON REST resources",
    "Host Node.js runtime"
  ]
});

export {
  JSKIT_ADAPTER_MANIFEST
};
