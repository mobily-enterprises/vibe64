export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/app-setup-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "Sequential target app setup readiness checks for JSKIT AI Studio.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "feature.app-setup-doctor"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AppSetupDoctorProvider.js",
          export: "AppSetupDoctorProvider"
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
          summary: "Exports App Setup Doctor status action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.app-setup-doctor.service"
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
