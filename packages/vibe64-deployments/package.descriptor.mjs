export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-deployments",
  version: "0.1.0",
  kind: "runtime",
  description: "Project deployment lifecycle orchestration for Vibe64 publishing.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/studio-terminal-core",
    "@local/vibe64-adapters",
    "@local/vibe64-core"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-deployments"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64DeploymentsProvider.js",
          export: "Vibe64DeploymentsProvider"
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
          subpath: "./server/actions",
          summary: "Exports Vibe64 deployment action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-deployments.service"
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
