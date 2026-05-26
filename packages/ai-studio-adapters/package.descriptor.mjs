export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-adapters",
  version: "0.1.0",
  kind: "runtime",
  description: "AI Studio adapter registry, adapter contracts, and built-in adapters.",
  dependsOn: [
    "@local/ai-studio-core",
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
