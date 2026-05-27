export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-adapters",
  version: "0.1.0",
  kind: "runtime",
  description: "Vibe64 adapter registry, adapter contracts, and built-in adapters.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/setup-doctor-core",
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
          summary: "Exports the adapter registry, adapter contract helpers, project type/config stores, and built-in adapters."
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
