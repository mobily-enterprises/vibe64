export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-terminals",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 Codex and command terminal lifecycle.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-adapters",
    "@local/vibe64-core",
    "@local/vibe64-execution",
    "@local/vibe64-project",
    "@local/vibe64-runtime",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-terminals"
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
          entrypoint: "src/server/Vibe64TerminalsProvider.js",
          export: "Vibe64TerminalsProvider"
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
          summary: "Registers Vibe64 terminal, attachment, and Codex handoff routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns Codex and command terminal lifecycle, IO, and terminal result recording."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-terminals.service"
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
        "json-rest-schema": "^1.0.16",
        "strip-ansi": "^7.2.0"
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
