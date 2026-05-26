export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-terminals",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns AI Studio Codex and command terminal lifecycle.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-adapters",
    "@local/ai-studio-core",
    "@local/ai-studio-project",
    "@local/ai-studio-runtime",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio-terminals"
    ],
    requires: [
      "feature.ai-studio-project",
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioTerminalsProvider.js",
          export: "AiStudioTerminalsProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/registerRoutes",
          summary: "Registers AI Studio terminal, attachment, and Codex handoff routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns Codex and command terminal lifecycle, IO, and terminal result recording."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio-terminals.service"
        ],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "feature-server-v1",
      scaffoldMode: "orchestrator",
      lane: "default"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    packageJson: {
      scripts: {}
    },
    procfile: {},
    files: [],
    text: []
  }
});
