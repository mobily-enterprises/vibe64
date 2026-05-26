export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-sessions",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns AI Studio workflow session state, actions, advance, and abandon.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core",
    "@local/ai-studio-runtime",
    "@local/ai-studio-project",
    "@local/ai-studio-accounts",
    "@local/ai-studio-terminals",
    "@local/studio-setup-doctor",
    "@local/adapter-setup-doctor",
    "@local/project-setup-doctor"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio-sessions"
    ],
    requires: [
      "feature.ai-studio-project",
      "feature.ai-studio-accounts",
      "feature.ai-studio-terminals",
      "feature.studio-setup-doctor",
      "feature.adapter-setup-doctor",
      "feature.project-setup-doctor",
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioSessionsProvider.js",
          export: "AiStudioSessionsProvider"
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
          summary: "Registers AI Studio session list/create/inspect/action/advance/abandon routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns workflow session state and delegates adapter runtime creation to project service."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio-sessions.service"
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
