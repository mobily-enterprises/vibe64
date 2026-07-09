export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/vibe64-execution",
  version: "0.1.0",
  kind: "runtime",
  description: "Single Vibe64 command execution policy gateway.",
  dependsOn: [],
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
          summary: "Runs Vibe64 commands through one actor, environment, runtime path, policy, and execution gateway."
        },
        {
          subpath: "./server/terminalSessions",
          summary: "Low-level PTY terminal session lifecycle owned by the execution gateway."
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
    files: [],
    text: []
  }
});
