export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-source-editor",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns Vibe64 session source-editor file policy, navigation, search, and autosave.",
  dependsOn: [
    "@local/vibe64-adapters",
    "@local/vibe64-core",
    "@local/vibe64-project"
  ],
  capabilities: {
    provides: [
      "feature.vibe64-source-editor"
    ],
    requires: [
      "feature.vibe64-project"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/Vibe64SourceEditorProvider.js",
          export: "Vibe64SourceEditorProvider"
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
          summary: "Registers session source editor tree, file matching, source search, read, and save routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns adapter-policy-aware source tree, ripgrep-backed file matching/search, file read, and autosave operations."
        }
      ],
      containerTokens: {
        server: [
          "feature.vibe64-source-editor.service"
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
