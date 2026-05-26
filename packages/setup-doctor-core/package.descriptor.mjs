export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/setup-doctor-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared setup doctor route, stream, status, plugin, and repair tooling.",
  dependsOn: [
    "@local/ai-studio-core",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [],
    requires: []
  },
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
          subpath: "./server",
          summary: "Exports setup doctor route registration, event streaming, status cache, plugin helpers, and git repair helpers."
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
