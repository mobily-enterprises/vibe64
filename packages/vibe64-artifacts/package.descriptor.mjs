export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-artifacts",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 editable artifact and draft file policy.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/vibe64-project"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-artifacts"
    ],
    requires: [
      "feature.vibe64-project",
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64ArtifactsProvider.js",
          export: "Vibe64ArtifactsProvider"
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
          summary: "Registers editable artifact read/write routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns issue and pull request draft artifact policy."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-artifacts.service"
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
