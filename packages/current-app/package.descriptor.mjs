export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/current-app",
  version: "0.1.0",
  kind: "runtime",
  description: "Inspect the current target app through the active AI Studio adapter.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-project"
  ],
  capabilities: {
    provides: [
      "feature.current-app"
    ],
    requires: [
      "runtime.actions",
      "feature.ai-studio-project"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/CurrentAppProvider.js",
          export: "CurrentAppProvider"
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
          summary: "Exports the current app inspection action."
        }
      ],
      containerTokens: {
        server: [
          "feature.current-app.service"
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
