export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-project",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns AI Studio project type selection, readiness, and adapter registry access.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio-project"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioProjectProvider.js",
          export: "AiStudioProjectProvider"
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
          summary: "Registers AI Studio project type and project config read/write routes."
        },
        {
          subpath: "./server/service",
          summary: "Provides project type state, project config state, and adapter-backed session runtime creation."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio-project.service"
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
