export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-runtime",
  version: "0.1.0",
  kind: "runtime",
  description: "Vibe64 workflow session runtime and durable session store.",
  dependsOn: [
    "@local/vibe64-adapters",
    "@local/vibe64-core",
    "@local/vibe64-execution",
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
          summary: "Exports workflow definitions, session runtime, session store, setup readiness, and session debug helpers."
        }
      ]
    }
  },
  mutations: {
    dependencies: {
      runtime: {
        "strip-ansi": "^7.2.0"
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
