export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/current-app",
  version: "0.1.0",
  kind: "runtime",
  description: "Inspect the current target app through the active AI Studio adapter.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core",
    "@local/ai-studio-project",
    "@local/ai-studio-accounts",
    "@local/studio-setup-doctor",
    "@local/adapter-setup-doctor",
    "@local/project-setup-doctor"
  ],
  capabilities: {
    provides: [
      "feature.current-app"
    ],
    requires: [
      "runtime.actions",
      "feature.ai-studio-project",
      "feature.ai-studio-accounts",
      "feature.studio-setup-doctor",
      "feature.adapter-setup-doctor",
      "feature.project-setup-doctor"
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
