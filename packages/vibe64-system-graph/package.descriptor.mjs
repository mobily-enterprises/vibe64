export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-system-graph",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns the active-session Vibe64 System model, findings, APIs, and visual browser.",
  dependsOn: [
    "@local/vibe64-core",
    "@local/vibe64-execution",
    "@local/vibe64-project"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-system-graph"
    ],
    requires: [
      "feature.vibe64-project"
    ]
  },
  options: {},
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64SystemGraphProvider.js",
          export: "Vibe64SystemGraphProvider"
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
          summary: "Registers active-session System status, model, finding, file-constellation, and update routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns the checked-in current-state System document and its session-authorized projections."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-system-graph.service"
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
