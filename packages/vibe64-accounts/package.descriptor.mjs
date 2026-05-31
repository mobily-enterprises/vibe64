export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-accounts",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 external account readiness and login orchestration.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/vibe64-project",
    "@local/setup-doctor-core",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-accounts"
    ],
    requires: [
      "runtime.actions",
      "feature.vibe64-project"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64AccountsProvider.js",
          export: "Vibe64AccountsProvider"
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
          summary: "Registers Vibe64 account status and login orchestration routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns GitHub and Codex auth status checks plus hidden CLI login sessions."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-accounts.service"
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
