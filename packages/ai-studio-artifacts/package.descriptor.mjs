export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/ai-studio-artifacts",
  version: "0.1.0",
  kind: "runtime",
  description: "Owns AI Studio editable artifact and draft file policy.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core",
    "@local/ai-studio-project"
  ],
  capabilities: {
    provides: [
      "feature.ai-studio-artifacts"
    ],
    requires: [
      "feature.ai-studio-project",
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AiStudioArtifactsProvider.js",
          export: "AiStudioArtifactsProvider"
        }
      ]
    },
    client: {
      providers: []
    }
  },
  metadata: {
    apiSummary: {
      surfaces: [
        {
          subpath: "./server/registerRoutes",
          summary: "Registers editable artifact read/write routes."
        },
        {
          subpath: "./server/service",
          summary: "Owns issue and pull request draft artifact policy."
        }
      ],
      containerTokens: {
        server: [
          "feature.ai-studio-artifacts.service"
        ],
        client: []
      }
    },
    jskit: {
      scaffoldShape: "feature-server-v1",
      scaffoldMode: "orchestrator",
      lane: "default"
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
    files: [],
    text: []
  }
});
