export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/bootstrap-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "Mandatory local runtime bootstrap checks and repairs for JSKIT AI Studio.",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "feature.bootstrap-doctor"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/BootstrapDoctorProvider.js",
          export: "BootstrapDoctorProvider"
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
          summary: "Exports Bootstrap Doctor status and repair action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.bootstrap-doctor.service"
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
