export default Object.freeze({
  packageVersion: 1,
  packageId: "@local/adapter-setup-doctor",
  version: "0.1.0",
  kind: "runtime",
  description: "Target adapter readiness checks and repairs for Studio.",
  dependsOn: [
    "@jskit-ai/kernel",
    "@local/vibe64-core",
    "@local/vibe64-project",
    "@local/setup-doctor-core",
    "@local/studio-terminal-core"
  ],
  capabilities: {
    provides: [
      "feature.adapter-setup-doctor"
    ],
    requires: [
      "runtime.actions",
      "feature.vibe64-project"
    ]
  },
  runtime: {
    server: {
      providers: [
        {
          entrypoint: "src/server/AdapterSetupDoctorProvider.js",
          export: "AdapterSetupDoctorProvider"
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
          summary: "Exports Adapter Setup Doctor status action definitions."
        }
      ],
      containerTokens: {
        server: [
          "feature.adapter-setup-doctor.service"
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
      runtime: {
        "json-rest-schema": "^1.0.16"
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
