export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/studio-terminal-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared Studio terminal, shell, host execution, and managed runtime primitives.",
  dependsOn: [
    "@local/vibe64-core"
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
          summary: "Exports terminal session lifecycle, shell helpers, host execution, Studio runtime identity, and managed services."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "execa": "^9.6.1",
        "node-pty": "^1.1.0"
      },
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
