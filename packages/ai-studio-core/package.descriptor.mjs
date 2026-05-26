export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared AI Studio server primitives.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [],
    requires: []
  },
  options: {},
  runtime: {
    server: {
      providers: []
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/featureRoutes",
          summary: "Shared route registration helpers for AI Studio feature packages."
        },
        {
          subpath: "./server/terminalWebSocketRoutes",
          summary: "Shared websocket registration helper for terminal-backed Studio routes."
        },
        {
          subpath: "./server/serverResponses",
          summary: "Shared AI Studio response normalization helpers."
        },
        {
          subpath: "./server/sessionRealtimeEvents",
          summary: "Shared AI Studio session realtime event descriptors."
        }
      ]
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
    vite: {
      proxy: []
    },
    text: [],
    files: []
  }
});
