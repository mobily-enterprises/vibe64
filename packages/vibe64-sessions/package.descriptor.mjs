export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-sessions",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 workflow session state, actions, advance, and abandon.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/vibe64-runtime",
    "@local/vibe64-project",
    "@local/vibe64-terminals",
    "@local/studio-setup-doctor",
    "@local/project-setup-doctor"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-sessions"
    ],
    requires: [
      "feature.vibe64-project",
      "feature.vibe64-terminals",
      "feature.studio-setup-doctor",
      "feature.project-setup-doctor",
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64SessionsProvider.js",
          export: "Vibe64SessionsProvider"
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
          summary: "Registers Vibe64 session list/create/inspect/action/advance/abandon routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns workflow session state and delegates adapter runtime creation to project service."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-sessions.service"
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
      runtime: {
        "json-rest-schema": "^1.0.16"
      },
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
