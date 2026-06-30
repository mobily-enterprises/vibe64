export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared Vibe64 server primitives.",
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
          summary: "Shared route registration helpers for Vibe64 feature packages."
        },
        {
          subpath: "./server/terminalWebSocketRoutes",
          summary: "Shared websocket registration helper for terminal-backed Studio routes."
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
          subpath: "./server/projectRealtimeEvents",
          summary: "Shared Vibe64 project realtime event descriptors."
        },
        {
          subpath: "./server/composerRealtimeEvents",
          summary: "Shared Vibe64 composer realtime event descriptors."
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
