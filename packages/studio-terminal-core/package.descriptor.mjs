export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/studio-terminal-core",
  version: "0.1.0",
  kind: "runtime",
  description: "Shared Studio terminal access, credential-home, and managed runtime primitives.",
  dependsOn: [
    "@local/vibe64-core",
    "@local/vibe64-execution"
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
          summary: "Exports terminal access controls, Studio runtime identity, credential-home helpers, and managed services."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
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
