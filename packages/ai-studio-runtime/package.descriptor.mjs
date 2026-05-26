export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-runtime",
  version: "0.1.0",
  kind: "runtime",
  description: "AI Studio workflow session runtime and durable session store.",
  dependsOn: [
    "@local/ai-studio-adapters",
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
