export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/target-app-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "App-local non-CRUD feature package (target-app-doctor).",
  dependsOn: [
    "@jskit-ai/kernel"
  ],
  capabilities: {
    provides: [
      "feature.target-app-doctor"
    ],
    requires: [
      "runtime.actions"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/TargetAppDoctorProvider.js",
          export: "TargetAppDoctorProvider"
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
          summary: "Exports generated feature action definitions with inline starter ids."
        }
      ],
      containerTokens: {
        server: [
          "feature.target-app-doctor.service"
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
