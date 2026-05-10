export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/current-app",
  version: "0.1.0",
  kind: "runtime",
  description: "Inspect the current JSKIT app from the local filesystem and git.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "feature.current-app"
    ],
    requires: [
      "runtime.actions"
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
