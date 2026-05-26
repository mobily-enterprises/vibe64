export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-accounts",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns AI Studio external account readiness and login orchestration.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio-accounts"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioAccountsProvider.js",
          export: "AiStudioAccountsProvider"
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
          summary: "Registers AI Studio account status and login orchestration routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns GitHub and Codex auth status checks plus hidden CLI login sessions."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio-accounts.service"
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
