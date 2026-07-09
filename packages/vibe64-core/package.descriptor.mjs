export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared Vibe64 server primitives.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-execution"
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
          summary: "Shared route registration helpers for Vibe64 feature packages."
        },
        {
          subpath: "./server/terminalWebSocketRoutes",
          summary: "Shared websocket registration helper for terminal-backed Studio routes."
        },
        {
          subpath: "./server/serviceOwnedTerminalRoutes",
          summary: "Shared route registration helper for service-owned terminal job routes."
        },
        {
          subpath: "./server/serverResponses",
          summary: "Shared Vibe64 response normalization helpers."
        },
        {
          subpath: "./server/sessionRealtimeEvents",
          summary: "Shared Vibe64 session realtime event descriptors."
        },
        {
          subpath: "./server/sessionUiSyncState",
          summary: "Shared Vibe64 per-session UI sync state snapshots."
        },
        {
          subpath: "./server/projectRealtimeEvents",
          summary: "Shared Vibe64 project realtime event descriptors."
        },
        {
          subpath: "./server/composerRealtimeEvents",
          summary: "Shared Vibe64 composer realtime event descriptors."
        },
        {
          subpath: "./server/sessionViewRealtimeEvents",
          summary: "Shared Vibe64 session view realtime event descriptors."
        },
        {
          subpath: "./server/sourceEditorRealtimeEvents",
          summary: "Shared Vibe64 source editor realtime event descriptors."
        },
        {
          subpath: "./server/logging",
          summary: "Shared Vibe64 log-level and Fastify logger configuration helpers."
        },
        {
          subpath: "./server/runtimeConfig",
          summary: "Shared Vibe64 runtime config records, resolution, redaction, missing checks, and generated file materialization."
        },
        {
          subpath: "./server/envUserValues",
          summary: "Shared Vibe64 user-owned Env value persistence helpers."
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
