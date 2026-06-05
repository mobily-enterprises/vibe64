export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/current-app",
  version: "0.1.0",
  kind: "runtime",
  description: "Inspect the current target app through the active Vibe64 adapter.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/vibe64-runtime",
    "@local/vibe64-project",
    "@local/vibe64-accounts",
    "@local/setup-doctor-core",
    "@local/studio-terminal-core",
    "@local/studio-setup-doctor",
    "@local/project-setup-doctor"
  ],
  capabilities: {
    provides: [
      "feature.current-app"
    ],
    requires: [
      "runtime.actions",
      "feature.vibe64-project",
      "feature.vibe64-accounts",
      "feature.studio-setup-doctor",
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
