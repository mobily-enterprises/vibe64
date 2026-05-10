export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/main",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local main composition and glue scaffold.",
  dependsOn: [],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providerEntrypoint: "src/server/MainServiceProvider.js",
      providers: [
        {
          entrypoint: "src/server/MainServiceProvider.js",
          export: "MainServiceProvider"
        }
      ]
    },
    client: {
      providers: [
        {
          entrypoint: "src/client/providers/MainClientProvider.js",
          export: "MainClientProvider"
        }
      ]
    }
  },
  metadata: {
    jskit: {
      ownershipGuidance: {
        title: "App-local main lane",
        summary: "Keep @local/main focused on app composition and lightweight glue. Substantial server features should become dedicated packages instead of growing inside packages/main.",
        responsibilities: [
          "packages/main server code: bootstraps app-local configuration and lightweight wiring only",
          "substantial non-CRUD server features: scaffold a dedicated package with feature-server-generator",
          "packages/main: do not add service/controller/route/repository feature trees here"
        ],
        examples: [
          "jskit generate feature-server-generator scaffold booking-engine",
          "jskit generate feature-server-generator scaffold availability-engine --mode orchestrator"
        ]
      }
    },
    server: {
      routes: []
    },
    ui: {
      routes: [],
      elements: [],
      overrides: []
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
    text: [],
    files: []
  }
});
