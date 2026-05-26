export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/project-setup-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "Sequential target project setup readiness checks for Studio.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/ai-studio-core",
    "@local/ai-studio-runtime",
    "@local/setup-doctor-core",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.project-setup-doctor"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/ProjectSetupDoctorProvider.js",
          export: "ProjectSetupDoctorProvider"
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
          subpath: "./server/actions",
          summary: "Exports Project Setup Doctor status action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.project-setup-doctor.service"
        ],
        client: []
      }
    },
    jskit: {
      scaffoldMode: "orchestrator",
      scaffoldShape: "feature-server-v1",
      lane: "default"
    }
  },
  mutations: {
    dependencies: {
      runtime: {},
      dev: {}
    },
    files: [],
    packageJson: {
      scripts: {}
    },
    procfile: {},
    text: []
  }
});
