export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-project",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 project folder selection, project type selection, readiness, and adapter registry access.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-adapters",
    "@local/vibe64-core",
    "@local/vibe64-execution",
    "@local/vibe64-runtime"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-project"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64ProjectProvider.js",
          export: "Vibe64ProjectProvider"
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
          summary: "Registers Vibe64 project selection, project type, project config, and Env read/write routes."
        },
        {
          subpath: "./server/service",
          summary: "Provides project folder selection, project type state, project config state, Env state, and adapter-backed session runtime creation."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-project.service"
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
